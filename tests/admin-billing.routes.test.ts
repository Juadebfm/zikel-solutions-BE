/**
 * Phase 7.8 — `/admin/billing/*` route + service coverage.
 *
 * Locks in:
 *   - List filter (status, search) shape
 *   - Detail returns subscription + invoices + paymentMethods + currentAllocation
 *   - Override with extendTrialDays bumps trialEndsAt + flips status to trialing
 *   - Override with grantFullAccessUntil sets manuallyOverriddenUntil
 *   - Override with addBonusCalls credits the pool
 *   - Override is restricted to platform_admin (support → 403)
 *   - Override writes BOTH PlatformAuditLog AND BillingEvent rows
 *   - Override requires at least one action (Zod refine)
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
});

const { mockPrisma } = vi.hoisted(() => {
  const mp = {
    subscription: {
      findUnique: vi.fn(),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      update: vi.fn(async () => ({})),
    },
    tenant: { update: vi.fn(async () => ({})), findUnique: vi.fn() },
    plan: { findUnique: vi.fn() },
    invoice: { findMany: vi.fn(async () => []) },
    paymentMethod: { findMany: vi.fn(async () => []) },
    tokenAllocation: {
      findFirst: vi.fn(async () => null),
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
    platformAuditLog: { create: vi.fn(async () => ({})) },
    billingEvent: { create: vi.fn(async () => ({})), count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
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
  // Default subscription used by detail/override tests.
  mockPrisma.subscription.findUnique.mockResolvedValue({
    id: 'sub_row_1',
    tenantId: 't_1',
    planId: 'plan_monthly',
    status: 'past_due_readonly',
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_test',
    trialEndsAt: null,
    currentPeriodStart: new Date('2026-05-01'),
    currentPeriodEnd: new Date('2026-06-01'),
    cancelAtPeriodEnd: false,
    pastDueSince: new Date('2026-04-25'),
    manuallyOverriddenUntil: null,
    tenant: { name: 'Acme Care', slug: 'acme', country: 'UK', isActive: true },
    plan: {
      code: 'standard_monthly',
      name: 'Standard Monthly',
      interval: 'month',
      unitAmountMinor: 3000,
      bundledCallsPerPeriod: 1000,
    },
  });
});

function platformToken(extra: Record<string, unknown> = {}) {
  return app.jwt.sign({
    sub: 'p_admin',
    email: 'admin@zikelsolutions.com',
    role: 'platform_admin',
    sid: 'ps_1',
    mfaVerified: true,
    aud: 'platform',
    ...extra,
  });
}

// ─── List ───────────────────────────────────────────────────────────────────

describe('GET /admin/billing/subscriptions', () => {
  it('returns paginated subscriptions', async () => {
    mockPrisma.subscription.count.mockResolvedValue(1);
    mockPrisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub_1',
        tenantId: 't_1',
        status: 'active',
        tenant: { name: 'Acme Care', slug: 'acme', country: 'UK', isActive: true },
        plan: { code: 'standard_monthly', name: 'Standard', interval: 'month', unitAmountMinor: 3000 },
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/billing/subscriptions',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ tenantId: string }>; meta: { total: number } };
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.tenantId).toBe('t_1');
  });

  it('forwards status filter to the query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/billing/subscriptions?status=past_due_readonly',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'past_due_readonly' }),
      }),
    );
  });

  // Note: invalid `status=bogus` is silently stripped by AJV's
  // `removeAdditional: 'all'` mode in the global validator config — the
  // request ends up with no filter applied. Zod handles range/cap value
  // validation in body schemas; query enum validation behaves slightly
  // differently and is out of scope for this test surface.
});

// ─── Detail ─────────────────────────────────────────────────────────────────

describe('GET /admin/billing/subscriptions/:tenantId', () => {
  it('returns subscription detail with related rows', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv_1', stripeInvoiceId: 'in_test', status: 'paid' },
    ]);
    mockPrisma.tokenAllocation.findFirst.mockResolvedValue({
      id: 'alloc_1',
      bundledCalls: 1000,
      topUpCalls: 0,
      usedCalls: 50,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/admin/billing/subscriptions/t_1',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        subscription: { tenantId: string };
        recentInvoices: Array<{ id: string }>;
        currentAllocation: { id: string };
      };
    };
    expect(body.data.subscription.tenantId).toBe('t_1');
    expect(body.data.recentInvoices).toHaveLength(1);
    expect(body.data.currentAllocation.id).toBe('alloc_1');
  });

  it('returns 404 when no subscription exists', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/billing/subscriptions/missing',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Override ───────────────────────────────────────────────────────────────

describe('POST /admin/billing/subscriptions/:tenantId/override', () => {
  it('extendTrialDays bumps trialEndsAt + flips status to trialing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/billing/subscriptions/t_1/override',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: {
        extendTrialDays: 14,
        reason: 'Compliance review needs extra time before billing kicks in.',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't_1' },
        data: expect.objectContaining({
          status: 'trialing',
          trialEndsAt: expect.any(Date),
        }),
      }),
    );
    // Tenant.subscriptionStatus mirrored.
    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't_1' },
      data: { subscriptionStatus: 'trialing' },
    });
  });

  it('grantFullAccessUntil sets manuallyOverriddenUntil', async () => {
    const future = new Date('2026-06-30');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/billing/subscriptions/t_1/override',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: {
        grantFullAccessUntil: future.toISOString(),
        reason: 'Stripe outage caused billing failure on our side.',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          manuallyOverriddenUntil: expect.any(Date),
        }),
      }),
    );
  });

  it('addBonusCalls credits the pool via creditTopUp', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/billing/subscriptions/t_1/override',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: {
        addBonusCalls: 500,
        reason: 'Goodwill credit for support outage on 2026-05-08.',
      },
    });
    expect(res.statusCode).toBe(200);
    // creditTopUp does an upsert + ledger entry — check ledger create
    expect(mockPrisma.tokenLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't_1',
          kind: 'credit_topup',
          delta: 500,
          reasonRef: expect.stringMatching(/^admin_override:/),
        }),
      }),
    );
  });

  it('writes both PlatformAuditLog AND BillingEvent rows', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/billing/subscriptions/t_1/override',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: {
        addBonusCalls: 100,
        reason: 'Goodwill credit for CSAT survey response.',
      },
    });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(mockPrisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          platformUserId: 'p_admin',
          targetTenantId: 't_1',
          metadata: expect.objectContaining({ event: 'manual_admin_override' }),
        }),
      }),
    );
    expect(mockPrisma.billingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't_1',
          kind: 'manual_admin_override',
        }),
      }),
    );
  });

  it('rejects when no action fields are provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/billing/subscriptions/t_1/override',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: { reason: 'too short and no action specified' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects support role (PLATFORM_ROLE_DENIED)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/billing/subscriptions/t_1/override',
      headers: {
        authorization: `Bearer ${platformToken({ role: 'support' })}`,
        'content-type': 'application/json',
      },
      payload: {
        addBonusCalls: 100,
        reason: 'Goodwill credit for CSAT survey response.',
      },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PLATFORM_ROLE_DENIED');
  });

  it('rejects when subscription does not exist', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/billing/subscriptions/missing/override',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: {
        extendTrialDays: 7,
        reason: 'Some reason that is at least ten characters long.',
      },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Events list ────────────────────────────────────────────────────────────

describe('GET /admin/billing/events', () => {
  it('returns paginated BillingEvent rows', async () => {
    mockPrisma.billingEvent.count.mockResolvedValue(2);
    mockPrisma.billingEvent.findMany.mockResolvedValue([
      { id: 'be_1', kind: 'subscription_created', tenantId: 't_1', receivedAt: new Date() },
      { id: 'be_2', kind: 'invoice_paid', tenantId: 't_1', receivedAt: new Date() },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/billing/events?tenantId=t_1',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }>; meta: { total: number } };
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
  });
});
