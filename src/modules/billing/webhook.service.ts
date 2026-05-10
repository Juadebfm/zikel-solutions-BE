/**
 * Phase 7.6 — Stripe webhook event dispatcher.
 *
 * Every inbound Stripe event runs through `handleStripeEvent`. The route
 * layer (Phase 7.6 routes) is responsible for:
 *   1. Verifying the `Stripe-Signature` header (`verifyWebhookSignature`)
 *   2. Idempotency-recording the event (`recordWebhookEventOnce`)
 *   3. Calling THIS dispatcher with the verified event + the BillingEvent row id
 *   4. Marking processed/failed
 *
 * Each per-event handler is wrapped in try/catch at the route layer so a
 * single bad handler never causes Stripe to retry indefinitely. This file
 * stays handler-shape: it throws on internal errors and the caller decides.
 */

import type Stripe from 'stripe';
import {
  Prisma,
  type SubscriptionStatus,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { creditTopUp } from '../../lib/quota.js';

// ─── Status mapping ─────────────────────────────────────────────────────────

const PAST_DUE_GRACE_DAYS = 3;
const PAST_DUE_READONLY_DAYS = 14;

/**
 * Maps Stripe's `subscription.status` plus our local `pastDueSince` clock to
 * our `SubscriptionStatus`. Stripe says "past_due"; our 3/14-day windowing
 * is OUR logic, not Stripe's.
 *
 *   trialing                                 → trialing
 *   active                                   → active
 *   past_due (< 3 days since first failure)  → past_due_grace
 *   past_due (3-14 days)                     → past_due_readonly
 *   past_due (> 14 days) OR unpaid           → suspended
 *   canceled                                 → cancelled
 *   incomplete / incomplete_expired          → incomplete / cancelled
 */
export function deriveSubscriptionStatus(args: {
  stripeStatus: Stripe.Subscription.Status;
  pastDueSince: Date | null;
  now?: Date;
}): SubscriptionStatus {
  const { stripeStatus } = args;
  const now = args.now ?? new Date();

  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due': {
      if (!args.pastDueSince) return 'past_due_grace';
      const daysSince = (now.getTime() - args.pastDueSince.getTime()) / 86_400_000;
      if (daysSince < PAST_DUE_GRACE_DAYS) return 'past_due_grace';
      if (daysSince < PAST_DUE_READONLY_DAYS) return 'past_due_readonly';
      return 'suspended';
    }
    case 'unpaid':
      return 'suspended';
    case 'canceled':
      return 'cancelled';
    case 'incomplete':
      return 'incomplete';
    case 'incomplete_expired':
      return 'cancelled';
    case 'paused':
      // Stripe `paused` is for usage-based billing freezes — not a state we
      // currently use, but treat as readonly until a product decision is made.
      return 'past_due_readonly';
  }
}

// ─── Helpers — Stripe period fields ─────────────────────────────────────────

/**
 * In recent Stripe API versions `current_period_start` / `current_period_end`
 * moved off the `Subscription` object onto each `SubscriptionItem`. We read
 * from the first item; the SDK may also still surface them on the parent in
 * earlier API versions, so we fall back if the item path is missing.
 */
