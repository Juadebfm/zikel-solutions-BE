/**
 * Phase 7.3 — Stripe webhook signature verification + idempotency.
 *
 * **Critical security boundary.** The webhook route is the ONLY way external
 * traffic can mutate billing state (subscriptions, invoices, top-up credits,
 * quota allocations). Signature verification is the FIRST thing that runs;
 * idempotency check is the SECOND.
 *
 * Get either wrong and:
 *   - Bad signature check → anyone can forge "your subscription is paid up"
 *     events (the request body is the only source of truth)
 *   - Bad idempotency → Stripe retries on network glitches mean we
 *     double-credit top-ups, double-process invoices
 *
 * This file owns both checks.
 */

import type Stripe from 'stripe';
import type { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { httpError } from './errors.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { requireStripeClient } from './stripe.js';

// ─── Signature verification ──────────────────────────────────────────────────

export interface VerifyWebhookArgs {
  /**
   * Raw request body BYTES (not parsed JSON). Stripe's HMAC is computed over
   * the exact bytes that arrived; if Fastify's default JSON parser has run,
   * the body has been re-stringified and the signature WILL fail.
   */
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
}

/**
 * Verifies the `Stripe-Signature` header against the raw body using the
 * shared webhook secret. Returns the verified Stripe Event on success.
 * Throws `httpError(400, 'INVALID_SIGNATURE', …)` on failure — the route
 * handler responds 400 so Stripe retries on network glitches but stops
 * retrying on actual signature mismatches.
 */
export function verifyWebhookSignature(args: VerifyWebhookArgs): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw httpError(
      503,
      'BILLING_NOT_CONFIGURED',
      'Stripe webhook secret is not configured.',
    );
  }
  if (!args.signatureHeader) {
    throw httpError(
      400,
      'INVALID_SIGNATURE',
      'Missing Stripe-Signature header.',
    );
  }
  const stripe = requireStripeClient();
  try {
    return stripe.webhooks.constructEvent(
      args.rawBody,
      args.signatureHeader,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logger.warn({
      msg: 'Stripe webhook signature verification failed',
      err: message,
    });
    throw httpError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed.');
  }
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

export interface RecordEventResult {
  /**
   * True when the event was newly inserted into BillingEvent. Caller should
   * proceed to handle it.
   */
  newlyInserted: boolean;
  /**
   * The BillingEvent.id — useful for chaining handler updates that mark
   * `processedAt` / `processingError` after the handler runs.
   */
  eventRowId: string;
}

/**
 * Records a Stripe webhook event in `BillingEvent`. The unique constraint on
 * `BillingEvent.stripeEventId` is our idempotency guard:
 *   - First arrival: row inserted, `newlyInserted: true` → handler runs.
 *   - Subsequent arrivals (Stripe retry on network glitch): conflict thrown
 *     by Prisma; we look up the existing row and return `newlyInserted: false`
 *     → handler is skipped, route returns 200.
 *
 * The handler is responsible for setting `processedAt` (success) or
 * `processingError` (failure) via `markEventProcessed` / `markEventFailed`.
 */
export async function recordWebhookEventOnce(args: {
  event: Stripe.Event;
  tenantId?: string | null;
  kind: 'webhook_received'; // Always 'webhook_received' for inbound Stripe events
}): Promise<RecordEventResult> {
  const payload = args.event as unknown as Prisma.InputJsonValue;
  try {
    const created = await prisma.billingEvent.create({
      data: {
        tenantId: args.tenantId ?? null,
        kind: args.kind,
        stripeEventId: args.event.id,
        payload,
      },
      select: { id: true },
    });
    return { newlyInserted: true, eventRowId: created.id };
  } catch (err) {
    // P2002 = Prisma unique-constraint violation on stripeEventId. Fetch the
    // existing row so the caller still has an id for status updates if needed.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      const existing = await prisma.billingEvent.findUnique({
        where: { stripeEventId: args.event.id },
        select: { id: true },
      });
      if (existing) {
        return { newlyInserted: false, eventRowId: existing.id };
      }
    }
    throw err;
  }
}

export async function markEventProcessed(eventRowId: string): Promise<void> {
  await prisma.billingEvent
    .update({
      where: { id: eventRowId },
      data: { processedAt: new Date() },
    })
    .catch(() => undefined);
}

export async function markEventFailed(
  eventRowId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : 'unknown';
  await prisma.billingEvent
    .update({
      where: { id: eventRowId },
      data: { processingError: message.slice(0, 1000) },
    })
    .catch(() => undefined);
}
