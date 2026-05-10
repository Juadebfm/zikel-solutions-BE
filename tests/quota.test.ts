/**
 * Phase 7.4 — token-metering quota machinery.
 *
 * Locks in:
 *   - Pool exhaustion → 402 AI_QUOTA_EXHAUSTED
 *   - Per-user cap = 0 → 403 AI_DISABLED_FOR_USER
 *   - Per-role cap = 0 → 403 AI_DISABLED_FOR_ROLE
 *   - Per-user cap exceeded → 402 AI_USER_CAP_EXHAUSTED
 *   - Per-role cap exceeded (when no per-user override) → 402 AI_USER_CAP_EXHAUSTED
 *   - debitQuota writes BOTH the allocation increment AND the ledger entry
 *   - creditTopUp writes BOTH the topUpCalls increment AND a credit_topup ledger
 *   - resetExpiredAllocations creates the next-period row + credit_period_reset ledger
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

const { mockPrisma } = vi.hoisted(() => {
  const mp = {
    subscription: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn() },
    tokenAllocation: {
      upsert: vi.fn(),
      update: vi.fn(async () => ({})),
      findMany: vi.fn(),
    },
    tokenLedgerEntry: {
      create: vi.fn(async () => ({})),
      aggregate: vi.fn(async () => ({ _sum: { delta: 0 } })),
      groupBy: vi.fn(async () => []),
    },
    tenantAiRestriction: { findUnique: vi.fn() },
    tenantMembership: { findFirst: vi.fn() },
    tenantUser: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (ops: unknown) => {
      if (typeof ops === 'function') {
        return (ops as (tx: typeof mp) => Promise<unknown>)(mp);
      }
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops;
    }),
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  };
  return { mockPrisma: mp };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

let quota: typeof import('../src/lib/quota.js');

beforeAll(async () => {
  quota = await import('../src/lib/quota.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  // Subscription path is the common one; default to a real subscription
  // returned with 1000 bundled calls.
  mockPrisma.subscription.findUnique.mockResolvedValue({
    currentPeriodStart: new Date('2026-05-01'),
    currentPeriodEnd: new Date('2026-06-01'),
    plan: { bundledCallsPerPeriod: 1000 },
  });
  // Default: no per-tenant restrictions, role=Owner.
  mockPrisma.tenantAiRestriction.findUnique.mockResolvedValue(null);
  mockPrisma.tenantMembership.findFirst.mockResolvedValue({ role: { name: 'Owner' } });
  mockPrisma.tokenLedgerEntry.aggregate.mockResolvedValue({ _sum: { delta: 0 } });
});

afterEach(() => {
  // Nothing to reset.
});

const ALLOCATION_BASE = {
  id: 'alloc_1',
  bundledCalls: 1000,
  topUpCalls: 0,
  usedCalls: 0,
  periodStart: new Date('2026-05-01'),
  periodEnd: new Date('2026-06-01'),
  resetAt: new Date('2026-06-01'),
};

// ─── requireAvailableQuota — pool ───────────────────────────────────────────

describe('requireAvailableQuota — pool exhaustion', () => {
  it('returns the snapshot when pool has remaining calls', async () => {
    mockPrisma.tokenAllocation.upsert.mockResolvedValue({
      ...ALLOCATION_BASE,
      usedCalls: 100,
    });
    const result = await quota.requireAvailableQuota({
      tenantId: 't_1',
      userId: 'u_1',
      surface: 'chat',
    });
    expect(result.remainingCalls).toBe(900);
    expect(result.allocationId).toBe('alloc_1');
  });

  it('throws 402 AI_QUOTA_EXHAUSTED when used >= bundled+topup', async () => {
    mockPrisma.tokenAllocation.upsert.mockResolvedValue({
      ...ALLOCATION_BASE,
      bundledCalls: 1000,
      topUpCalls: 0,
      usedCalls: 1000,
    });
    await expect(
      quota.requireAvailableQuota({ tenantId: 't_1', userId: 'u_1', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 402, code: 'AI_QUOTA_EXHAUSTED' });
  });

  it('counts top-ups toward the available pool', async () => {
    mockPrisma.tokenAllocation.upsert.mockResolvedValue({
      ...ALLOCATION_BASE,
      bundledCalls: 1000,
      topUpCalls: 500,
      usedCalls: 1000, // bundled is exhausted but top-up still has 500
    });
    const result = await quota.requireAvailableQuota({
      tenantId: 't_1',
      userId: 'u_1',
      surface: 'chat',
    });
    expect(result.remainingCalls).toBe(500);
  });
});

// ─── requireAvailableQuota — per-user cap ───────────────────────────────────

describe('requireAvailableQuota — per-user caps', () => {
  it('throws 403 AI_DISABLED_FOR_USER when perUserCap is 0', async () => {
    mockPrisma.tokenAllocation.upsert.mockResolvedValue(ALLOCATION_BASE);
    mockPrisma.tenantAiRestriction.findUnique.mockResolvedValue({
      perRoleCaps: {},
      perUserCaps: { u_1: 0 },
    });
    await expect(
      quota.requireAvailableQuota({ tenantId: 't_1', userId: 'u_1', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'AI_DISABLED_FOR_USER' });
  });

  it('throws 402 AI_USER_CAP_EXHAUSTED when user has hit their cap', async () => {
    mockPrisma.tokenAllocation.upsert.mockResolvedValue(ALLOCATION_BASE);
    mockPrisma.tenantAiRestriction.findUnique.mockResolvedValue({
      perRoleCaps: {},
      perUserCaps: { u_1: 50 },
    });
    mockPrisma.tokenLedgerEntry.aggregate.mockResolvedValue({ _sum: { delta: -50 } });
    await expect(
      quota.requireAvailableQuota({ tenantId: 't_1', userId: 'u_1', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 402, code: 'AI_USER_CAP_EXHAUSTED' });
  });

  it('per-user cap takes precedence over per-role cap', async () => {
    // User cap = 100, role cap = 0. User cap wins (allows access).
    mockPrisma.tokenAllocation.upsert.mockResolvedValue(ALLOCATION_BASE);
    mockPrisma.tenantAiRestriction.findUnique.mockResolvedValue({
      perRoleCaps: { Owner: 0 },
      perUserCaps: { u_1: 100 },
    });
    const result = await quota.requireAvailableQuota({
      tenantId: 't_1',
      userId: 'u_1',
      surface: 'chat',
    });
    expect(result.allocationId).toBe('alloc_1');
  });
});

// ─── requireAvailableQuota — per-role cap ───────────────────────────────────

describe('requireAvailableQuota — per-role caps', () => {
  it('throws 403 AI_DISABLED_FOR_ROLE when perRoleCap is 0', async () => {
    mockPrisma.tokenAllocation.upsert.mockResolvedValue(ALLOCATION_BASE);
    mockPrisma.tenantAiRestriction.findUnique.mockResolvedValue({
      perRoleCaps: { 'Care Worker': 0 },
      perUserCaps: {},
    });
    mockPrisma.tenantMembership.findFirst.mockResolvedValue({ role: { name: 'Care Worker' } });
    await expect(
      quota.requireAvailableQuota({ tenantId: 't_1', userId: 'u_1', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'AI_DISABLED_FOR_ROLE' });
  });

  it("throws 402 AI_USER_CAP_EXHAUSTED when user's role cap is exceeded", async () => {
    mockPrisma.tokenAllocation.upsert.mockResolvedValue(ALLOCATION_BASE);
    mockPrisma.tenantAiRestriction.findUnique.mockResolvedValue({
      perRoleCaps: { 'Care Worker': 50 },
      perUserCaps: {},
    });
    mockPrisma.tenantMembership.findFirst.mockResolvedValue({ role: { name: 'Care Worker' } });
    mockPrisma.tokenLedgerEntry.aggregate.mockResolvedValue({ _sum: { delta: -50 } });
    await expect(
      quota.requireAvailableQuota({ tenantId: 't_1', userId: 'u_1', surface: 'chat' }),
    ).rejects.toMatchObject({ statusCode: 402, code: 'AI_USER_CAP_EXHAUSTED' });
  });

  it('Owner-role with no role cap configured passes', async () => {
    mockPrisma.tokenAllocation.upsert.mockResolvedValue(ALLOCATION_BASE);
    mockPrisma.tenantAiRestriction.findUnique.mockResolvedValue({
      perRoleCaps: { 'Care Worker': 50 },
      perUserCaps: {},
    });
    mockPrisma.tenantMembership.findFirst.mockResolvedValue({ role: { name: 'Owner' } });
    const result = await quota.requireAvailableQuota({
      tenantId: 't_1',
      userId: 'u_owner',
      surface: 'chat',
    });
    expect(result.remainingCalls).toBe(1000);
  });
});

// ─── debitQuota ──────────────────────────────────────────────────────────────

describe('debitQuota', () => {
  it('atomically increments usedCalls AND inserts a debit ledger row', async () => {
    await quota.debitQuota({
      tenantId: 't_1',
      userId: 'u_1',
      allocationId: 'alloc_1',
      surface: 'chat',
      reasonRef: 'msg_42',
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.tokenAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc_1' },
      data: { usedCalls: { increment: 1 } },
    });
    expect(mockPrisma.tokenLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't_1',
        allocationId: 'alloc_1',
        userId: 'u_1',
        kind: 'debit_chat',
        delta: -1,
        reasonRef: 'msg_42',
      }),
    });
  });

  it('maps each AiCallSurface to the correct ledger kind', async () => {
    const cases: Array<['chat' | 'chat_title' | 'dashboard_card' | 'chronology_narrative', string]> = [
      ['chat', 'debit_chat'],
      ['chat_title', 'debit_chat_title'],
      ['dashboard_card', 'debit_dashboard_card'],
      ['chronology_narrative', 'debit_chronology_narrative'],
    ];
    for (const [surface, kind] of cases) {
      vi.clearAllMocks();
      await quota.debitQuota({
        tenantId: 't_1',
        userId: 'u_1',
        allocationId: 'alloc_1',
        surface,
      });
      expect(mockPrisma.tokenLedgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind }),
      });
    }
  });
});

// ─── creditTopUp ─────────────────────────────────────────────────────────────

describe('creditTopUp', () => {
  it('increments topUpCalls AND inserts a credit_topup ledger row', async () => {
    mockPrisma.tokenAllocation.upsert.mockResolvedValue(ALLOCATION_BASE);
    await quota.creditTopUp({
      tenantId: 't_1',
      calls: 1000,
      reasonRef: 'in_test_invoice',
    });
    expect(mockPrisma.tokenAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc_1' },
      data: { topUpCalls: { increment: 1000 } },
    });
    expect(mockPrisma.tokenLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't_1',
        userId: null,
        kind: 'credit_topup',
        delta: 1000,
        reasonRef: 'in_test_invoice',
      }),
    });
  });

  it('rejects non-positive amounts', async () => {
    await expect(
      quota.creditTopUp({ tenantId: 't_1', calls: 0, reasonRef: 'x' }),
    ).rejects.toThrow(/must be positive/i);
    await expect(
      quota.creditTopUp({ tenantId: 't_1', calls: -100, reasonRef: 'x' }),
    ).rejects.toThrow(/must be positive/i);
  });
});

// ─── resetExpiredAllocations ─────────────────────────────────────────────────

describe('resetExpiredAllocations', () => {
  it('creates a next-period allocation + credit_period_reset ledger row', async () => {
    const now = new Date('2026-06-01T12:00:00Z');
    mockPrisma.tokenAllocation.findMany.mockResolvedValue([
      { id: 'alloc_old', tenantId: 't_1' },
    ]);
    // Subscription points to the NEW period that contains `now`.
    mockPrisma.subscription.findUnique.mockResolvedValue({
      currentPeriodStart: new Date('2026-06-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
      plan: { bundledCallsPerPeriod: 1000 },
    });
    mockPrisma.tokenAllocation.upsert.mockResolvedValue({
      id: 'alloc_new',
      bundledCalls: 1000,
      topUpCalls: 0,
      usedCalls: 0,
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-07-01T00:00:00Z'),
      resetAt: new Date('2026-07-01T00:00:00Z'),
    });

    const result = await quota.resetExpiredAllocations(now);
    expect(result).toEqual({ scanned: 1, created: 1 });
    expect(mockPrisma.tokenLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'credit_period_reset',
        delta: 1000,
      }),
    });
  });

  it('skips when the resolved period is not yet active', async () => {
    const now = new Date('2026-06-01T12:00:00Z');
    mockPrisma.tokenAllocation.findMany.mockResolvedValue([
      { id: 'alloc_old', tenantId: 't_1' },
    ]);
    // Subscription's currentPeriodStart is in the FUTURE (this happens
    // momentarily at the boundary if we run the cron just before Stripe
    // ticks the period). We should skip rather than create a phantom row.
    mockPrisma.subscription.findUnique.mockResolvedValue({
      currentPeriodStart: new Date('2026-06-15T00:00:00Z'),
      currentPeriodEnd: new Date('2026-07-15T00:00:00Z'),
      plan: { bundledCallsPerPeriod: 1000 },
    });

    const result = await quota.resetExpiredAllocations(now);
    expect(result).toEqual({ scanned: 1, created: 0 });
    expect(mockPrisma.tokenAllocation.upsert).not.toHaveBeenCalled();
  });
});