function readPeriodFromSubscription(sub: Stripe.Subscription): {
  start: Date;
  end: Date;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anySub = sub as any;
  const item = sub.items?.data?.[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyItem = item as any;
  const startSec = anyItem?.current_period_start ?? anySub?.current_period_start;
  const endSec = anyItem?.current_period_end ?? anySub?.current_period_end;
  if (typeof startSec !== 'number' || typeof endSec !== 'number') {
    // Stripe should always send these fields for recurring subscriptions.
    // If we ever see this, fall back to "now → 30 days" so we don't crash.
    const now = new Date();
    const fallback = new Date(now);
    fallback.setDate(fallback.getDate() + 30);
    logger.warn({
      msg: 'Stripe subscription missing period timestamps',
      subscriptionId: sub.id,
    });
    return { start: now, end: fallback };
  }
  return { start: new Date(startSec * 1000), end: new Date(endSec * 1000) };
}

async function lookupTenantIdForCustomer(stripeCustomerId: string): Promise<string | null> {
  const sub = await prisma.subscription.findFirst({
    where: { stripeCustomerId },
    select: { tenantId: true },
  });
  return sub?.tenantId ?? null;
}

// ─── Subscription state sync (the main handler) ─────────────────────────────

/**
 * Upserts our `Subscription` row from Stripe state. Used by:
 *   - `customer.subscription.created`
 *   - `customer.subscription.updated`
 *   - `customer.subscription.deleted`
 *
 * Also mirrors `Tenant.subscriptionStatus` so the enforcement middleware can
 * read it on every request without a join.
 */
async function syncSubscriptionFromStripe(args: {
  stripeSubscription: Stripe.Subscription;
}): Promise<{ tenantId: string | null }> {
  const sub = args.stripeSubscription;
  const stripeCustomerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  // Resolve tenantId from metadata (set in Checkout) or from existing row.
  let tenantId: string | null = sub.metadata?.tenantId ?? null;
  if (!tenantId) {
    tenantId = await lookupTenantIdForCustomer(stripeCustomerId);
  }
  if (!tenantId) {
    logger.warn({
      msg: 'Stripe subscription event has no tenantId mapping — ignoring',
      subscriptionId: sub.id,
      customerId: stripeCustomerId,
    });
    return { tenantId: null };
  }

  // Resolve plan via Stripe priceId from the first item.
  const stripePriceId = sub.items?.data?.[0]?.price?.id ?? null;
  const plan = stripePriceId
    ? await prisma.plan.findUnique({ where: { stripePriceId } })
    : null;

  const period = readPeriodFromSubscription(sub);
  const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

  const existing = await prisma.subscription.findUnique({
    where: { tenantId },
    select: { pastDueSince: true },
  });

  // Fresh past-due event: stamp `pastDueSince` on the FIRST transition to
  // `past_due`. Cleared when status returns to active/trialing.
  let pastDueSince: Date | null = existing?.pastDueSince ?? null;
  if (sub.status === 'past_due' && !pastDueSince) {
    pastDueSince = new Date();
  } else if (sub.status === 'active' || sub.status === 'trialing') {
    pastDueSince = null;
  }

  const ourStatus = deriveSubscriptionStatus({
    stripeStatus: sub.status,
    pastDueSince,
  });

  await prisma.$transaction([
    prisma.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planId: plan?.id ?? '',
        status: ourStatus,
        stripeCustomerId,
        stripeSubscriptionId: sub.id,
        trialEndsAt,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        pastDueSince,
      },
      update: {
        ...(plan ? { planId: plan.id } : {}),
        status: ourStatus,
        stripeSubscriptionId: sub.id,
        trialEndsAt,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        pastDueSince,
      },
    }),
    prisma.tenant.update({
      where: { id: tenantId },
      data: { subscriptionStatus: ourStatus },
    }),
  ]);

  return { tenantId };
}

// ─── Per-event handlers ─────────────────────────────────────────────────────

async function handleCheckoutSessionCompleted(
  event: Stripe.CheckoutSessionCompletedEvent,
  billingEventRowId: string,
): Promise<void> {
  const session = event.data.object;
  const kind = session.metadata?.kind ?? 'subscription';

  if (kind === 'topup') {
    // One-time top-up payment: credit calls into the tenant's pool.
    const tenantId = session.metadata?.tenantId;
    const calls = Number.parseInt(session.metadata?.calls ?? '0', 10);
    if (!tenantId || !Number.isFinite(calls) || calls <= 0) {
      logger.warn({
        msg: 'checkout.session.completed (topup) missing metadata — ignoring',
        sessionId: session.id,
      });
      return;
    }
    await creditTopUp({
      tenantId,
      calls,
      reasonRef: `stripe_session:${session.id}`,
    });
    await prisma.billingEvent.update({
      where: { id: billingEventRowId },
      data: {
        kind: 'topup_purchased',
        tenantId,
      },
    }).catch(() => undefined);
    return;
  }

  // Subscription mode: fetch the Subscription via stripe.subscriptions.retrieve
  // would be ideal but the event sometimes already contains it expanded. Most
  // commonly we'll get a `customer.subscription.created` event right after
  // this one — that's the canonical source. Only do a defensive sync if we
  // have a subscription id on the session.
  if (typeof session.subscription === 'string' || (session.subscription as Stripe.Subscription | undefined)?.id) {
    const subId = typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as Stripe.Subscription).id;
    // We don't have the full Subscription object here without an extra
    // round-trip; rely on customer.subscription.created firing right after.
    void subId;
  }
}

