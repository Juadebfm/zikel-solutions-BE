/**
 * Phase 7.7c — past-due transition cron.
 *
 * Stripe says "past_due" but doesn't tell us how many days have elapsed —
 * that windowing is OUR logic. This scheduler walks `Subscription` rows with
 * `pastDueSince` set and moves them through:
 *
 *   pastDueSince + 0–3 days   → past_due_grace      (no-op; status already correct)
 *   pastDueSince + 3–14 days  → past_due_readonly
 *   pastDueSince + 14+ days   → suspended           (also flips Tenant.isActive=false)
 *
 * Each transition writes a `BillingEvent` row so we can audit how a tenant
 * arrived at suspended state. The Stripe webhook reverses these transitions
 * via `invoice.paid` when payment recovers.
 */

import type { SubscriptionStatus } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { suspendTenant } from '../admin/admin-tenants.service.js';
import { deriveSubscriptionStatus } from './webhook.service.js';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly

/**
 * Looks at all subscriptions with `pastDueSince` set and recomputes their
 * status against the elapsed time. Transitions to a more-restrictive state
 * (grace → readonly → suspended) trigger writes; non-transitions are no-op.
 *
 * Returns counts so callers can log telemetry. Suitable for both scheduled
 * runs and manual ops invocation.
 */
export async function runPastDueTransitionPass(now: Date = new Date()): Promise<{
  scanned: number;
  transitioned: number;
  suspended: number;
}> {
  const candidates = await prisma.subscription.findMany({
    where: { pastDueSince: { not: null } },
    select: {
      tenantId: true,
      status: true,
      pastDueSince: true,
    },
  });

  let transitioned = 0;
  let suspended = 0;

  for (const row of candidates) {
    if (!row.pastDueSince) continue; // type guard
    const newStatus: SubscriptionStatus = deriveSubscriptionStatus({
      stripeStatus: 'past_due',
      pastDueSince: row.pastDueSince,
      now,
    });
    if (newStatus === row.status) continue;

    try {
      await prisma.$transaction([
        prisma.subscription.update({
          where: { tenantId: row.tenantId },
          data: { status: newStatus },
        }),
        prisma.tenant.update({
          where: { id: row.tenantId },
          data: { subscriptionStatus: newStatus },
        }),
        prisma.billingEvent.create({
          data: {
            tenantId: row.tenantId,
            kind:
              newStatus === 'suspended'
                ? 'subscription_deleted' // closest enum value for "auto-suspend"
                : 'subscription_updated',
            stripeEventId: null,
            payload: {
              source: 'past_due_cron',
              from: row.status,
              to: newStatus,
              pastDueSince: row.pastDueSince.toISOString(),
              now: now.toISOString(),
            },
          },
        }),
      ]);
      transitioned += 1;

      if (newStatus === 'suspended') {
        // Hard-suspend the tenant via Phase 6 mechanism. This revokes all
        // active sessions + refresh tokens transactionally. Best-effort: if
        // it fails, the subscription is already marked suspended — Owner
        // can still log in until tokens expire.
        try {
          await suspendTenant({
            // No actor — system did this. Use a sentinel platform id so the
            // PlatformAuditLog FK accepts it. Same pattern as risk-alerts cron.
            platformUserId: 'system_past_due_cron',
            tenantId: row.tenantId,
            reason: 'Subscription past due > 14 days. Auto-suspended by past-due cron.',
          });
          suspended += 1;
        } catch (err) {
          logger.warn({
            msg: 'past_due_cron: suspendTenant failed (status flipped, but session revoke skipped)',
            tenantId: row.tenantId,
            err: err instanceof Error ? err.message : 'unknown',
          });
        }
      }
    } catch (err) {
      logger.warn({
        msg: 'past_due_cron: transition failed',
        tenantId: row.tenantId,
        from: row.status,
        to: newStatus,
        err: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return { scanned: candidates.length, transitioned, suspended };
}

// ─── Scheduler hook ─────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;

/**
 * Starts the past-due cron. Returns a stop function for use in graceful
 * shutdown (`onClose` hook). No-op in test env so tests don't get spurious
 * background DB writes. Runs once on startup so a freshly-deployed instance
 * picks up any in-flight transitions immediately.
 */
export function startPastDueScheduler(): () => void {
  if (env.NODE_ENV === 'test') {
    return () => {};
  }
  // Fire once on boot, then every hour.
  void runPastDueTransitionPass()
    .then((result) => {
      if (result.scanned > 0 || result.transitioned > 0) {
        logger.info({ msg: 'past_due_cron: startup pass', ...result });
      }
    })
    .catch((err) => {
      logger.warn({
        msg: 'past_due_cron: startup pass failed',
        err: err instanceof Error ? err.message : 'unknown',
      });
    });

  timer = setInterval(() => {
    void runPastDueTransitionPass()
      .then((result) => {
        if (result.transitioned > 0 || result.suspended > 0) {
          logger.info({ msg: 'past_due_cron: hourly pass', ...result });
        }
      })
      .catch((err) => {
        logger.warn({
          msg: 'past_due_cron: hourly pass failed',
          err: err instanceof Error ? err.message : 'unknown',
        });
      });
  }, DEFAULT_INTERVAL_MS);

  return () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
