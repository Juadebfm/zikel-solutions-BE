/**
 * Phase 7.8 — admin billing service. Zikel platform staff visibility into
 * tenant subscriptions, billing event history, and the support-escalation
 * override that bypasses enforcement for a fixed window.
 *
 * All cross-tenant queries run inside `withUnscopedTenant`. Override actions
 * are doubly logged — both `PlatformAuditLog` (who did what to whom) and
 * `BillingEvent` (machine-readable billing trail).
 */

import { AuditAction, BillingEventKind, Prisma } from '@prisma/client';
import { httpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { withUnscopedTenant } from '../../lib/request-context.js';
import { creditTopUp } from '../../lib/quota.js';

// ─── Listing ────────────────────────────────────────────────────────────────

export interface ListSubscriptionsArgs {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
}

export async function listSubscriptionsForPlatform(args: ListSubscriptionsArgs) {
  const where: Prisma.SubscriptionWhereInput = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (args.status) where.status = args.status as any;
  if (args.search) {
    where.tenant = {
      OR: [
        { name: { contains: args.search, mode: 'insensitive' } },
        { slug: { contains: args.search, mode: 'insensitive' } },
      ],
    };
  }

  return withUnscopedTenant(async () => {
    const [total, rows] = await Promise.all([
      prisma.subscription.count({ where }),
      prisma.subscription.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (args.page - 1) * args.pageSize,
        take: args.pageSize,
        select: {
          id: true,
          tenantId: true,
          status: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          trialEndsAt: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          pastDueSince: true,
          manuallyOverriddenUntil: true,
          createdAt: true,
          updatedAt: true,
          tenant: { select: { name: true, slug: true, country: true, isActive: true } },
          plan: { select: { code: true, name: true, interval: true, unitAmountMinor: true } },
        },
      }),
    ]);
    return {
      data: rows,
      meta: {
        total,
        page: args.page,
        pageSize: args.pageSize,
        totalPages: Math.max(1, Math.ceil(total / args.pageSize)),
      },
    };
  });
}

// ─── Detail ─────────────────────────────────────────────────────────────────

export async function getSubscriptionDetailForPlatform(args: { tenantId: string }) {
  return withUnscopedTenant(async () => {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId: args.tenantId },
      include: {
        tenant: { select: { name: true, slug: true, country: true, isActive: true } },
        plan: true,
      },
    });
    if (!subscription) {
      throw httpError(404, 'SUBSCRIPTION_NOT_FOUND', 'No subscription found for that tenant.');
    }
    const [recentInvoices, paymentMethods, allocation] = await Promise.all([
      prisma.invoice.findMany({
        where: { tenantId: args.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.paymentMethod.findMany({
        where: { tenantId: args.tenantId },
        orderBy: { isDefault: 'desc' },
      }),
      prisma.tokenAllocation.findFirst({
        where: { tenantId: args.tenantId },
        orderBy: { periodStart: 'desc' },
      }),
    ]);
    return {
      subscription,
      recentInvoices,
      paymentMethods,
      currentAllocation: allocation,
    };
  });
}

// ─── Manual override (support escalation) ──────────────────────────────────

export interface OverrideArgs {
  platformUserId: string;
  tenantId: string;
  extendTrialDays?: number;
  grantFullAccessUntil?: Date;
  addBonusCalls?: number;
  reason: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function applySubscriptionOverride(args: OverrideArgs) {
  return withUnscopedTenant(async () => {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId: args.tenantId },
    });
    if (!subscription) {
      throw httpError(404, 'SUBSCRIPTION_NOT_FOUND', 'No subscription found for that tenant.');
    }

    const updates: Prisma.SubscriptionUpdateInput = {};
    let newTrialEndsAt: Date | null = null;
    let newOverrideUntil: Date | null = null;

    if (args.extendTrialDays && args.extendTrialDays > 0) {
      const baseTrialEnd = subscription.trialEndsAt ?? new Date();
      newTrialEndsAt = new Date(
        Math.max(baseTrialEnd.getTime(), Date.now()) + args.extendTrialDays * 86_400_000,
      );
      updates.trialEndsAt = newTrialEndsAt;
      // Move tenant back to trialing if it isn't already in an allowing state.
      const allowingStates = new Set(['trialing', 'active', 'past_due_grace']);
      if (!allowingStates.has(subscription.status)) {
        updates.status = 'trialing';
      }
    }

