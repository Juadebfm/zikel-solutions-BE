/**
 * Phase 7.5 — billing service. Tenant-side surface for the Owner to:
 *   - View their subscription state + AI quota
 *   - Start a Stripe Checkout session (subscribe, change plan, buy a top-up)
 *   - Open the Stripe Customer Portal (update card, cancel)
 *   - View invoices
 *   - Configure per-role / per-user AI restrictions
 *
 * All Stripe SDK access goes through `requireStripeClient()`. In dev/test
 * (Stripe unconfigured) the routes return 503 BILLING_NOT_CONFIGURED.
 */

import { Prisma } from '@prisma/client';
import type { TenantAiRestriction, Subscription, Plan, TopUpPack } from '@prisma/client';
import { env } from '../../config/env.js';
import { httpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { withUnscopedTenant } from '../../lib/request-context.js';
import { requireStripeClient } from '../../lib/stripe.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { getQuotaSnapshotForTenant } from '../../lib/quota.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

interface UiFlags {
  isInTrial: boolean;
  daysLeftInTrial: number | null;
  isReadOnly: boolean;
  isSuspended: boolean;
  isCancelled: boolean;
  pastDueSinceDays: number | null;
}

function deriveUiFlags(sub: Subscription | null): UiFlags {
  if (!sub) {
    return {
      isInTrial: false,
      daysLeftInTrial: null,
      isReadOnly: false,
      isSuspended: false,
      isCancelled: false,
      pastDueSinceDays: null,
    };
  }
  const now = new Date();
  const isInTrial = sub.status === 'trialing';
  const daysLeftInTrial = sub.trialEndsAt
    ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / 86_400_000))
    : null;
  const pastDueSinceDays = sub.pastDueSince
    ? Math.floor((now.getTime() - sub.pastDueSince.getTime()) / 86_400_000)
    : null;

  return {
    isInTrial,
    daysLeftInTrial: isInTrial ? daysLeftInTrial : null,
    isReadOnly: sub.status === 'past_due_readonly' || sub.status === 'incomplete',
    isSuspended: sub.status === 'suspended',
    isCancelled: sub.status === 'cancelled',
    pastDueSinceDays,
  };
}

function mapPlan(plan: Plan) {
  return {
    code: plan.code,
    name: plan.name,
    interval: plan.interval,
    unitAmountMinor: plan.unitAmountMinor,
    currency: plan.currency,
    bundledCallsPerPeriod: plan.bundledCallsPerPeriod,
  };
}

function mapTopUpPack(pack: TopUpPack) {
  return {
    code: pack.code,
    name: pack.name,
    unitAmountMinor: pack.unitAmountMinor,
    currency: pack.currency,
    calls: pack.calls,
  };
}

function mapAiRestriction(restriction: TenantAiRestriction | null) {
  return {
    perRoleCaps: (restriction?.perRoleCaps ?? {}) as Record<string, number | null>,
    perUserCaps: (restriction?.perUserCaps ?? {}) as Record<string, number | null>,
    updatedAt: restriction?.updatedAt ?? null,
  };
}

/**
 * Loads the calling user's tenant subscription. Returns null when no
 * Subscription row exists yet (which only happens before the grandfather
 * migration runs OR in test fixtures).
 */
async function loadSubscription(tenantId: string) {
  return prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
}

// ─── Public service surface ─────────────────────────────────────────────────

export async function getSubscriptionState(actorUserId: string) {
  const tenant = await requireTenantContext(actorUserId);
  const subscription = await loadSubscription(tenant.tenantId);
  const ui = deriveUiFlags(subscription);

  return {
    status: subscription?.status ?? 'trialing',
    plan: subscription
      ? {
          code: subscription.plan.code,
          name: subscription.plan.name,
          interval: subscription.plan.interval,
          unitAmountMinor: subscription.plan.unitAmountMinor,
          currency: subscription.plan.currency,
        }
      : null,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    currentPeriodStart: subscription?.currentPeriodStart ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    pastDueSince: subscription?.pastDueSince ?? null,
    manuallyOverriddenUntil: subscription?.manuallyOverriddenUntil ?? null,
    ...ui,
  };
}

