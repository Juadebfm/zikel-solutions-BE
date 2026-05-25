import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => {
  const mp = {
    subscription: { findUnique: vi.fn() },
    home: { count: vi.fn() },
    tenantMembership: { count: vi.fn() },
    invitation: { count: vi.fn() },
  };
  return { mockPrisma: mp };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { assertHomeCapAvailable, assertSeatCapAvailable } = await import(
  '../src/modules/billing/capacity-enforcement.js'
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertHomeCapAvailable', () => {
  it('throws 402 HOME_LIMIT_REACHED when at cap', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      maxHomesOverride: null,
      plan: { maxHomes: 1, code: 'single_home', name: 'Single Home' },
    });
    mockPrisma.home.count.mockResolvedValue(1);

    await expect(assertHomeCapAvailable('t_1')).rejects.toMatchObject({
      statusCode: 402,
      code: 'HOME_LIMIT_REACHED',
    });
  });

  it('allows when below cap', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      maxHomesOverride: null,
      plan: { maxHomes: 5, code: 'multi_home', name: 'Multi-Home' },
    });
    mockPrisma.home.count.mockResolvedValue(3);

    await expect(assertHomeCapAvailable('t_1')).resolves.toBeUndefined();
  });

  it('treats null plan.maxHomes as unlimited (Group tier)', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      maxHomesOverride: null,
      plan: { maxHomes: null, code: 'group', name: 'Group' },
    });
    // Should not even count homes for unlimited tiers.
    await expect(assertHomeCapAvailable('t_1')).resolves.toBeUndefined();
    expect(mockPrisma.home.count).not.toHaveBeenCalled();
  });

  it('prefers maxHomesOverride over plan default', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      maxHomesOverride: 10, // override grants more than the Single Home plan allows
      plan: { maxHomes: 1, code: 'single_home', name: 'Single Home' },
    });
    mockPrisma.home.count.mockResolvedValue(8); // would have failed plan cap of 1

    await expect(assertHomeCapAvailable('t_1')).resolves.toBeUndefined();
  });

  it('skips check (logs warning) when tenant has no Subscription', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    await expect(assertHomeCapAvailable('t_1')).resolves.toBeUndefined();
    expect(mockPrisma.home.count).not.toHaveBeenCalled();
  });
});

describe('assertSeatCapAvailable', () => {
  it('throws 402 SEAT_LIMIT_REACHED when active+pending equals cap', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      maxSeatsOverride: null,
      plan: { maxSeats: 25, code: 'single_home', name: 'Single Home' },
    });
    mockPrisma.tenantMembership.count.mockResolvedValue(20);
    mockPrisma.invitation.count.mockResolvedValue(5); // 20 + 5 = 25, at cap

    await expect(assertSeatCapAvailable('t_1')).rejects.toMatchObject({
      statusCode: 402,
      code: 'SEAT_LIMIT_REACHED',
    });
  });

  it('counts pending invitations toward seats so mass-invite cannot bypass cap', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      maxSeatsOverride: null,
      plan: { maxSeats: 25, code: 'single_home', name: 'Single Home' },
    });
    mockPrisma.tenantMembership.count.mockResolvedValue(0);
    mockPrisma.invitation.count.mockResolvedValue(25); // 25 outstanding invites

    await expect(assertSeatCapAvailable('t_1')).rejects.toMatchObject({
      statusCode: 402,
      code: 'SEAT_LIMIT_REACHED',
    });
  });

  it('only counts non-expired pending invitations', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      maxSeatsOverride: null,
      plan: { maxSeats: 25, code: 'single_home', name: 'Single Home' },
    });
    mockPrisma.tenantMembership.count.mockResolvedValue(10);
    mockPrisma.invitation.count.mockResolvedValue(5);

    await assertSeatCapAvailable('t_1');

    // The invitation query must filter expiresAt > now AND status = pending.
    expect(mockPrisma.invitation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't_1',
          status: 'pending',
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
  });

  it('allows when below cap', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      maxSeatsOverride: null,
      plan: { maxSeats: 75, code: 'multi_home', name: 'Multi-Home' },
    });
    mockPrisma.tenantMembership.count.mockResolvedValue(10);
    mockPrisma.invitation.count.mockResolvedValue(2);

    await expect(assertSeatCapAvailable('t_1')).resolves.toBeUndefined();
  });

  it('treats null plan.maxSeats as unlimited (Group tier)', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      maxSeatsOverride: null,
      plan: { maxSeats: null, code: 'group', name: 'Group' },
    });
    await expect(assertSeatCapAvailable('t_1')).resolves.toBeUndefined();
    expect(mockPrisma.tenantMembership.count).not.toHaveBeenCalled();
  });
});
