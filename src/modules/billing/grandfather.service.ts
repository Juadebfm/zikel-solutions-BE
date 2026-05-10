/**
 * Phase 7.9 — grandfather existing tenants onto a 30-day trial.
 *
 * Idempotent. Safe to re-run. For every active tenant with no `Subscription`
 * row:
 *   - Create a Stripe Customer (metadata only — no PM attached).
 *   - Create a `Subscription` row with `status='trialing'`,
 *     `trialEndsAt = now + 30 days`, `planId = standard_monthly`,
 *     `stripeCustomerId` set, `stripeSubscriptionId = null` (no Stripe
 *     subscription yet — they create one when they hit checkout).
 *   - Create initial `TokenAllocation { bundledCalls: 1000, ... }`.
 *   - Set `Tenant.subscriptionStatus = 'trialing'`.
 *   - Write `BillingEvent { kind: 'tenant_grandfathered', ... }`.
 *
 * The Owner email is sent SEPARATELY by the calling script — this function
 * focuses on the DB writes so it's safe to call from boot fallback paths
 * without spamming emails.
 */

import { BillingEventKind, MembershipStatus, Prisma } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { withUnscopedTenant } from '../../lib/request-context.js';
import { getStripeClient } from '../../lib/stripe.js';

const TRIAL_DAYS = 30;

export interface GrandfatherTenantResult {
  tenantId: string;
  tenantName: string;
  ownerEmail: string | null;
  ownerName: string | null;
  trialEndsAt: Date;
  alreadyGrandfathered: boolean;
}

/**
 * Grandfathers a single tenant. Returns:
 *   - `alreadyGrandfathered: true` if a Subscription row already exists
 *     (idempotent re-run; no DB writes).
 *   - The Owner contact info so the caller can fire the email.
 */
export async function grandfatherTenant(args: {
  tenantId: string;
  planCode?: 'standard_monthly';
}): Promise<GrandfatherTenantResult> {
  return withUnscopedTenant(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        memberships: {
          where: { status: MembershipStatus.active, role: { name: 'Owner' } },
          select: {
            user: { select: { email: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    if (!tenant) throw new Error(`Tenant ${args.tenantId} not found.`);
    if (!tenant.isActive) throw new Error(`Tenant ${args.tenantId} is inactive — skipping.`);

    const ownerUser = tenant.memberships[0]?.user ?? null;
    const ownerEmail = ownerUser?.email ?? null;
    const ownerName = ownerUser
      ? `${ownerUser.firstName} ${ownerUser.lastName}`.trim()
      : null;

    // Already grandfathered?
    const existing = await prisma.subscription.findUnique({
      where: { tenantId: tenant.id },
    });
    if (existing) {
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        ownerEmail,
        ownerName,
        trialEndsAt: existing.trialEndsAt ?? existing.currentPeriodEnd,
        alreadyGrandfathered: true,
      };
    }

    // Resolve the standard_monthly plan.
    const planCode = args.planCode ?? 'standard_monthly';
    const plan = await prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) {
      throw new Error(
        `Plan ${planCode} not found. Run server boot once with Stripe env set so seed runs, or call seedBillingProducts() first.`,
      );
    }

    // Create the Stripe Customer (best-effort). If Stripe is unconfigured in
    // dev we still create the Subscription row with a sentinel customer id —
    // it'll be populated for real on the first checkout.
    let stripeCustomerId: string;
    const stripe = getStripeClient();
    if (stripe && ownerEmail) {
      const customer = await stripe.customers.create({
        email: ownerEmail,
        ...(ownerName ? { name: ownerName } : {}),
        metadata: {
          tenantId: tenant.id,
          source: 'grandfather_migration',
        },
      });
      stripeCustomerId = customer.id;
    } else {
      // Dev path — Stripe not configured. Use a deterministic placeholder.
      // The grandfather flow still works because we don't actually call Stripe
      // until the first checkout-session is requested by the Owner.
      stripeCustomerId = `cus_grandfather_${tenant.id}`;
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);

    // Create Subscription + initial TokenAllocation + BillingEvent + flip
    // Tenant.subscriptionStatus, all in one transaction.
    await prisma.$transaction([
      prisma.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'trialing',
          stripeCustomerId,
          stripeSubscriptionId: null,
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
          cancelAtPeriodEnd: false,
        },
      }),
      prisma.tokenAllocation.create({
        data: {
          tenantId: tenant.id,
          periodStart: now,
          periodEnd: trialEndsAt,
          bundledCalls: plan.bundledCallsPerPeriod,
          resetAt: trialEndsAt,
        },
      }),
      prisma.tenant.update({
        where: { id: tenant.id },
        data: { subscriptionStatus: 'trialing' },
      }),
      prisma.billingEvent.create({
        data: {
          tenantId: tenant.id,
          kind: BillingEventKind.tenant_grandfathered,
          stripeEventId: null,
          payload: {
            source: 'phase7_rollout',
            trialDays: TRIAL_DAYS,
            trialEndsAt: trialEndsAt.toISOString(),
            planCode: plan.code,
            stripeCustomerId,
            stripeConfigured: stripe !== null,
          } as Prisma.InputJsonValue,
        },
      }),
    ]);

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      ownerEmail,
      ownerName,
      trialEndsAt,
      alreadyGrandfathered: false,
    };
  });
}

/**
 * Bulk grandfather: walks every active tenant and processes them. Returns a
 * summary the caller can log / email-fan-out from.
 *
 * Caller is responsible for sending Owner emails — this just touches DB.
 */
export async function grandfatherAllActiveTenants(): Promise<{
  results: GrandfatherTenantResult[];
  errors: Array<{ tenantId: string; error: string }>;
}> {
  return withUnscopedTenant(async () => {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const results: GrandfatherTenantResult[] = [];
    const errors: Array<{ tenantId: string; error: string }> = [];
    for (const t of tenants) {
      try {
        const r = await grandfatherTenant({ tenantId: t.id });
        results.push(r);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        logger.warn({ msg: 'grandfather: tenant failed', tenantId: t.id, err: msg });
        errors.push({ tenantId: t.id, error: msg });
      }
    }
    return { results, errors };
  });
}