async function handleSubscriptionEvent(
  event:
    | Stripe.CustomerSubscriptionCreatedEvent
    | Stripe.CustomerSubscriptionUpdatedEvent
    | Stripe.CustomerSubscriptionDeletedEvent,
  billingEventRowId: string,
): Promise<void> {
  const sub = event.data.object;
  const { tenantId } = await syncSubscriptionFromStripe({ stripeSubscription: sub });
  if (tenantId) {
    await prisma.billingEvent
      .update({
        where: { id: billingEventRowId },
        data: {
          tenantId,
          kind:
            event.type === 'customer.subscription.created'
              ? 'subscription_created'
              : event.type === 'customer.subscription.updated'
                ? 'subscription_updated'
                : 'subscription_deleted',
        },
      })
      .catch(() => undefined);
  }
}

async function handleInvoicePaid(
  event: Stripe.InvoicePaidEvent,
  billingEventRowId: string,
): Promise<void> {
  const invoice = event.data.object;
  const stripeCustomerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id ?? null;
  if (!stripeCustomerId) return;

  const tenantId = await lookupTenantIdForCustomer(stripeCustomerId);
  if (!tenantId) return;

  // Pull subscription id off the invoice safely (different SDK versions
  // surface it under different paths — see Stripe API changelog).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyInvoice = invoice as any;
  const subscriptionId =
    typeof anyInvoice.subscription === 'string'
      ? anyInvoice.subscription
      : anyInvoice.subscription?.id ?? null;

  const periodStart =
    typeof invoice.period_start === 'number' ? new Date(invoice.period_start * 1000) : null;
  const periodEnd =
    typeof invoice.period_end === 'number' ? new Date(invoice.period_end * 1000) : null;

  await prisma.invoice.upsert({
    where: { stripeInvoiceId: invoice.id! },
    create: {
      tenantId,
      ...(subscriptionId
        ? { subscription: { connect: { stripeSubscriptionId: subscriptionId } } }
        : {}),
      stripeInvoiceId: invoice.id!,
      amountDueMinor: invoice.amount_due ?? 0,
      amountPaidMinor: invoice.amount_paid ?? 0,
      currency: invoice.currency ?? 'gbp',
      status: invoice.status ?? 'paid',
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      pdfUrl: invoice.invoice_pdf ?? null,
      periodStart,
      periodEnd,
      paidAt: new Date(),
    },
    update: {
      amountPaidMinor: invoice.amount_paid ?? 0,
      status: invoice.status ?? 'paid',
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      pdfUrl: invoice.invoice_pdf ?? null,
      paidAt: new Date(),
    },
  });

  // Recovery from past-due: clear pastDueSince and recompute status.
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    select: { status: true },
  });
  if (subscription && subscription.status !== 'active' && subscription.status !== 'trialing') {
    await prisma.$transaction([
      prisma.subscription.update({
        where: { tenantId },
        data: { status: 'active', pastDueSince: null },
      }),
      prisma.tenant.update({
        where: { id: tenantId },
        data: { subscriptionStatus: 'active' },
      }),
    ]);
  }

  await prisma.billingEvent
    .update({
      where: { id: billingEventRowId },
      data: { kind: 'invoice_paid', tenantId },
    })
    .catch(() => undefined);
}

async function handleInvoicePaymentFailed(
  event: Stripe.InvoicePaymentFailedEvent,
  billingEventRowId: string,
): Promise<void> {
  const invoice = event.data.object;
  const stripeCustomerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id ?? null;
  if (!stripeCustomerId) return;

  const tenantId = await lookupTenantIdForCustomer(stripeCustomerId);
  if (!tenantId) return;

  // Upsert the Invoice row.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyInvoice = invoice as any;
  const subscriptionId =
    typeof anyInvoice.subscription === 'string'
      ? anyInvoice.subscription
      : anyInvoice.subscription?.id ?? null;

  const periodStart =
    typeof invoice.period_start === 'number' ? new Date(invoice.period_start * 1000) : null;
  const periodEnd =
    typeof invoice.period_end === 'number' ? new Date(invoice.period_end * 1000) : null;

  await prisma.invoice.upsert({
    where: { stripeInvoiceId: invoice.id! },
    create: {
      tenantId,
      ...(subscriptionId
        ? { subscription: { connect: { stripeSubscriptionId: subscriptionId } } }
        : {}),
      stripeInvoiceId: invoice.id!,
      amountDueMinor: invoice.amount_due ?? 0,
      amountPaidMinor: 0,
      currency: invoice.currency ?? 'gbp',
      status: invoice.status ?? 'open',
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      pdfUrl: invoice.invoice_pdf ?? null,
      periodStart,
      periodEnd,
    },
    update: {
      status: invoice.status ?? 'open',
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      pdfUrl: invoice.invoice_pdf ?? null,
    },
  });

  // Stamp `pastDueSince` on the FIRST failure. Subsequent failures don't
  // restart the clock.
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    select: { pastDueSince: true, status: true },
  });
  const pastDueSince = subscription?.pastDueSince ?? new Date();
  const ourStatus = deriveSubscriptionStatus({
    stripeStatus: 'past_due',
    pastDueSince,
  });
  await prisma.$transaction([
    prisma.subscription.update({
      where: { tenantId },
      data: { status: ourStatus, pastDueSince },
    }),
    prisma.tenant.update({
      where: { id: tenantId },
      data: { subscriptionStatus: ourStatus },
    }),
  ]);

  await prisma.billingEvent
    .update({
      where: { id: billingEventRowId },
      data: { kind: 'invoice_payment_failed', tenantId },
    })
    .catch(() => undefined);
}