    if (args.grantFullAccessUntil) {
      newOverrideUntil = args.grantFullAccessUntil;
      updates.manuallyOverriddenUntil = args.grantFullAccessUntil;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.subscription.update({
        where: { tenantId: args.tenantId },
        data: updates,
      });
      // Mirror the cached status if we changed it.
      if (updates.status) {
        await prisma.tenant.update({
          where: { id: args.tenantId },
          data: { subscriptionStatus: updates.status as Prisma.EnumSubscriptionStatusFieldUpdateOperationsInput },
        });
      }
    }

    if (args.addBonusCalls && args.addBonusCalls > 0) {
      await creditTopUp({
        tenantId: args.tenantId,
        calls: args.addBonusCalls,
        reasonRef: `admin_override:${args.platformUserId}`,
      });
    }

    // Dual audit: PlatformAuditLog (cross-tenant action by Zikel staff) +
    // BillingEvent (billing-state machine trail).
    await Promise.all([
      prisma.platformAuditLog.create({
        data: {
          platformUserId: args.platformUserId,
          action: AuditAction.permission_changed,
          targetTenantId: args.tenantId,
          entityType: 'subscription',
          entityId: subscription.id,
          metadata: {
            event: 'manual_admin_override',
            extendTrialDays: args.extendTrialDays ?? null,
            grantFullAccessUntil: args.grantFullAccessUntil?.toISOString() ?? null,
            addBonusCalls: args.addBonusCalls ?? null,
            reason: args.reason,
          },
          ipAddress: args.ipAddress ?? null,
          userAgent: args.userAgent ?? null,
        },
      }).catch(() => undefined),
      prisma.billingEvent.create({
        data: {
          tenantId: args.tenantId,
          kind: BillingEventKind.manual_admin_override,
          stripeEventId: null,
          payload: {
            platformUserId: args.platformUserId,
            reason: args.reason,
            extendTrialDays: args.extendTrialDays ?? null,
            grantFullAccessUntil: args.grantFullAccessUntil?.toISOString() ?? null,
            addBonusCalls: args.addBonusCalls ?? null,
            newTrialEndsAt: newTrialEndsAt?.toISOString() ?? null,
            newOverrideUntil: newOverrideUntil?.toISOString() ?? null,
          },
        },
      }).catch(() => undefined),
    ]);

    return {
      tenantId: args.tenantId,
      trialEndsAt: newTrialEndsAt ?? subscription.trialEndsAt,
      manuallyOverriddenUntil: newOverrideUntil ?? subscription.manuallyOverriddenUntil,
      bonusCallsAdded: args.addBonusCalls ?? 0,
    };
  });
}

// ─── BillingEvent listing ───────────────────────────────────────────────────

export interface ListEventsArgs {
  page: number;
  pageSize: number;
  tenantId?: string;
  kind?: BillingEventKind;
  fromDate?: Date;
  toDate?: Date;
}

export async function listBillingEvents(args: ListEventsArgs) {
  const where: Prisma.BillingEventWhereInput = {};
  if (args.tenantId) where.tenantId = args.tenantId;
  if (args.kind) where.kind = args.kind;
  if (args.fromDate || args.toDate) {
    where.receivedAt = {};
    if (args.fromDate) where.receivedAt.gte = args.fromDate;
    if (args.toDate) where.receivedAt.lte = args.toDate;
  }

  return withUnscopedTenant(async () => {
    const [total, rows] = await Promise.all([
      prisma.billingEvent.count({ where }),
      prisma.billingEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (args.page - 1) * args.pageSize,
        take: args.pageSize,
        select: {
          id: true,
          tenantId: true,
          kind: true,
          stripeEventId: true,
          processedAt: true,
          processingError: true,
          receivedAt: true,
        },
      }),
    ]);
    return {
      data: rows,
      meta: {
        total,
        page: args.page,
        pageSize: args.pageSize,
        totalPages: Math.max(1, Math.ceil(total / args.pageSize)),
      },
    };
  });
}