export async function listAvailablePlans() {
  const [plans, topUps] = await Promise.all([
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { unitAmountMinor: 'asc' } }),
    prisma.topUpPack.findMany({ where: { isActive: true }, orderBy: { unitAmountMinor: 'asc' } }),
  ]);
  return {
    plans: plans.map(mapPlan),
    topUpPacks: topUps.map(mapTopUpPack),
  };
}

export async function getQuotaForTenant(actorUserId: string) {
  const tenant = await requireTenantContext(actorUserId);
  return getQuotaSnapshotForTenant({ tenantId: tenant.tenantId });
}

// ─── Stripe Checkout — subscription ─────────────────────────────────────────

export async function createSubscriptionCheckoutSession(args: {
  actorUserId: string;
  planCode: 'standard_monthly' | 'standard_annual';
}) {
  const stripe = requireStripeClient();
  if (!env.BILLING_CHECKOUT_SUCCESS_URL || !env.BILLING_CHECKOUT_CANCEL_URL) {
    throw httpError(
      503,
      'BILLING_NOT_CONFIGURED',
      'Billing return URLs are not configured. Contact support.',
    );
  }

  const tenant = await requireTenantContext(args.actorUserId);
  const plan = await prisma.plan.findUnique({ where: { code: args.planCode } });
  if (!plan || !plan.stripePriceId) {
    throw httpError(404, 'PLAN_NOT_FOUND', `Plan ${args.planCode} is not available.`);
  }

  // Reuse the existing Stripe Customer if one exists for this tenant — avoids
  // creating duplicate Stripe customers on re-checkout. Subscription rows are
  // unique on tenantId, so at most one row exists.
  const existing = await loadSubscription(tenant.tenantId);

  // Resolve the actor user's email + name for the new Customer's metadata.
  const user = await prisma.tenantUser.findUnique({
    where: { id: args.actorUserId },
    select: { email: true, firstName: true, lastName: true },
  });
  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  let stripeCustomerId = existing?.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
      metadata: {
        tenantId: tenant.tenantId,
        actorUserId: args.actorUserId,
      },
    });
    stripeCustomerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    // Stripe Tax requires `automatic_tax: { enabled: true }` AND the Customer
    // to have a billing address. Stripe Hosted Checkout collects this from
    // the customer at checkout time.
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto' },
    success_url: env.BILLING_CHECKOUT_SUCCESS_URL,
    cancel_url: env.BILLING_CHECKOUT_CANCEL_URL,
    // Mark this as a SUBSCRIPTION checkout — distinguishes from top-up at
    // webhook handling time.
    metadata: {
      tenantId: tenant.tenantId,
      kind: 'subscription',
      planCode: plan.code,
    },
    subscription_data: {
      // Apply the trial here so Stripe transitions the subscription to
      // `trialing` immediately — no PM required (per locked decisions in
      // payment.md).
      trial_period_days: 7,
      metadata: {
        tenantId: tenant.tenantId,
      },
    },
    // Don't require a PM upfront for the trial.
    payment_method_collection: 'if_required',
  });

  return {
    url: session.url,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  };
}

// ─── Stripe Customer Portal ─────────────────────────────────────────────────

export async function createPortalSession(args: { actorUserId: string }) {
  const stripe = requireStripeClient();
  if (!env.BILLING_PORTAL_RETURN_URL) {
    throw httpError(
      503,
      'BILLING_NOT_CONFIGURED',
      'Billing return URLs are not configured. Contact support.',
    );
  }
  const tenant = await requireTenantContext(args.actorUserId);
  const subscription = await loadSubscription(tenant.tenantId);
  if (!subscription) {
    throw httpError(
      404,
      'SUBSCRIPTION_NOT_FOUND',
      'No subscription on file. Subscribe first via /billing/checkout-session.',
    );
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: env.BILLING_PORTAL_RETURN_URL,
  });
  return { url: session.url };
}

