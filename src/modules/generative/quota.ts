/**
 * Quota machinery for generative summaries.
 *
 * Generative summaries consume two budgets simultaneously:
 *   1. The shared AI token pool (TokenAllocation.bundledCalls + topUpCalls).
 *      Each summary debits SUMMARY_TOKEN_MULTIPLIER call-equivalents.
 *   2. A surface-specific cap on Plan.summariesIncludedPerPeriod, counted
 *      from GenerativeArtifact rows in the current period. This stops a
 *      tenant from torching their entire `/ai/ask` budget on summarisation
 *      and gives marketing a clear "X summaries included" number to publish.
 *
 * Group tier has `summariesIncludedPerPeriod = null` and is uncapped here.
 * The shared pool still applies (a 50k bundle isn't infinite either) but
 * Group customers usually negotiate enough headroom that it doesn't bite.
 */

import { GenerativeArtifactType, TokenLedgerEntryKind } from '@prisma/client';
import { httpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { ensureCurrentAllocation } from '../../lib/quota.js';

/**
 * Each generated summary costs this many call-equivalents from the shared
 * pool. Calibrated to the empirical token cost ratio (summaries run ~25× the
 * tokens of a single /ai/ask call). Tighten or relax after Day-30 review.
 */
export const SUMMARY_TOKEN_MULTIPLIER = 25;

interface SummaryQuotaSnapshot {
  allocationId: string;
  bundledCalls: number;
  topUpCalls: number;
  usedCalls: number;
  remainingCalls: number;
  summariesIncluded: number | null; // null = unlimited (Group)
  summariesUsed: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Read-only check: does this tenant have BOTH (a) enough pool to cover one
 * more summary (25 calls) AND (b) room under `Plan.summariesIncludedPerPeriod`?
 *
 * Throws 402 with the right code so the FE can route the user to either
 * "buy a top-up" (pool exhausted) or "upgrade your plan" (summary cap hit).
 *
 * No-op for tenants without a Subscription (dev/test). In production every
 * tenant has one post-signup — the no-op branch should never fire.
 */
export async function requireSummaryQuotaAvailable(tenantId: string): Promise<SummaryQuotaSnapshot> {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    select: { plan: { select: { summariesIncludedPerPeriod: true, code: true, name: true } } },
  });
  if (!subscription) {
    logger.warn({ msg: 'requireSummaryQuotaAvailable: no Subscription; skipping cap check', tenantId });
    // Still need a TokenAllocation for the pool side; ensure one exists.
    const allocation = await ensureCurrentAllocation(tenantId);
    return {
      allocationId: allocation.id,
      bundledCalls: allocation.bundledCalls,
      topUpCalls: allocation.topUpCalls,
      usedCalls: allocation.usedCalls,
      remainingCalls: allocation.bundledCalls + allocation.topUpCalls - allocation.usedCalls,
      summariesIncluded: null,
      summariesUsed: 0,
      periodStart: allocation.periodStart,
      periodEnd: allocation.periodEnd,
    };
  }

  const allocation = await ensureCurrentAllocation(tenantId);
  const remaining = allocation.bundledCalls + allocation.topUpCalls - allocation.usedCalls;

  // Shared-pool check first. Each summary is 25 call-equivalents, so the
  // floor is "do we have 25 calls left?"
  if (remaining < SUMMARY_TOKEN_MULTIPLIER) {
    throw httpError(
      402,
      'AI_QUOTA_EXHAUSTED',
      'Not enough AI quota remaining for a summary (each summary uses ' +
        `${SUMMARY_TOKEN_MULTIPLIER} call-equivalents). Add a top-up pack from Settings → Billing.`,
    );
  }

  // Surface-cap check. Count summaries created in the current period.
  const summariesIncluded = subscription.plan.summariesIncludedPerPeriod;
  const summariesUsed = await prisma.generativeArtifact.count({
    where: {
      tenantId,
      artifactType: GenerativeArtifactType.daily_log_summary,
      createdAt: { gte: allocation.periodStart, lt: allocation.periodEnd },
    },
  });

  if (summariesIncluded !== null && summariesUsed >= summariesIncluded) {
    throw httpError(
      402,
      'SUMMARIES_QUOTA_EXHAUSTED',
      `Monthly summary allowance reached (${summariesIncluded} included on the ` +
        `${subscription.plan.name} plan). Upgrade or wait until ${allocation.periodEnd.toISOString().slice(0, 10)}.`,
    );
  }

  return {
    allocationId: allocation.id,
    bundledCalls: allocation.bundledCalls,
    topUpCalls: allocation.topUpCalls,
    usedCalls: allocation.usedCalls,
    remainingCalls: remaining,
    summariesIncluded,
    summariesUsed,
    periodStart: allocation.periodStart,
    periodEnd: allocation.periodEnd,
  };
}

/**
 * Atomic debit for a successful (or fallback) summary generation. Increments
 * `TokenAllocation.usedCalls` by SUMMARY_TOKEN_MULTIPLIER and writes ONE
 * ledger row with the same delta.
 *
 * Mirror of the `debitQuota` pattern from `src/lib/quota.ts` but with the
 * summary-specific kind + multiplier. We don't share code with `debitQuota`
 * because adding a `multiplier` param to a hot path is the kind of footgun
 * that gets accidentally set to 25 for normal chats later.
 *
 * Called by the route handler after `createDailyLogSummaryDraft` succeeds.
 * If the artifact persist fails, no debit happens.
 */
export async function debitForSummary(args: {
  tenantId: string;
  userId: string;
  allocationId: string;
  artifactId: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.tokenAllocation.update({
      where: { id: args.allocationId },
      data: { usedCalls: { increment: SUMMARY_TOKEN_MULTIPLIER } },
    }),
    prisma.tokenLedgerEntry.create({
      data: {
        tenantId: args.tenantId,
        allocationId: args.allocationId,
        userId: args.userId,
        kind: TokenLedgerEntryKind.debit_generative_summary,
        delta: -SUMMARY_TOKEN_MULTIPLIER,
        reasonRef: `summary:${args.artifactId}`,
      },
    }),
  ]);
}
