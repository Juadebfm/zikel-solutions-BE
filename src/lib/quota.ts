/**
 * Phase 7.4 — token-metering quota machinery.
 *
 * **Hybrid model** (locked in payment.md):
 *   1. Tenant has a SHARED POOL: `bundledCalls + topUpCalls - usedCalls`
 *      remaining for the current period.
 *   2. Tenant Owner can OPTIONALLY enforce per-role and/or per-user caps as
 *      additional restrictions. Caps are MONTHLY limits drawn FROM the pool —
 *      they don't add to it.
 *
 * **Atomicity contract:**
 *   - `requireAvailableQuota` is read-only. It reports current state.
 *   - `debitQuota` is the only mutation. It runs ONE transaction with the
 *     pool counter increment + ledger entry insert. The two are in lockstep
 *     so the ledger is the source of truth and `usedCalls` is its denormalised
 *     cache.
 *
 * **Race tradeoff:** The check (`requireAvailableQuota`) and the AI call
 * happen sequentially. If the AI call takes 10 seconds and another debit
 * lands during that window, the user might overrun the quota by 1 — we don't
 * hold a transaction across an external HTTP call. Cost ceiling for that is
 * a few extra calls per period (a few pence). Acceptable; the alternative is
 * blocking parallel AI calls per tenant, which would feel broken.
 */

import {
  Prisma,
  type AiCallSurface,
  type TokenLedgerEntryKind,
} from '@prisma/client';
import { httpError } from './errors.js';
import { prisma } from './prisma.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface QuotaCheckArgs {
  tenantId: string;
  userId: string;
  surface: AiCallSurface;
}

export interface QuotaSnapshot {
  allocationId: string;
  bundledCalls: number;
  topUpCalls: number;
  usedCalls: number;
  remainingCalls: number;
  periodStart: Date;
  periodEnd: Date;
  resetAt: Date;
}

// ─── Period reset helpers ───────────────────────────────────────────────────

/**
 * The CURRENT period for a tenant. If the tenant has a Subscription, we use
 * its `currentPeriodStart` / `currentPeriodEnd`. Otherwise (extreme edge: no
 * subscription row yet) we fall back to a calendar-month period anchored at
 * tenant creation. The grandfather migration (Phase 7.9) creates Subscription
 * rows for every tenant, so the fallback is only hit in tests / future
 * misconfigurations.
 */
async function getCurrentPeriod(tenantId: string): Promise<{
  periodStart: Date;
  periodEnd: Date;
  bundledCallsPerPeriod: number;
}> {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    select: {
      currentPeriodStart: true,
      currentPeriodEnd: true,
      plan: { select: { bundledCallsPerPeriod: true } },
    },
  });
  if (subscription) {
    return {
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      bundledCallsPerPeriod: subscription.plan.bundledCallsPerPeriod,
    };
  }
  // Fallback: 30-day rolling window anchored on tenant creation.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { createdAt: true },
  });
  if (!tenant) {
    throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  }
  const start = new Date(tenant.createdAt);
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  return {
    periodStart: start,
    periodEnd: end,
    bundledCallsPerPeriod: 1000,
  };
}

/**
 * Returns (creating if needed) the TokenAllocation row for the tenant's
 * current period. Idempotent — uses `upsert` keyed on (tenantId, periodStart).
 */
async function ensureCurrentAllocation(tenantId: string) {
  const period = await getCurrentPeriod(tenantId);
  return prisma.tokenAllocation.upsert({
    where: {
      tenantId_periodStart: {
        tenantId,
        periodStart: period.periodStart,
      },
    },
    create: {
      tenantId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      bundledCalls: period.bundledCallsPerPeriod,
      resetAt: period.periodEnd,
    },
    update: {},
  });
}

// ─── Read-only check ────────────────────────────────────────────────────────

/**
 * Throws on:
 *   - 402 AI_QUOTA_EXHAUSTED — pool is empty
 *   - 403 AI_DISABLED_FOR_ROLE — Owner has set this role's cap to 0
 *   - 403 AI_DISABLED_FOR_USER — Owner has set this user's cap to 0
 *   - 402 AI_USER_CAP_EXHAUSTED — user has hit their per-user / per-role cap
 *
 * Returns the current snapshot so the caller can include `remainingCalls`,
 * `resetAt`, etc. in success responses (handy for FE banners).
 *
 * Caller is responsible for calling `debitQuota` AFTER a successful AI call.
 * If the AI call fails, caller still debits (no free-retry abuse) — see
 * payment.md risk register.
 */