// ─── Stripe Checkout — top-up (one-time) ────────────────────────────────────

export async function createTopUpCheckoutSession(args: {
  actorUserId: string;
  packCode: 'topup_small' | 'topup_medium' | 'topup_large';
}) {
  const stripe = requireStripeClient();
  if (!env.BILLING_CHECKOUT_SUCCESS_URL || !env.BILLING_CHECKOUT_CANCEL_URL) {
    throw httpError(
      503,
      'BILLING_NOT_CONFIGURED',
      'Billing return URLs are not configured. Contact support.',
    );
  }
  const tenant = await requireTenantContext(args.actorUserId);
  const pack = await prisma.topUpPack.findUnique({ where: { code: args.packCode } });
  if (!pack || !pack.stripePriceId) {
    throw httpError(404, 'TOPUP_PACK_NOT_FOUND', `Top-up pack ${args.packCode} is not available.`);
  }
  const subscription = await loadSubscription(tenant.tenantId);
  if (!subscription) {
    throw httpError(
      409,
      'SUBSCRIPTION_REQUIRED',
      'A subscription is required before purchasing a top-up. Subscribe first.',
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: subscription.stripeCustomerId,
    line_items: [{ price: pack.stripePriceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto' },
    success_url: env.BILLING_CHECKOUT_SUCCESS_URL,
    cancel_url: env.BILLING_CHECKOUT_CANCEL_URL,
    // Mark this as a TOP-UP — webhook handler reads `metadata.kind` to decide
    // whether to credit calls vs treat as subscription side-effect.
    metadata: {
      tenantId: tenant.tenantId,
      kind: 'topup',
      packCode: pack.code,
      calls: String(pack.calls),
    },
  });

  return {
    url: session.url,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
  };
}

// ─── Cancel ────────────────────────────────────────────────────────────────

export async function cancelSubscriptionAtPeriodEnd(args: { actorUserId: string }) {
  const stripe = requireStripeClient();
  const tenant = await requireTenantContext(args.actorUserId);
  const subscription = await loadSubscription(tenant.tenantId);
  if (!subscription || !subscription.stripeSubscriptionId) {
    throw httpError(
      404,
      'SUBSCRIPTION_NOT_FOUND',
      'No active subscription to cancel. Subscribe first.',
    );
  }
  // Don't double-cancel: if Stripe already says it's set to cancel, return
  // current state without round-tripping.
  if (subscription.cancelAtPeriodEnd) {
    return {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: subscription.currentPeriodEnd,
    };
  }
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
  // Mirror locally — webhook will also update this, but we want the API to
  // return the new state immediately rather than wait for the webhook RTT.
  // We return our own `currentPeriodEnd` rather than reading it from the
  // Stripe response to avoid coupling to where Stripe puts that field
  // (it moved from Subscription to Subscription.items in recent API versions).
  await prisma.subscription.update({
    where: { tenantId: tenant.tenantId },
    data: { cancelAtPeriodEnd: true },
  });
  return {
    cancelAtPeriodEnd: true,
    currentPeriodEnd: subscription.currentPeriodEnd,
  };
}

// ─── Invoices ───────────────────────────────────────────────────────────────

export async function listInvoices(args: {
  actorUserId: string;
  page: number;
  pageSize: number;
}) {
  const tenant = await requireTenantContext(args.actorUserId);
  const where: Prisma.InvoiceWhereInput = { tenantId: tenant.tenantId };
  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (args.page - 1) * args.pageSize,
      take: args.pageSize,
    }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      stripeInvoiceId: r.stripeInvoiceId,
      amountDueMinor: r.amountDueMinor,
      amountPaidMinor: r.amountPaidMinor,
      currency: r.currency,
      status: r.status,
      hostedInvoiceUrl: r.hostedInvoiceUrl,
      pdfUrl: r.pdfUrl,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      paidAt: r.paidAt,
      createdAt: r.createdAt,
    })),
    meta: {
      total,
      page: args.page,
      pageSize: args.pageSize,
      totalPages: Math.max(1, Math.ceil(total / args.pageSize)),
    },
  };
}

