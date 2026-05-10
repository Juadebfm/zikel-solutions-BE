/**
 * Phase 7.6 — `POST /api/v1/integrations/billing/webhook`.
 *
 * Public route, no auth — verified by Stripe signature only.
 *
 * **Critical:** the route uses a raw-body parser. Stripe's HMAC is computed
 * over the exact bytes that arrived; if Fastify's default JSON parser has
 * run, the body has been re-stringified and the signature WILL fail.
 *
 * Order of operations:
 *   1. Verify Stripe-Signature → 400 INVALID_SIGNATURE if bad (Stripe will
 *      retry on network glitches, but stops on actual signature mismatches).
 *   2. Idempotency check via `recordWebhookEventOnce` — duplicate events
 *      return 200 immediately (don't re-handle).
 *   3. Dispatch via `handleStripeEvent`. Failures here write
 *      `BillingEvent.processingError` and return 200 (so Stripe doesn't
 *      retry — we replay manually if needed via the BillingEvent row).
 *   4. Mark `processedAt` on success.
 */

import type { FastifyPluginAsync } from 'fastify';
import { logger } from '../../lib/logger.js';
import {
  markEventFailed,
  markEventProcessed,
  recordWebhookEventOnce,
  verifyWebhookSignature,
} from '../../lib/stripe-webhook.js';
import { handleStripeEvent } from './webhook.service.js';

const billingWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Register a raw-body content-type parser scoped to THIS plugin only.
  // Without this, Fastify's default JSON parser turns the body into a JS
  // object and the signature verification fails (Stripe HMAC is over raw
  // bytes, not re-serialised JSON).
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      // Pass the raw Buffer through. Stripe's `constructEvent` accepts a
      // Buffer or string and verifies signature against the bytes.
      done(null, body);
    },
  );

  fastify.post('/webhook', {
    config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
    schema: {
      tags: ['Integrations'],
      summary: 'Stripe billing webhook (signature-verified)',
      description:
        'Inbound endpoint for Stripe to deliver subscription, invoice, top-up, and payment-method events. Idempotency-safe: a duplicate event.id (Stripe retries on network glitches) is a no-op.',
      security: [],
      response: {
        200: {
          type: 'object',
          required: ['received'],
          properties: {
            received: { type: 'boolean' },
            type: { type: 'string' },
            handled: { type: 'boolean' },
            duplicate: { type: 'boolean' },
          },
        },
        400: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const signatureHeader = request.headers['stripe-signature'];
      const rawBody = request.body as Buffer | string;

      // 1. Signature verification — first thing, before any DB access.
      const event = verifyWebhookSignature({
        rawBody,
        signatureHeader: typeof signatureHeader === 'string' ? signatureHeader : undefined,
      });

      // 2. Idempotency record. Tenant id resolution happens inside the
      // dispatcher; this row will be updated with the tenantId by the
      // handler if it can resolve one.
      const { newlyInserted, eventRowId } = await recordWebhookEventOnce({
        event,
        kind: 'webhook_received',
      });

      if (!newlyInserted) {
        // Duplicate (Stripe retried). Return 200 immediately — handler ran
        // already.
        return reply.send({
          received: true,
          type: event.type,
          handled: false,
          duplicate: true,
        });
      }

      // 3. Dispatch. Wrap in try/catch — failures write processingError
      // and we return 200 (no Stripe retry; replay manually if needed).
      try {
        const result = await handleStripeEvent(event, eventRowId);
        await markEventProcessed(eventRowId);
        return reply.send({
          received: true,
          type: result.type,
          handled: result.handled,
          duplicate: false,
        });
      } catch (err) {
        logger.error({
          msg: 'Stripe webhook handler failed — recorded for manual replay',
          eventId: event.id,
          eventType: event.type,
          rowId: eventRowId,
          err: err instanceof Error ? err.message : 'unknown',
        });
        await markEventFailed(eventRowId, err);
        // Still 200 — we don't want Stripe to retry blindly. Operator can
        // replay from BillingEvent via the runbook.
        return reply.send({
          received: true,
          type: event.type,
          handled: false,
          duplicate: false,
        });
      }
    },
  });
};

export default billingWebhookRoutes;