export async function requireAvailableQuota(
  args: QuotaCheckArgs,
): Promise<QuotaSnapshot> {
  const allocation = await ensureCurrentAllocation(args.tenantId);

  // Pool exhaustion check first — cheapest and most common reject path.
  const remaining = allocation.bundledCalls + allocation.topUpCalls - allocation.usedCalls;
  if (remaining <= 0) {
    throw httpError(
      402,
      'AI_QUOTA_EXHAUSTED',
      'AI quota exhausted for this period. Add a top-up pack from Settings → Billing.',
    );
  }

  // Per-role / per-user cap checks.
  const restriction = await prisma.tenantAiRestriction.findUnique({
    where: { tenantId: args.tenantId },
    select: { perRoleCaps: true, perUserCaps: true },
  });
  if (restriction) {
    const perRoleCaps = (restriction.perRoleCaps ?? {}) as Record<string, number | null>;
    const perUserCaps = (restriction.perUserCaps ?? {}) as Record<string, number | null>;

    // Per-user override wins over per-role.
    const userCap = perUserCaps[args.userId];
    if (userCap === 0) {
      throw httpError(
        403,
        'AI_DISABLED_FOR_USER',
        'AI access has been disabled for your account by your administrator.',
      );
    }
    if (typeof userCap === 'number' && userCap > 0) {
      const userUsage = await getUserUsageInPeriod({
        tenantId: args.tenantId,
        userId: args.userId,
        periodStart: allocation.periodStart,
      });
      if (userUsage >= userCap) {
        throw httpError(
          402,
          'AI_USER_CAP_EXHAUSTED',
          `You have used your monthly AI allowance (${userCap} calls). Resets ${allocation.resetAt.toISOString()}.`,
        );
      }
    } else {
      // No per-user cap — check role cap.
      const roleName = await getRoleNameForUser(args.tenantId, args.userId);
      const roleCap = roleName ? perRoleCaps[roleName] : null;
      if (roleCap === 0) {
        throw httpError(
          403,
          'AI_DISABLED_FOR_ROLE',
          'AI access is not available for your role.',
        );
      }
      if (typeof roleCap === 'number' && roleCap > 0) {
        const userUsage = await getUserUsageInPeriod({
          tenantId: args.tenantId,
          userId: args.userId,
          periodStart: allocation.periodStart,
        });
        if (userUsage >= roleCap) {
          throw httpError(
            402,
            'AI_USER_CAP_EXHAUSTED',
            `You have used your role's monthly AI allowance (${roleCap} calls). Resets ${allocation.resetAt.toISOString()}.`,
          );
        }
      }
    }
  }

  return {
    allocationId: allocation.id,
    bundledCalls: allocation.bundledCalls,
    topUpCalls: allocation.topUpCalls,
    usedCalls: allocation.usedCalls,
    remainingCalls: remaining,
    periodStart: allocation.periodStart,
    periodEnd: allocation.periodEnd,
    resetAt: allocation.resetAt,
  };
}

async function getUserUsageInPeriod(args: {
  tenantId: string;
  userId: string;
  periodStart: Date;
}): Promise<number> {
  const result = await prisma.tokenLedgerEntry.aggregate({
    where: {
      tenantId: args.tenantId,
      userId: args.userId,
      createdAt: { gte: args.periodStart },
      // Sum negative deltas only — credits aren't user-attributed.
      delta: { lt: 0 },
    },
    _sum: { delta: true },
  });
  // delta is negative; usage = absolute value of the sum.
  return Math.abs(result._sum.delta ?? 0);
}

async function getRoleNameForUser(tenantId: string, userId: string): Promise<string | null> {
  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantId, userId, status: 'active' },
    select: { role: { select: { name: true } } },
  });
  return membership?.role.name ?? null;
}

// ─── Debit ──────────────────────────────────────────────────────────────────

/**
 * Atomic single-call debit. Increments `usedCalls` AND inserts a ledger row
 * in one transaction. Should be called immediately after the AI call resolves
 * (success or fallback).
 *
 * Surface → ledger kind mapping is intrinsic; we never accept a `kind`
 * directly from the caller to avoid mis-classification.
 */
export async function debitQuota(args: {
  tenantId: string;
  userId: string;
  allocationId: string;
  surface: AiCallSurface;
  reasonRef?: string;
}): Promise<void> {
  const kind: TokenLedgerEntryKind = surfaceToDebitKind(args.surface);
  await prisma.$transaction([
    prisma.tokenAllocation.update({
      where: { id: args.allocationId },
      data: { usedCalls: { increment: 1 } },
    }),
    prisma.tokenLedgerEntry.create({
      data: {
        tenantId: args.tenantId,
        allocationId: args.allocationId,
        userId: args.userId,
        kind,
        delta: -1,
        reasonRef: args.reasonRef ?? null,
      },
    }),
  ]);
}

function surfaceToDebitKind(surface: AiCallSurface): TokenLedgerEntryKind {
  switch (surface) {
    case 'chat':
      return 'debit_chat';
    case 'chat_title':
      return 'debit_chat_title';
    case 'dashboard_card':
      return 'debit_dashboard_card';
    case 'chronology_narrative':
      return 'debit_chronology_narrative';
  }
}

// ─── Top-up credit ──────────────────────────────────────────────────────────

/**
 * Adds top-up calls to the tenant's CURRENT allocation. Wired from the
 * Stripe webhook handler when `checkout.session.completed` (mode=payment)
 * arrives with `metadata.kind=topup`.
 *
 * `reasonRef` should be the Stripe Invoice ID or Checkout Session ID for
 * traceability.
 */
