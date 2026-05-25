/**
 * Per-bed billing quantity sync.
 *
 * In the tiered billing model (Single Home / Multi-Home), each tenant's
 * Stripe subscription line item has a `quantity` that mirrors the tenant's
 * total bed count (sum of `Home.capacity` across active homes). Stripe bills
 * `quantity × pricePerBedMinor / 100` per month and prorates mid-cycle changes.
 *
 * Sync triggers (called from homes.service.ts):
 *   - createHome
 *   - updateHome (when capacity or isActive changes)
 *
 * The Group tier is sales-led and has no Stripe subscription, so sync is a
 * no-op there. Same for tenants still in trial without a Stripe subscription id.
 *
 * Failures are logged but never thrown — bed-count sync is eventual-consistency
 * by design, and a Stripe outage must not break tenant-facing home mutations.
 */

import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getStripeClient } from '../../lib/stripe.js';

/**
 * Compute the active bed count for a tenant by summing `Home.capacity` across
 * all active homes. Homes with null capacity (not yet configured) contribute 0.
 *
 * Minimum return value is 1 — Stripe requires a positive subscription item
 * quantity. A £7 floor while a tenant configures their first home is acceptable
 * product behaviour and removes a class of edge cases ("0-bed subscriptions").
 */
export async function getTenantBedCount(tenantId: string): Promise<number> {
  const agg = await prisma.home.aggregate({
    where: { tenantId, isActive: true },
    _sum: { capacity: true },
  });
  return Math.max(1, agg._sum.capacity ?? 0);
}

/**
 * Recompute the tenant's bed count and push it to their Stripe subscription
 * line item's `quantity` field. Idempotent; safe to call repeatedly.
 *
 * No-op when:
 *   - No Subscription row exists yet (pre-checkout)
 *   - Subscription has no `stripeSubscriptionId` (trial-only, never paid)
 *   - bedCount hasn't changed since the last sync (`bedCountSnapshot` equals)
 *
 * Always updates `bedCountSnapshot` on the local Subscription row so that
 * forensic queries reflect the latest known count even when no Stripe push
 * was needed.
 */
export async function syncStripeSubscriptionQuantity(tenantId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    select: {
      id: true,
      stripeSubscriptionId: true,
      bedCountSnapshot: true,
    },
  });

  const beds = await getTenantBedCount(tenantId);

  if (!subscription) return;

  // No Stripe subscription to update — just keep the local snapshot fresh.
  if (!subscription.stripeSubscriptionId) {
    if (subscription.bedCountSnapshot !== beds) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { bedCountSnapshot: beds },
      });
    }
    return;
  }

  // Skip the Stripe round-trip if nothing changed.
  if (subscription.bedCountSnapshot === beds) return;

  const stripe = getStripeClient();
  if (!stripe) {
    logger.warn({
      msg: 'syncStripeSubscriptionQuantity: Stripe client unavailable; skipping push',
      tenantId,
    });
    return;
  }

  try {
    // Each Stripe subscription has exactly one item (the tier price).
    const sub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const item = sub.items.data[0];
    if (!item) {
      logger.warn({
        msg: 'syncStripeSubscriptionQuantity: Stripe subscription has no items',
        tenantId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      });
      return;
    }

    await stripe.subscriptionItems.update(item.id, {
      quantity: beds,
      proration_behavior: 'create_prorations',
    });

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        bedCountSnapshot: beds,
        lastUsageReportedAt: new Date(),
      },
    });
  } catch (err) {
    logger.error({
      msg: 'syncStripeSubscriptionQuantity: Stripe push failed',
      tenantId,
      err: err instanceof Error ? err.message : 'unknown',
    });
  }
}
