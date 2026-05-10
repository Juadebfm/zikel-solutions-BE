/**
 * Phase 7.6 — Stripe webhook handler integration tests.
 *
 * Locks in:
 *   - Subscription.{created,updated,deleted} events sync our Subscription
 *     row + mirror Tenant.subscriptionStatus
 *   - past_due → grace → readonly → suspended derivation logic
 *   - invoice.paid recovers from past_due back to active
 *   - invoice.payment_failed stamps pastDueSince on FIRST failure (idempotent
 *     on subsequent failures)
 *   - checkout.session.completed (mode=payment) credits a top-up correctly
 *   - payment_method.attached / .detached upserts/deletes PaymentMethod row
 *   - Unknown event types are acknowledged (200) without retry
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
  }
});

const { mockPrisma } = vi.hoisted(() => {
  const mp = {
    subscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
    },
    tenant: { update: vi.fn(async () => ({})), findUnique: vi.fn() },
    plan: { findUnique: vi.fn() },
    invoice: { upsert: vi.fn(async () => ({})) },
    paymentMethod: {
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({})),
    },
    billingEvent: { update: vi.fn(async () => ({})) },
    tokenAllocation: {
      upsert: vi.fn(async () => ({
        id: 'alloc_1',
        bundledCalls: 1000,
        topUpCalls: 0,
        usedCalls: 0,
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-06-01'),
        resetAt: new Date('2026-06-01'),
      })),
      update: vi.fn(async () => ({})),
    },
    tokenLedgerEntry: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: unknown) => {
      if (typeof ops === 'function') return (ops as (tx: typeof mp) => Promise<unknown>)(mp);
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops;
    }),
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  };
  return { mockPrisma: mp };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

let webhookService: typeof import('../src/modules/billing/webhook.service.js');

beforeAll(async () => {
  webhookService = await import('../src/modules/billing/webhook.service.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  // Reset implementations to safe defaults — vi.clearAllMocks clears call
  // records but NOT mockResolvedValue implementations, so a per-test
  // .mockResolvedValue() leaks into the next test otherwise.
  mockPrisma.subscription.findUnique.mockResolvedValue(null);
  mockPrisma.subscription.findFirst.mockResolvedValue(null);
  mockPrisma.tenant.findUnique.mockResolvedValue({ createdAt: new Date('2026-04-01') });
  mockPrisma.plan.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  // No global state.
});

afterAll(() => {
  // Nothing.
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const ROW_ID = 'be_test_1';

function buildSubscriptionEvent(args: {
  id?: string;
  customerId?: string;
  status: 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete';
  tenantIdInMeta?: string | null;
  type?: 'created' | 'updated' | 'deleted';
  cancelAtPeriodEnd?: boolean;
  trialEnd?: number | null;
}) {
  const periodStart = 1_700_000_000;
  const periodEnd = 1_702_000_000;
  return {
    id: 'evt_test_sub',
    object: 'event',
    type: `customer.subscription.${args.type ?? 'updated'}`,
    data: {
      object: {
        id: args.id ?? 'sub_test_1',
        customer: args.customerId ?? 'cus_test_1',
        status: args.status,
        cancel_at_period_end: args.cancelAtPeriodEnd ?? false,
        trial_end: args.trialEnd ?? null,
        metadata:
          args.tenantIdInMeta === undefined
            ? { tenantId: 't_1' }
            : args.tenantIdInMeta === null
              ? {}
              : { tenantId: args.tenantIdInMeta },
        items: {
          data: [
            {
              current_period_start: periodStart,
              current_period_end: periodEnd,
              price: { id: 'price_test_monthly' },
            },
          ],
        },
      },
    },
    livemode: false,
  };
}

// ─── deriveSubscriptionStatus — pure unit ───────────────────────────────────

describe('deriveSubscriptionStatus', () => {
  it('maps trialing → trialing', () => {
    expect(webhookService.deriveSubscriptionStatus({ stripeStatus: 'trialing', pastDueSince: null }))
      .toBe('trialing');
  });

  it('maps active → active', () => {
    expect(webhookService.deriveSubscriptionStatus({ stripeStatus: 'active', pastDueSince: null }))
      .toBe('active');
  });

  it('past_due, no pastDueSince → past_due_grace (just-failed first time)', () => {
    expect(webhookService.deriveSubscriptionStatus({ stripeStatus: 'past_due', pastDueSince: null }))
      .toBe('past_due_grace');
  });

  it('past_due, < 3 days old → past_due_grace', () => {
    const now = new Date('2026-05-09T00:00:00Z');
    const pastDueSince = new Date('2026-05-08T00:00:00Z'); // 1 day ago
    expect(webhookService.deriveSubscriptionStatus({ stripeStatus: 'past_due', pastDueSince, now }))
      .toBe('past_due_grace');
  });

  it('past_due, 3-14 days old → past_due_readonly', () => {
    const now = new Date('2026-05-09T00:00:00Z');
    const pastDueSince = new Date('2026-05-04T00:00:00Z'); // 5 days ago
    expect(webhookService.deriveSubscriptionStatus({ stripeStatus: 'past_due', pastDueSince, now }))
      .toBe('past_due_readonly');
  });

  it('past_due, > 14 days old → suspended', () => {
    const now = new Date('2026-05-30T00:00:00Z');
    const pastDueSince = new Date('2026-05-09T00:00:00Z'); // 21 days ago
    expect(webhookService.deriveSubscriptionStatus({ stripeStatus: 'past_due', pastDueSince, now }))
      .toBe('suspended');
  });

  it('Stripe unpaid → suspended', () => {
    expect(webhookService.deriveSubscriptionStatus({ stripeStatus: 'unpaid', pastDueSince: null }))
      .toBe('suspended');
  });

  it('canceled → cancelled', () => {
    expect(webhookService.deriveSubscriptionStatus({ stripeStatus: 'canceled', pastDueSince: null }))
      .toBe('cancelled');
  });

  it('incomplete → incomplete', () => {
    expect(webhookService.deriveSubscriptionStatus({ stripeStatus: 'incomplete', pastDueSince: null }))
      .toBe('incomplete');
  });
});

// ─── Subscription event sync ────────────────────────────────────────────────

describe('handleStripeEvent — customer.subscription.updated', () => {
  it('upserts Subscription + mirrors Tenant.subscriptionStatus on active state', async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan_monthly' });
    mockPrisma.subscription.findUnique.mockResolvedValue({ pastDueSince: null });

    const event = buildSubscriptionEvent({ status: 'active', type: 'updated' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await webhookService.handleStripeEvent(event as any, ROW_ID);

    expect(result).toEqual({ type: 'customer.subscription.updated', handled: true });
    expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't_1' },
        update: expect.objectContaining({
          status: 'active',
          stripeSubscriptionId: 'sub_test_1',
          pastDueSince: null,
        }),
      }),
    );
    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't_1' },
      data: { subscriptionStatus: 'active' },
    });
    // BillingEvent kind updated to 'subscription_updated'
    expect(mockPrisma.billingEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROW_ID },
        data: expect.objectContaining({ kind: 'subscription_updated' }),
      }),
    );
  });

  it('stamps pastDueSince on the FIRST past_due transition', async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan_monthly' });
    mockPrisma.subscription.findUnique.mockResolvedValue({ pastDueSince: null });

    const event = buildSubscriptionEvent({ status: 'past_due', type: 'updated' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await webhookService.handleStripeEvent(event as any, ROW_ID);

    expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'past_due_grace',
          pastDueSince: expect.any(Date),
        }),
      }),
    );
  });

  it('does NOT reset pastDueSince on subsequent past_due events', async () => {
    const originalPastDue = new Date('2026-04-25T00:00:00Z');
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan_monthly' });
    mockPrisma.subscription.findUnique.mockResolvedValue({ pastDueSince: originalPastDue });

    const event = buildSubscriptionEvent({ status: 'past_due', type: 'updated' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await webhookService.handleStripeEvent(event as any, ROW_ID);

    expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          // Original date is preserved.
          pastDueSince: originalPastDue,
        }),
      }),
    );
  });

  it('clears pastDueSince when transitioning back to active', async () => {
    const originalPastDue = new Date('2026-04-25T00:00:00Z');
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan_monthly' });
    mockPrisma.subscription.findUnique.mockResolvedValue({ pastDueSince: originalPastDue });

    const event = buildSubscriptionEvent({ status: 'active', type: 'updated' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await webhookService.handleStripeEvent(event as any, ROW_ID);

    expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'active',
          pastDueSince: null,
        }),
      }),
    );
  });

  it('falls back to lookup tenantId by stripeCustomerId when metadata is missing', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ tenantId: 't_via_lookup' });
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan_monthly' });
    mockPrisma.subscription.findUnique.mockResolvedValue({ pastDueSince: null });

    const event = buildSubscriptionEvent({
      status: 'active',
      type: 'updated',
      tenantIdInMeta: null, // no metadata
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await webhookService.handleStripeEvent(event as any, ROW_ID);

    expect(mockPrisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { stripeCustomerId: 'cus_test_1' },
      select: { tenantId: true },
    });
    expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't_via_lookup' } }),
    );
  });

  it('silently ignores when no tenant mapping can be found', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
    const event = buildSubscriptionEvent({
      status: 'active',
      type: 'updated',
      tenantIdInMeta: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await webhookService.handleStripeEvent(event as any, ROW_ID);

    expect(result.handled).toBe(true);
    expect(mockPrisma.subscription.upsert).not.toHaveBeenCalled();
  });
});

// ─── Top-up via checkout.session.completed (mode=payment) ───────────────────

describe('handleStripeEvent — checkout.session.completed (top-up)', () => {
  it('credits a top-up to the tenant pool', async () => {
    const event = {
      id: 'evt_topup',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_topup',
          customer: 'cus_test_1',
          metadata: {
            tenantId: 't_1',
            kind: 'topup',
            packCode: 'topup_medium',
            calls: '1000',
          },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await webhookService.handleStripeEvent(event as any, ROW_ID);

    expect(mockPrisma.tokenLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't_1',
        kind: 'credit_topup',
        delta: 1000,
        reasonRef: 'stripe_session:cs_test_topup',
      }),
    });
    expect(mockPrisma.billingEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ROW_ID },
        data: expect.objectContaining({ kind: 'topup_purchased', tenantId: 't_1' }),
      }),
    );
  });
});

// ─── Invoice events ─────────────────────────────────────────────────────────

describe('handleStripeEvent — invoice events', () => {
  it('invoice.paid recovers a past_due subscription back to active', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ tenantId: 't_1' });
    mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'past_due_readonly' });

    const event = {
      id: 'evt_invoice_paid',
      object: 'event',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_test',
          customer: 'cus_test_1',
          subscription: 'sub_test_1',
          amount_due: 3000,
          amount_paid: 3000,
          currency: 'gbp',
          status: 'paid',
          hosted_invoice_url: 'https://invoice.stripe.com/test',
          invoice_pdf: 'https://invoice.stripe.com/test.pdf',
          period_start: 1_700_000_000,
          period_end: 1_702_000_000,
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await webhookService.handleStripeEvent(event as any, ROW_ID);

    expect(mockPrisma.invoice.upsert).toHaveBeenCalled();
    // Recovery: subscription bumped back to active + Tenant.subscriptionStatus updated
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't_1' },
        data: expect.objectContaining({ status: 'active', pastDueSince: null }),
      }),
    );
  });

  it('invoice.payment_failed stamps pastDueSince + transitions to past_due_grace', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ tenantId: 't_1' });
    mockPrisma.subscription.findUnique.mockResolvedValue({
      pastDueSince: null,
      status: 'active',
    });

    const event = {
      id: 'evt_invoice_failed',
      object: 'event',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_failed',
          customer: 'cus_test_1',
          subscription: 'sub_test_1',
          amount_due: 3000,
          amount_paid: 0,
          currency: 'gbp',
          status: 'open',
          hosted_invoice_url: null,
          invoice_pdf: null,
          period_start: 1_700_000_000,
          period_end: 1_702_000_000,
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await webhookService.handleStripeEvent(event as any, ROW_ID);

    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't_1' },
        data: expect.objectContaining({
          status: 'past_due_grace',
          pastDueSince: expect.any(Date),
        }),
      }),
    );
  });
});

// ─── Payment method events ──────────────────────────────────────────────────

describe('handleStripeEvent — payment_method.{attached,detached}', () => {
  it('attached upserts the PaymentMethod row with brand + last4', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ tenantId: 't_1' });
    const event = {
      id: 'evt_pm',
      object: 'event',
      type: 'payment_method.attached',
      data: {
        object: {
          id: 'pm_test_1',
          customer: 'cus_test_1',
          card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await webhookService.handleStripeEvent(event as any, ROW_ID);
    expect(mockPrisma.paymentMethod.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripePaymentMethodId: 'pm_test_1' },
        create: expect.objectContaining({
          tenantId: 't_1',
          brand: 'visa',
          last4: '4242',
        }),
      }),
    );
  });

  it('detached deletes the PaymentMethod row', async () => {
    const event = {
      id: 'evt_pm_d',
      object: 'event',
      type: 'payment_method.detached',
      data: { object: { id: 'pm_test_1', customer: null, card: null } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await webhookService.handleStripeEvent(event as any, ROW_ID);
    expect(mockPrisma.paymentMethod.deleteMany).toHaveBeenCalledWith({
      where: { stripePaymentMethodId: 'pm_test_1' },
    });
  });
});

// ─── Unknown event type ─────────────────────────────────────────────────────

describe('handleStripeEvent — unknown event type', () => {
  it('returns handled=false without throwing', async () => {
    const event = {
      id: 'evt_unknown',
      object: 'event',
      type: 'product.something_we_dont_handle',
      data: { object: {} },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await webhookService.handleStripeEvent(event as any, ROW_ID);
    expect(result).toEqual({ type: 'product.something_we_dont_handle', handled: false });
  });
});