export async function creditTopUp(args: {
  tenantId: string;
  calls: number;
  reasonRef: string;
}): Promise<void> {
  if (args.calls <= 0) {
    throw new Error('creditTopUp: calls must be positive.');
  }
  const allocation = await ensureCurrentAllocation(args.tenantId);
  await prisma.$transaction([
    prisma.tokenAllocation.update({
      where: { id: allocation.id },
      data: { topUpCalls: { increment: args.calls } },
    }),
    prisma.tokenLedgerEntry.create({
      data: {
        tenantId: args.tenantId,
        allocationId: allocation.id,
        userId: null,
        kind: 'credit_topup',
        delta: args.calls,
        reasonRef: args.reasonRef,
      },
    }),
  ]);
}

// ─── Period reset (cron) ────────────────────────────────────────────────────

/**
 * Walks `TokenAllocation` rows whose `resetAt` has passed and creates the
 * next period's allocation. The expired allocation is left in place for
 * historical accounting (do NOT delete — it's needed for ledger lookups).
 *
 * Called from the scheduler in Phase 7.7.
 *
 * Returns counts so callers can log telemetry.
 */
export async function resetExpiredAllocations(now: Date = new Date()): Promise<{
  scanned: number;
  created: number;
}> {
  const expired = await prisma.tokenAllocation.findMany({
    where: { resetAt: { lte: now } },
    select: { id: true, tenantId: true },
  });
  let created = 0;
  for (const row of expired) {
    const period = await getCurrentPeriod(row.tenantId);
    // If the next period hasn't actually started yet (shouldn't happen but
    // defensive), skip.
    if (period.periodStart <= now && period.periodEnd > now) {
      try {
        await prisma.$transaction(async (tx) => {
          const next = await tx.tokenAllocation.upsert({
            where: {
              tenantId_periodStart: {
                tenantId: row.tenantId,
                periodStart: period.periodStart,
              },
            },
            create: {
              tenantId: row.tenantId,
              periodStart: period.periodStart,
              periodEnd: period.periodEnd,
              bundledCalls: period.bundledCallsPerPeriod,
              resetAt: period.periodEnd,
            },
            update: {},
          });
          await tx.tokenLedgerEntry.create({
            data: {
              tenantId: row.tenantId,
              allocationId: next.id,
              userId: null,
              kind: 'credit_period_reset',
              delta: period.bundledCallsPerPeriod,
              reasonRef: `allocation:${next.id}`,
            },
          });
        });
        created += 1;
      } catch (err) {
        // Ignore individual failures — best-effort. Logged by the caller.
        void err;
      }
    }
  }
  return { scanned: expired.length, created };
}

// ─── Read-only snapshot for the FE quota panel ──────────────────────────────

/**
 * Builds the data shape consumed by `GET /api/v1/billing/quota`. Includes
 * pool numbers + per-user usage breakdown + the per-role/per-user cap config
 * so the FE can show a usage table and the Owner can see "who's heavy".
 */
export async function getQuotaSnapshotForTenant(args: { tenantId: string }) {
  const allocation = await ensureCurrentAllocation(args.tenantId);
  const restriction = await prisma.tenantAiRestriction.findUnique({
    where: { tenantId: args.tenantId },
    select: { perRoleCaps: true, perUserCaps: true },
  });

  // Per-user usage breakdown for the current period.
  const userUsage = await prisma.tokenLedgerEntry.groupBy({
    by: ['userId'],
    where: {
      tenantId: args.tenantId,
      createdAt: { gte: allocation.periodStart },
      delta: { lt: 0 },
    },
    _sum: { delta: true },
  });

  // Hydrate user names for the rows that have a userId set.
  const userIds = userUsage
    .map((u) => u.userId)
    .filter((id): id is string => Boolean(id));
  const users = userIds.length
    ? await prisma.tenantUser.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          tenantMemberships: {
            where: { tenantId: args.tenantId },
            select: { role: { select: { name: true } } },
            take: 1,
          },
        },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return {
    allocationId: allocation.id,
    bundledCalls: allocation.bundledCalls,
    topUpCalls: allocation.topUpCalls,
    usedCalls: allocation.usedCalls,
    remainingCalls:
      allocation.bundledCalls + allocation.topUpCalls - allocation.usedCalls,
    periodStart: allocation.periodStart,
    periodEnd: allocation.periodEnd,
    resetAt: allocation.resetAt,
    perUserUsage: userUsage
      .filter((u) => u.userId)
      .map((u) => {
        const user = userById.get(u.userId!);
        return {
          userId: u.userId!,
          name: user
            ? `${user.firstName} ${user.lastName}`.trim()
            : '(unknown user)',
          email: user?.email ?? null,
          role: user?.tenantMemberships[0]?.role.name ?? null,
          callsThisPeriod: Math.abs(u._sum.delta ?? 0),
        };
      }),
    restrictions: {
      perRoleCaps: (restriction?.perRoleCaps ?? {}) as Prisma.JsonValue,
      perUserCaps: (restriction?.perUserCaps ?? {}) as Prisma.JsonValue,
    },
  };
}
