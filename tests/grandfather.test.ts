/**
 * Phase 7.9 — grandfather migration coverage.
 *
 * Locks in:
 *   - Idempotent: existing Subscription → returns alreadyGrandfathered=true,
 *     no DB writes
 *   - Creates Subscription + TokenAllocation + BillingEvent + flips
 *     Tenant.subscriptionStatus, all in one transaction
 *   - Trial = 30 days from now
 *   - Falls back to a placeholder stripeCustomerId when Stripe isn't
 *     configured (dev path)
 *   - grandfatherAllActiveTenants surveys + processes every active tenant
 *   - Errors on individual tenants don't halt the bulk migration
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
  }
});

const { mockPrisma, mockStripe } = vi.hoisted(() => {
  const mp = {
    tenant: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    subscription: { findUnique: vi.fn(), create: vi.fn(async () => ({})) },
    plan: { findUnique: vi.fn() },
    tokenAllocation: { create: vi.fn(async () => ({})) },
    billingEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: unknown) => {
      if (typeof ops === 'function') return (ops as (tx: typeof mp) => Promise<unknown>)(mp);
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops;
    }),
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  };
  const stripe: { customers: { create: ReturnType<typeof vi.fn> } } | null = {
    customers: { create: vi.fn(async () => ({ id: 'cus_test_grandfather' })) },
  };
  return { mockPrisma: mp, mockStripe: stripe };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

// Stripe mock — by default returns a real-looking client; individual tests
// can override via getStripeClient.mockReturnValueOnce(null) to exercise the
// dev path.
vi.mock('../src/lib/stripe.js', () => ({
  getStripeClient: vi.fn(() => mockStripe),
  requireStripeClient: vi.fn(() => mockStripe),
  __resetStripeClientForTests: () => undefined,
}));

let grandfather: typeof import('../src/modules/billing/grandfather.service.js');
let stripeLib: typeof import('../src/lib/stripe.js');

beforeAll(async () => {
  grandfather = await import('../src/modules/billing/grandfather.service.js');
  stripeLib = await import('../src/lib/stripe.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: Plan exists, no existing subscription, real Stripe.
  mockPrisma.plan.findUnique.mockResolvedValue({
    id: 'plan_monthly',
    code: 'standard_monthly',
    bundledCallsPerPeriod: 1000,
  });
  mockPrisma.subscription.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  // Nothing.
});

const TENANT_FIXTURE = {
  id: 't_1',
  name: 'Acme Care',
  slug: 'acme-care',
  isActive: true,
  memberships: [
    {
      user: {
        email: 'owner@example.com',
        firstName: 'Olivia',
        lastName: 'Owner',
      },
    },
  ],
};

// ─── Single-tenant grandfather ──────────────────────────────────────────────

describe('grandfatherTenant', () => {
  it('creates Subscription + TokenAllocation + BillingEvent + flips status', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(TENANT_FIXTURE);
    const result = await grandfather.grandfatherTenant({ tenantId: 't_1' });

    expect(result.alreadyGrandfathered).toBe(false);
    expect(result.tenantName).toBe('Acme Care');
    expect(result.ownerEmail).toBe('owner@example.com');

    // Stripe customer created
    expect(mockStripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        name: 'Olivia Owner',
        metadata: expect.objectContaining({
          tenantId: 't_1',
          source: 'grandfather_migration',
        }),
      }),
    );

    // Subscription row created with trialing status
    expect(mockPrisma.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't_1',
        planId: 'plan_monthly',
        status: 'trialing',
        stripeCustomerId: 'cus_test_grandfather',
        stripeSubscriptionId: null,
        trialEndsAt: expect.any(Date),
        cancelAtPeriodEnd: false,
      }),
    });

    // TokenAllocation created with bundled calls
    expect(mockPrisma.tokenAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't_1',
        bundledCalls: 1000,
      }),
    });

    // Tenant.subscriptionStatus mirrored
    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't_1' },
      data: { subscriptionStatus: 'trialing' },
    });

    // BillingEvent written
    expect(mockPrisma.billingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't_1',
        kind: 'tenant_grandfathered',
        payload: expect.objectContaining({
          source: 'phase7_rollout',
          trialDays: 30,
        }),
      }),
    });
  });

  it('idempotent: already-grandfathered tenant returns without DB writes', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(TENANT_FIXTURE);
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_existing',
      trialEndsAt: new Date('2026-06-09'),
      currentPeriodEnd: new Date('2026-06-09'),
    });

    const result = await grandfather.grandfatherTenant({ tenantId: 't_1' });

    expect(result.alreadyGrandfathered).toBe(true);
    expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    expect(mockPrisma.billingEvent.create).not.toHaveBeenCalled();
    expect(mockStripe.customers.create).not.toHaveBeenCalled();
  });

  it('uses placeholder stripeCustomerId when Stripe is unconfigured (dev path)', async () => {
    // Override getStripeClient to return null (dev unconfigured).
    vi.mocked(stripeLib.getStripeClient).mockReturnValueOnce(null);
    mockPrisma.tenant.findUnique.mockResolvedValue(TENANT_FIXTURE);

    await grandfather.grandfatherTenant({ tenantId: 't_1' });

    expect(mockStripe.customers.create).not.toHaveBeenCalled();
    expect(mockPrisma.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stripeCustomerId: 'cus_grandfather_t_1',
      }),
    });
  });

  it('throws when tenant does not exist', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    await expect(
      grandfather.grandfatherTenant({ tenantId: 't_missing' }),
    ).rejects.toThrow(/not found/i);
  });

  it('skips inactive tenants', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      ...TENANT_FIXTURE,
      isActive: false,
    });
    await expect(
      grandfather.grandfatherTenant({ tenantId: 't_1' }),
    ).rejects.toThrow(/inactive/i);
  });

  it('throws when Plan row is missing (seed not yet run)', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(TENANT_FIXTURE);
    mockPrisma.plan.findUnique.mockResolvedValue(null);
    await expect(
      grandfather.grandfatherTenant({ tenantId: 't_1' }),
    ).rejects.toThrow(/Plan standard_monthly not found/);
  });
});

// ─── Bulk grandfather ───────────────────────────────────────────────────────

describe('grandfatherAllActiveTenants', () => {
  it('processes every active tenant + collects errors', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: 't_1' },
      { id: 't_fail' },
      { id: 't_2' },
    ]);
    // findUnique resolves for the tenant lookup inside grandfatherTenant.
    // Per-tenant: t_1 + t_2 succeed, t_fail throws inside the helper.
    mockPrisma.tenant.findUnique.mockImplementation(async ({ where }) => {
      const tenantId = (where as { id: string }).id;
      if (tenantId === 't_fail') return null; // triggers "not found" throw
      return { ...TENANT_FIXTURE, id: tenantId };
    });

    const result = await grandfather.grandfatherAllActiveTenants();

    expect(result.results).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.tenantId).toBe('t_fail');
    expect(result.errors[0]?.error).toMatch(/not found/i);
  });
});
