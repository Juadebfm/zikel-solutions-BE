/**
 * Phase 7.5 — `/api/v1/billing/*` route coverage.
 *
 * Locks in the read-path shapes + the role gating (BILLING_READ vs
 * BILLING_WRITE). Stripe SDK is fully mocked — tests don't make outbound
 * Stripe calls.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
  }
  // Stripe + billing config — required so requireStripeClient() returns a
  // real (test-mode) client and checkout-session creation doesn't 503.
  process.env.STRIPE_SECRET_KEY = 'sk_test_phase7_unit';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_phase7_unit';
  process.env.STRIPE_PRICE_ID_MONTHLY = 'price_test_monthly';
  process.env.STRIPE_PRICE_ID_ANNUAL = 'price_test_annual';
  process.env.STRIPE_PRICE_ID_TOPUP_SMALL = 'price_test_topup_small';
  process.env.STRIPE_PRICE_ID_TOPUP_MEDIUM = 'price_test_topup_medium';
  process.env.STRIPE_PRICE_ID_TOPUP_LARGE = 'price_test_topup_large';
  process.env.BILLING_CHECKOUT_SUCCESS_URL = 'https://app.test/billing/success';
  process.env.BILLING_CHECKOUT_CANCEL_URL = 'https://app.test/billing/canceled';
  process.env.BILLING_PORTAL_RETURN_URL = 'https://app.test/billing';
});

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { mockPrisma, mockStripe } = vi.hoisted(() => {
  const mp = {
    tenantUser: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn(async () => ({ createdAt: new Date('2026-04-01') })) },
    subscription: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    plan: { findUnique: vi.fn(), findMany: vi.fn() },
    topUpPack: { findUnique: vi.fn(), findMany: vi.fn() },
    invoice: { findMany: vi.fn(), count: vi.fn() },
    tenantAiRestriction: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
    tenantMembership: {
      findFirst: vi.fn(async () => ({ role: { name: 'Owner' } })),
      findMany: vi.fn(async () => []),
    },
    tokenAllocation: {
      upsert: vi.fn(async () => ({
        id: 'alloc_1',
        bundledCalls: 1000,
        topUpCalls: 0,
        usedCalls: 100,
        periodStart: new Date('2026-05-01'),
        periodEnd: new Date('2026-06-01'),
        resetAt: new Date('2026-06-01'),
      })),
    },
    tokenLedgerEntry: {
      groupBy: vi.fn(async () => []),
    },
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  };
  const stripe = {
    customers: { create: vi.fn(async () => ({ id: 'cus_test_1' })) },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          url: 'https://checkout.stripe.com/test_session',
          expires_at: 1_700_000_000,
        })),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => ({
          url: 'https://billing.stripe.com/test_portal',
        })),
      },
    },
    subscriptions: { update: vi.fn(async () => ({})) },
    webhooks: {
      constructEvent: vi.fn(),
    },
  };
  return { mockPrisma: mp, mockStripe: stripe };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/stripe.js', () => ({
  getStripeClient: () => mockStripe,
  requireStripeClient: () => mockStripe,
  __resetStripeClientForTests: () => undefined,
}));

// ─── App fixture ────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  const server = await import('../src/server.js');
  app = await server.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: actor is an Owner — has both BILLING_READ + BILLING_WRITE.
  // The auth plugin reads tenantUser.findUnique with `tenantMemberships`
  // included — replicate that fixture shape.
  mockPrisma.tenantUser.findUnique.mockResolvedValue({
    id: 'u_owner',
    email: 'owner@example.com',
    firstName: 'Olivia',
    lastName: 'Owner',
    role: 'admin',
    activeTenantId: 't_1',
    activeTenant: { id: 't_1', isActive: true },
    tenantMemberships: [
      {
        tenantId: 't_1',
        status: 'active',
        role: {
          name: 'Owner',
          // All permissions — Owner has full access.
          permissions: [
            'billing:read',
            'billing:write',
            'ai:use',
            'ai:admin',
          ],
        },
      },
    ],
  });
  mockPrisma.tenantMembership.findFirst.mockResolvedValue({ role: { name: 'Owner' } });
  mockPrisma.tokenLedgerEntry.groupBy.mockResolvedValue([]);
});

// ─── JWT helper ─────────────────────────────────────────────────────────────

function ownerToken() {
  return app.jwt.sign({
    sub: 'u_owner',
    email: 'owner@example.com',
    role: 'admin',
    tenantId: 't_1',
    tenantRole: 'tenant_admin',
    sid: 's_1',
    mfaVerified: true,
    aud: 'tenant',
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/v1/billing/subscription', () => {
  it('returns subscription state + UI flags when a subscription exists', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      tenantId: 't_1',
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      status: 'trialing',
      trialEndsAt: new Date('2026-05-16'),
      currentPeriodStart: new Date('2026-05-09'),
      currentPeriodEnd: new Date('2026-06-09'),
      cancelAtPeriodEnd: false,
      pastDueSince: null,
      manuallyOverriddenUntil: null,
      plan: {
        code: 'standard_monthly',
        name: 'Standard Monthly',
        interval: 'month',
        unitAmountMinor: 3000,
        currency: 'gbp',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        status: string;
        isInTrial: boolean;
        plan: { code: string };
      };
    };
    expect(body.data.status).toBe('trialing');
    expect(body.data.isInTrial).toBe(true);
    expect(body.data.plan.code).toBe('standard_monthly');
  });

  it('returns trialing default state when no subscription row exists yet', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string; plan: unknown } };
    expect(body.data.status).toBe('trialing');
    expect(body.data.plan).toBeNull();
  });
});

describe('GET /api/v1/billing/plans', () => {
  it('returns the active plans + top-up packs', async () => {
    mockPrisma.plan.findMany.mockResolvedValue([
      {
        code: 'standard_monthly',
        name: 'Standard Monthly',
        interval: 'month',
        unitAmountMinor: 3000,
        currency: 'gbp',
        bundledCallsPerPeriod: 1000,
      },
      {
        code: 'standard_annual',
        name: 'Standard Annual',
        interval: 'year',
        unitAmountMinor: 30000,
        currency: 'gbp',
        bundledCallsPerPeriod: 1000,
      },
    ]);
    mockPrisma.topUpPack.findMany.mockResolvedValue([
      { code: 'topup_small', name: 'Small', unitAmountMinor: 500, currency: 'gbp', calls: 250 },
      { code: 'topup_medium', name: 'Medium', unitAmountMinor: 1500, currency: 'gbp', calls: 1000 },
      { code: 'topup_large', name: 'Large', unitAmountMinor: 4000, currency: 'gbp', calls: 5000 },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/plans',
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { plans: Array<{ code: string }>; topUpPacks: Array<{ code: string }> };
    };
    expect(body.data.plans).toHaveLength(2);
    expect(body.data.topUpPacks).toHaveLength(3);
  });
});

describe('GET /api/v1/billing/quota', () => {
  it('returns the current period snapshot', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/quota',
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        bundledCalls: number;
        usedCalls: number;
        remainingCalls: number;
      };
    };
    expect(body.data.bundledCalls).toBe(1000);
    expect(body.data.usedCalls).toBe(100);
    expect(body.data.remainingCalls).toBe(900);
  });
});

describe('POST /api/v1/billing/checkout-session', () => {
  it('creates a Stripe Checkout subscription session', async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({
      code: 'standard_monthly',
      stripePriceId: 'price_test_monthly',
    });
    mockPrisma.subscription.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout-session',
      headers: {
        authorization: `Bearer ${ownerToken()}`,
        'content-type': 'application/json',
      },
      payload: { planCode: 'standard_monthly' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { url: string | null } };
    expect(body.data.url).toMatch(/checkout\.stripe\.com/);

    // Verify Stripe was called with the right shape.
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_test_monthly', quantity: 1 }],
        metadata: expect.objectContaining({
          tenantId: 't_1',
          kind: 'subscription',
          planCode: 'standard_monthly',
        }),
        subscription_data: expect.objectContaining({
          trial_period_days: 7,
        }),
        payment_method_collection: 'if_required',
      }),
    );

    // Verify a new Stripe customer was created (no existing subscription).
    expect(mockStripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
      }),
    );
  });

  it('reuses existing stripeCustomerId on re-checkout', async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({
      code: 'standard_monthly',
      stripePriceId: 'price_test_monthly',
    });
    mockPrisma.subscription.findUnique.mockResolvedValue({
      tenantId: 't_1',
      stripeCustomerId: 'cus_existing',
      stripeSubscriptionId: null,
      plan: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout-session',
      headers: {
        authorization: `Bearer ${ownerToken()}`,
        'content-type': 'application/json',
      },
      payload: { planCode: 'standard_monthly' },
    });
    expect(res.statusCode).toBe(200);

    expect(mockStripe.customers.create).not.toHaveBeenCalled();
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
    );
  });
});

describe('POST /api/v1/billing/topup-checkout-session', () => {
  it('creates a one-time payment Checkout session with kind=topup metadata', async () => {
    mockPrisma.topUpPack.findUnique.mockResolvedValue({
      code: 'topup_medium',
      stripePriceId: 'price_test_topup_medium',
      calls: 1000,
    });
    mockPrisma.subscription.findUnique.mockResolvedValue({
      tenantId: 't_1',
      stripeCustomerId: 'cus_existing',
      stripeSubscriptionId: 'sub_test',
      plan: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/topup-checkout-session',
      headers: {
        authorization: `Bearer ${ownerToken()}`,
        'content-type': 'application/json',
      },
      payload: { packCode: 'topup_medium' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customer: 'cus_existing',
        line_items: [{ price: 'price_test_topup_medium', quantity: 1 }],
        metadata: expect.objectContaining({
          tenantId: 't_1',
          kind: 'topup',
          packCode: 'topup_medium',
          calls: '1000',
        }),
      }),
    );
  });

  it('refuses top-up when no subscription exists yet', async () => {
    mockPrisma.topUpPack.findUnique.mockResolvedValue({
      code: 'topup_medium',
      stripePriceId: 'price_test_topup_medium',
      calls: 1000,
    });
    mockPrisma.subscription.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/topup-checkout-session',
      headers: {
        authorization: `Bearer ${ownerToken()}`,
        'content-type': 'application/json',
      },
      payload: { packCode: 'topup_medium' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SUBSCRIPTION_REQUIRED');
  });
});

describe('POST /api/v1/billing/cancel', () => {
  it('sets cancelAtPeriodEnd via Stripe + mirrors locally', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      tenantId: 't_1',
      stripeCustomerId: 'cus_existing',
      stripeSubscriptionId: 'sub_test',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date('2026-06-09'),
      plan: {},
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/cancel',
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_test',
      { cancel_at_period_end: true },
    );
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
      where: { tenantId: 't_1' },
      data: { cancelAtPeriodEnd: true },
    });
  });

  it('returns current state (idempotent) when already set to cancel', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      tenantId: 't_1',
      stripeSubscriptionId: 'sub_test',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-06-09'),
      plan: {},
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/cancel',
      headers: { authorization: `Bearer ${ownerToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/billing/ai-restrictions', () => {
  it('persists per-role caps + audit user', async () => {
    mockPrisma.tenantAiRestriction.upsert.mockResolvedValue({
      perRoleCaps: { 'Care Worker': 50 },
      perUserCaps: {},
      updatedAt: new Date(),
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/ai-restrictions',
      headers: {
        authorization: `Bearer ${ownerToken()}`,
        'content-type': 'application/json',
      },
      payload: { perRoleCaps: { 'Care Worker': 50 } },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.tenantAiRestriction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't_1' },
        update: expect.objectContaining({
          perRoleCaps: { 'Care Worker': 50 },
          updatedByUserId: 'u_owner',
        }),
      }),
    );
  });

  it('rejects caps > 100,000', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/ai-restrictions',
      headers: {
        authorization: `Bearer ${ownerToken()}`,
        'content-type': 'application/json',
      },
      payload: { perRoleCaps: { 'Care Worker': 999_999 } },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects when neither perRoleCaps nor perUserCaps provided', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/billing/ai-restrictions',
      headers: {
        authorization: `Bearer ${ownerToken()}`,
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('Permission gating', () => {
  it('returns 403 when actor lacks BILLING_WRITE on a write route', async () => {
    // Override the default (Owner) fixture with a user whose role only has BILLING_READ.
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      id: 'u_admin',
      role: 'manager',
      activeTenantId: 't_1',
      activeTenant: { id: 't_1', isActive: true },
      tenantMemberships: [
        {
          tenantId: 't_1',
          status: 'active',
          role: { name: 'Admin', permissions: ['billing:read'] }, // no billing:write
        },
      ],
    });
    const adminToken = app.jwt.sign({
      sub: 'u_admin',
      email: 'admin@example.com',
      role: 'manager',
      tenantId: 't_1',
      tenantRole: 'sub_admin',
      sid: 's_1',
      mfaVerified: true,
      aud: 'tenant',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/cancel',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PERMISSION_DENIED');
  });
});