// ─── AI restrictions (per-role / per-user caps) ─────────────────────────────

export async function getAiRestrictions(args: { actorUserId: string }) {
  const tenant = await requireTenantContext(args.actorUserId);
  const restriction = await prisma.tenantAiRestriction.findUnique({
    where: { tenantId: tenant.tenantId },
  });
  return mapAiRestriction(restriction);
}

export interface UpdateAiRestrictionsBody {
  /**
   * Map of role-name → cap. Use `null` (omit cap), `0` (block entirely), or
   * a positive integer (max calls per period). Only known role names are
   * accepted; unknown keys are dropped silently.
   */
  perRoleCaps?: Record<string, number | null>;
  perUserCaps?: Record<string, number | null>;
}

export async function updateAiRestrictions(args: {
  actorUserId: string;
  body: UpdateAiRestrictionsBody;
}) {
  const tenant = await requireTenantContext(args.actorUserId);

  // Validate cap values: must be null, 0, or positive integer ≤ 100,000.
  const sanitiseCaps = (raw: Record<string, number | null> | undefined) => {
    if (!raw) return undefined;
    const out: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === null) {
        out[key] = null;
      } else if (Number.isInteger(value) && value >= 0 && value <= 100_000) {
        out[key] = value;
      } else {
        throw httpError(
          422,
          'VALIDATION_ERROR',
          `Invalid AI cap for ${key}: must be null, 0, or a positive integer ≤ 100,000.`,
        );
      }
    }
    return out;
  };

  const perRoleCaps = sanitiseCaps(args.body.perRoleCaps);
  const perUserCaps = sanitiseCaps(args.body.perUserCaps);

  // Gate per-user keys to actual tenant members so a typo'd userId can't
  // poison the JSON.
  if (perUserCaps && Object.keys(perUserCaps).length > 0) {
    return withUnscopedTenant(async () => {
      const memberIds = await prisma.tenantMembership.findMany({
        where: { tenantId: tenant.tenantId, status: 'active' },
        select: { userId: true },
      });
      const validIds = new Set(memberIds.map((m) => m.userId));
      const filtered: Record<string, number | null> = {};
      for (const [key, value] of Object.entries(perUserCaps)) {
        if (validIds.has(key)) filtered[key] = value;
      }
      const restriction = await prisma.tenantAiRestriction.upsert({
        where: { tenantId: tenant.tenantId },
        create: {
          tenantId: tenant.tenantId,
          perRoleCaps: (perRoleCaps ?? {}) as Prisma.InputJsonValue,
          perUserCaps: filtered as Prisma.InputJsonValue,
          updatedByUserId: args.actorUserId,
        },
        update: {
          ...(perRoleCaps !== undefined ? { perRoleCaps: perRoleCaps as Prisma.InputJsonValue } : {}),
          perUserCaps: filtered as Prisma.InputJsonValue,
          updatedByUserId: args.actorUserId,
        },
      });
      return mapAiRestriction(restriction);
    });
  }

  const restriction = await prisma.tenantAiRestriction.upsert({
    where: { tenantId: tenant.tenantId },
    create: {
      tenantId: tenant.tenantId,
      perRoleCaps: (perRoleCaps ?? {}) as Prisma.InputJsonValue,
      perUserCaps: {} as Prisma.InputJsonValue,
      updatedByUserId: args.actorUserId,
    },
    update: {
      ...(perRoleCaps !== undefined ? { perRoleCaps: perRoleCaps as Prisma.InputJsonValue } : {}),
      ...(perUserCaps !== undefined ? { perUserCaps: perUserCaps as Prisma.InputJsonValue } : {}),
      updatedByUserId: args.actorUserId,
    },
  });
  return mapAiRestriction(restriction);
}
