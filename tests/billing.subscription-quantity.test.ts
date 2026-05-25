import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, mockStripe } = vi.hoisted(() => {
  const mp = {
    home: { aggregate: vi.fn() },
    subscription: {
      findUnique: vi.fn(),
      update: vi.fn(async () => ({})),
    },
  };
  const stripe = {
    subscriptions: { retrieve: vi.fn() },
    subscriptionItems: { update: vi.fn(async () => ({})) },
  };
  return { mockPrisma: mp, mockStripe: stripe };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/stripe.js', () => ({
  getStripeClient: () => mockStripe,
  requireStripeClient: () => mockStripe,
  __resetStripeClientForTests: () => undefined,
}));
vi.mock('../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { getTenantBedCount, syncStripeSubscriptionQuantity } = await import(
  '../src/modules/billing/subscription-quantity.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getTenantBedCount', () => {
  it('returns 1 when the tenant has no configured beds (sum is null)', async () => {
    mockPrisma.home.aggregate.mockResolvedValue({ _sum: { capacity: null } });
    expect(await getTenantBedCount('t_1')).toBe(1);
  });

  it('returns the active-home bed sum', async () => {
    mockPrisma.home.aggregate.mockResolvedValue({ _sum: { capacity: 12 } });
    expect(await getTenantBedCount('t_1')).toBe(12);
  });

  it('floors at 1 even when sum is 0', async () => {
    mockPrisma.home.aggregate.mockResolvedValue({ _sum: { capacity: 0 } });
    expect(await getTenantBedCount('t_1')).toBe(1);
  });

  it('only counts active homes', async () => {
    mockPrisma.home.aggregate.mockResolvedValue({ _sum: { capacity: 7 } });
    await getTenantBedCount('t_1');
    expect(mockPrisma.home.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't_1', isActive: true },
        _sum: { capacity: true },
      }),
    );
  });
});

describe('syncStripeSubscriptionQuantity', () => {
  it('no-ops when the tenant has no Subscription row', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    mockPrisma.home.aggregate.mockResolvedValue({ _sum: { capacity: 5 } });

    await syncStripeSubscriptionQuantity('t_1');

    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mockStripe.subscriptionItems.update).not.toHaveBeenCalled();
  });

  it('updates local snapshot only when Subscription exists without a stripeSubscriptionId', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_local',
      stripeSubscriptionId: null,
      bedCountSnapshot: 2,
    });
    mockPrisma.home.aggregate.mockResolvedValue({ _sum: { capacity: 9 } });

    await syncStripeSubscriptionQuantity('t_1');

    expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub_local' },
      data: { bedCountSnapshot: 9 },
    });
    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it('skips both DB and Stripe writes when bedCountSnapshot already matches', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_local',
      stripeSubscriptionId: 'sub_stripe_1',
      bedCountSnapshot: 12,
    });
    mockPrisma.home.aggregate.mockResolvedValue({ _sum: { capacity: 12 } });

    await syncStripeSubscriptionQuantity('t_1');

    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mockStripe.subscriptionItems.update).not.toHaveBeenCalled();
  });

  it('pushes the new quantity to Stripe and updates the snapshot when bedCount changed', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_local',
      stripeSubscriptionId: 'sub_stripe_1',
      bedCountSnapshot: 5,
    });
    mockPrisma.home.aggregate.mockResolvedValue({ _sum: { capacity: 8 } });
    mockStripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1' }] },
    });

    await syncStripeSubscriptionQuantity('t_1');

    expect(mockStripe.subscriptionItems.update).toHaveBeenCalledWith('si_1', {
      quantity: 8,
      proration_behavior: 'create_prorations',
    });
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub_local' },
      data: expect.objectContaining({
        bedCountSnapshot: 8,
        lastUsageReportedAt: expect.any(Date),
      }),
    });
  });

  it('swallows Stripe errors so home mutations are not broken by a Stripe outage', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_local',
      stripeSubscriptionId: 'sub_stripe_1',
      bedCountSnapshot: 5,
    });
    mockPrisma.home.aggregate.mockResolvedValue({ _sum: { capacity: 8 } });
    mockStripe.subscriptions.retrieve.mockRejectedValue(new Error('stripe is down'));

    // Should NOT throw.
    await expect(syncStripeSubscriptionQuantity('t_1')).resolves.toBeUndefined();
    expect(mockStripe.subscriptionItems.update).not.toHaveBeenCalled();
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });
});