async function handlePaymentMethodAttached(
  event: Stripe.PaymentMethodAttachedEvent,
  billingEventRowId: string,
): Promise<void> {
  const pm = event.data.object;
  const stripeCustomerId =
    typeof pm.customer === 'string' ? pm.customer : pm.customer?.id ?? null;
  if (!stripeCustomerId) return;
  const tenantId = await lookupTenantIdForCustomer(stripeCustomerId);
  if (!tenantId) return;

  const card = pm.card;
  await prisma.paymentMethod.upsert({
    where: { stripePaymentMethodId: pm.id },
    create: {
      tenantId,
      stripePaymentMethodId: pm.id,
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      expMonth: card?.exp_month ?? null,
      expYear: card?.exp_year ?? null,
      isDefault: false,
    },
    update: {
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      expMonth: card?.exp_month ?? null,
      expYear: card?.exp_year ?? null,
    },
  });
  await prisma.billingEvent
    .update({
      where: { id: billingEventRowId },
      data: { kind: 'payment_method_updated', tenantId },
    })
    .catch(() => undefined);
}

async function handlePaymentMethodDetached(
  event: Stripe.PaymentMethodDetachedEvent,
  billingEventRowId: string,
): Promise<void> {
  const pm = event.data.object;
  await prisma.paymentMethod
    .deleteMany({ where: { stripePaymentMethodId: pm.id } })
    .catch(() => undefined);
  await prisma.billingEvent
    .update({
      where: { id: billingEventRowId },
      data: { kind: 'payment_method_updated' },
    })
    .catch(() => undefined);
}

// ─── Public entry point ─────────────────────────────────────────────────────

export interface DispatchResult {
  type: string;
  handled: boolean;
}

/**
 * Dispatches a verified, idempotency-checked Stripe Event to the matching
 * handler. Unknown event types are returned `handled: false` — Stripe is
 * still given a 200 because we don't want retries for events we choose to
 * ignore.
 *
 * Throws on internal errors so the route layer can record `processingError`.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  billingEventRowId: string,
): Promise<DispatchResult> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(
        event as Stripe.CheckoutSessionCompletedEvent,
        billingEventRowId,
      );
      return { type: event.type, handled: true };

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await handleSubscriptionEvent(
        event as
          | Stripe.CustomerSubscriptionCreatedEvent
          | Stripe.CustomerSubscriptionUpdatedEvent
          | Stripe.CustomerSubscriptionDeletedEvent,
        billingEventRowId,
      );
      return { type: event.type, handled: true };

    case 'invoice.paid':
      await handleInvoicePaid(event as Stripe.InvoicePaidEvent, billingEventRowId);
      return { type: event.type, handled: true };

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(
        event as Stripe.InvoicePaymentFailedEvent,
        billingEventRowId,
      );
      return { type: event.type, handled: true };

    case 'payment_method.attached':
      await handlePaymentMethodAttached(
        event as Stripe.PaymentMethodAttachedEvent,
        billingEventRowId,
      );
      return { type: event.type, handled: true };

    case 'payment_method.detached':
      await handlePaymentMethodDetached(
        event as Stripe.PaymentMethodDetachedEvent,
        billingEventRowId,
      );
      return { type: event.type, handled: true };

    default:
      // Unrecognised event: log + accept. Don't retry.
      logger.info({
        msg: 'Stripe webhook: unhandled event type (acknowledged)',
        type: event.type,
        eventId: event.id,
      });
      return { type: event.type, handled: false };
  }
}

// ─── Type re-export for tests ───────────────────────────────────────────────

export type { Prisma };
