/**
 * Phase 7.3 — Stripe webhook signature verification + idempotency.
 *
 * The webhook handler is the only externally-reachable mutation surface for
 * billing state. Signature verification is the security boundary; the
 * idempotency table is the correctness boundary. Both are tested here.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
  }
  // Stripe test config — real-looking values so the SDK initialises cleanly
  // but no requests will go to Stripe (signature verification is local).
  process.env.STRIPE_SECRET_KEY = 'sk_test_phase7_unit';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_phase7_unit_secret';
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    billingEvent: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

let webhook: typeof import('../src/lib/stripe-webhook.js');
let stripeLib: typeof import('../src/lib/stripe.js');

beforeAll(async () => {
  stripeLib = await import('../src/lib/stripe.js');
  webhook = await import('../src/lib/stripe-webhook.js');
});

afterAll(() => {
  stripeLib.__resetStripeClientForTests();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // No global state to reset.
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Builds a valid Stripe-Signature header for a given raw body. Mirrors the
 * algorithm in `stripe.webhooks.constructEvent` so we can sign test payloads
 * without hitting Stripe.
 *
 *   Stripe-Signature: t=<unix-ts>,v1=<hmac-sha256(t.<body>, secret)>
 */
function signPayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

const VALID_EVENT = {
  id: 'evt_test_123',
  object: 'event',
  api_version: '2025-08-27.basil',
  created: 1_700_000_000,
  type: 'customer.subscription.updated',
  data: { object: { id: 'sub_test_1', customer: 'cus_test_1', status: 'active' } },
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
};

// ─── Signature verification ─────────────────────────────────────────────────

describe('verifyWebhookSignature', () => {
  it('throws 400 INVALID_SIGNATURE when the signature header is missing', () => {
    expect(() =>
      webhook.verifyWebhookSignature({
        rawBody: JSON.stringify(VALID_EVENT),
        signatureHeader: undefined,
      }),
    ).toThrowError(expect.objectContaining({ statusCode: 400, code: 'INVALID_SIGNATURE' }));
  });

  it('throws 400 INVALID_SIGNATURE when the signature does not match', () => {
    const rawBody = JSON.stringify(VALID_EVENT);
    expect(() =>
      webhook.verifyWebhookSignature({
        rawBody,
        signatureHeader: 't=1700000000,v1=deadbeef',
      }),
    ).toThrowError(expect.objectContaining({ statusCode: 400, code: 'INVALID_SIGNATURE' }));
  });

  it('throws 400 INVALID_SIGNATURE when body bytes were modified after signing', () => {
    const originalBody = JSON.stringify(VALID_EVENT);
    const signature = signPayload(originalBody, 'whsec_phase7_unit_secret');
    const tamperedBody = JSON.stringify({ ...VALID_EVENT, data: { object: { status: 'tampered' } } });
    expect(() =>
      webhook.verifyWebhookSignature({
        rawBody: tamperedBody,
        signatureHeader: signature,
      }),
    ).toThrowError(expect.objectContaining({ statusCode: 400, code: 'INVALID_SIGNATURE' }));
  });

  it('returns the verified Event when signature matches', () => {
    const rawBody = JSON.stringify(VALID_EVENT);
    const signature = signPayload(rawBody, 'whsec_phase7_unit_secret');
    const result = webhook.verifyWebhookSignature({
      rawBody,
      signatureHeader: signature,
    });
    expect(result.id).toBe('evt_test_123');
    expect(result.type).toBe('customer.subscription.updated');
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('recordWebhookEventOnce', () => {
  it('inserts on first arrival and returns newlyInserted=true', async () => {
    mockPrisma.billingEvent.create.mockResolvedValueOnce({ id: 'be_1' });
    const result = await webhook.recordWebhookEventOnce({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event: VALID_EVENT as any,
      kind: 'webhook_received',
    });
    expect(result).toEqual({ newlyInserted: true, eventRowId: 'be_1' });
    expect(mockPrisma.billingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripeEventId: 'evt_test_123',
          kind: 'webhook_received',
        }),
      }),
    );
  });

  it('returns newlyInserted=false on duplicate (P2002 unique violation)', async () => {
    const conflictErr = Object.assign(new Error('Unique violation'), { code: 'P2002' });
    mockPrisma.billingEvent.create.mockRejectedValueOnce(conflictErr);
    mockPrisma.billingEvent.findUnique.mockResolvedValueOnce({ id: 'be_existing' });

    const result = await webhook.recordWebhookEventOnce({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event: VALID_EVENT as any,
      kind: 'webhook_received',
    });
    expect(result).toEqual({ newlyInserted: false, eventRowId: 'be_existing' });
    expect(mockPrisma.billingEvent.findUnique).toHaveBeenCalledWith({
      where: { stripeEventId: 'evt_test_123' },
      select: { id: true },
    });
  });

  it('rethrows non-conflict DB errors so the route returns 500 and Stripe retries', async () => {
    const dbErr = new Error('connection refused');
    mockPrisma.billingEvent.create.mockRejectedValueOnce(dbErr);
    await expect(
      webhook.recordWebhookEventOnce({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        event: VALID_EVENT as any,
        kind: 'webhook_received',
      }),
    ).rejects.toThrow('connection refused');
  });
});

// ─── Status update helpers ──────────────────────────────────────────────────

describe('markEventProcessed / markEventFailed', () => {
  it('markEventProcessed sets processedAt', async () => {
    await webhook.markEventProcessed('be_1');
    expect(mockPrisma.billingEvent.update).toHaveBeenCalledWith({
      where: { id: 'be_1' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it('markEventFailed records the error message (truncated)', async () => {
    const longError = new Error('x'.repeat(2000));
    await webhook.markEventFailed('be_1', longError);
    expect(mockPrisma.billingEvent.update).toHaveBeenCalledWith({
      where: { id: 'be_1' },
      data: { processingError: expect.stringMatching(/^x{1000}$/) },
    });
  });

  it('markEventProcessed swallows DB errors silently', async () => {
    mockPrisma.billingEvent.update.mockRejectedValueOnce(new Error('boom'));
    await expect(webhook.markEventProcessed('be_1')).resolves.toBeUndefined();
  });
});
