/**
 * Tests for the summary-quota helper. Covers:
 *   - Pool-exhausted path (AI_QUOTA_EXHAUSTED, 402)
 *   - Surface-cap-hit path (SUMMARIES_QUOTA_EXHAUSTED, 402)
 *   - Happy path (returns snapshot with both counters)
 *   - Group-tier unlimited inclusion (null cap)
 *   - debitForSummary writes the right ledger row with the right multiplier
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, ensureCurrentAllocation } = vi.hoisted(() => ({
  mockPrisma: {
    subscription: { findUnique: vi.fn() },
    generativeArtifact: { count: vi.fn() },
    tokenAllocation: { update: vi.fn(async () => ({})) },
    tokenLedgerEntry: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(),
  },
  ensureCurrentAllocation: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/quota.js', () => ({ ensureCurrentAllocation }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { requireSummaryQuotaAvailable, debitForSummary, SUMMARY_TOKEN_MULTIPLIER } =
  await import('../src/modules/generative/quota.js');

function makeAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc_1',
    bundledCalls: 1000,
    topUpCalls: 0,
    usedCalls: 100,
    periodStart: new Date('2026-05-01'),
    periodEnd: new Date('2026-06-01'),
    resetAt: new Date('2026-06-01'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default $transaction implementation — execute the array argument or
  // call the callback with the mock client. The helpers we test use the
  // array form, so just resolve to a no-op result for the array path.
  mockPrisma.$transaction.mockImplementation(async (input: unknown) => {
    if (Array.isArray(input)) return input.map(() => ({}));
    if (typeof input === 'function') return (input as (tx: typeof mockPrisma) => unknown)(mockPrisma);
    return input;
  });
});

describe('requireSummaryQuotaAvailable', () => {
  it('returns the snapshot when pool and cap both have room', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      plan: { summariesIncludedPerPeriod: 90, code: 'single_home', name: 'Single Home' },
    });
    ensureCurrentAllocation.mockResolvedValue(makeAllocation());
    mockPrisma.generativeArtifact.count.mockResolvedValue(5);

    const snapshot = await requireSummaryQuotaAvailable('t_1');
    expect(snapshot.summariesIncluded).toBe(90);
    expect(snapshot.summariesUsed).toBe(5);
    expect(snapshot.remainingCalls).toBe(900);
    expect(snapshot.allocationId).toBe('alloc_1');
  });

  it('throws 402 AI_QUOTA_EXHAUSTED when remaining < SUMMARY_TOKEN_MULTIPLIER', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      plan: { summariesIncludedPerPeriod: 90, code: 'single_home', name: 'Single Home' },
    });
    ensureCurrentAllocation.mockResolvedValue(
      // 1000 bundled, 0 top-up, 980 used = 20 remaining; below the 25 floor.
      makeAllocation({ usedCalls: 980 }),
    );

    await expect(requireSummaryQuotaAvailable('t_1')).rejects.toMatchObject({
      statusCode: 402,
      code: 'AI_QUOTA_EXHAUSTED',
    });
    // Skip the surface-cap query when the pool is already empty — pointless work.
    expect(mockPrisma.generativeArtifact.count).not.toHaveBeenCalled();
  });

  it('throws 402 SUMMARIES_QUOTA_EXHAUSTED when at plan cap', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      plan: { summariesIncludedPerPeriod: 90, code: 'single_home', name: 'Single Home' },
    });
    ensureCurrentAllocation.mockResolvedValue(makeAllocation());
    mockPrisma.generativeArtifact.count.mockResolvedValue(90);

    await expect(requireSummaryQuotaAvailable('t_1')).rejects.toMatchObject({
      statusCode: 402,
      code: 'SUMMARIES_QUOTA_EXHAUSTED',
    });
  });

  it('allows when plan cap is null (Group tier — unlimited)', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({
      plan: { summariesIncludedPerPeriod: null, code: 'group', name: 'Group' },
    });
    ensureCurrentAllocation.mockResolvedValue(makeAllocation({ bundledCalls: 50_000 }));
    mockPrisma.generativeArtifact.count.mockResolvedValue(99_999);

    const snapshot = await requireSummaryQuotaAvailable('t_1');
    expect(snapshot.summariesIncluded).toBeNull();
    expect(snapshot.summariesUsed).toBe(99_999);
  });

  it('logs warning and returns dev-friendly snapshot when no Subscription exists', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    ensureCurrentAllocation.mockResolvedValue(makeAllocation());

    const snapshot = await requireSummaryQuotaAvailable('t_dev');
    expect(snapshot.summariesIncluded).toBeNull();
    expect(snapshot.summariesUsed).toBe(0);
    // Should not query GenerativeArtifact in the no-sub path.
    expect(mockPrisma.generativeArtifact.count).not.toHaveBeenCalled();
  });
});

describe('debitForSummary', () => {
  it('increments usedCalls by SUMMARY_TOKEN_MULTIPLIER and writes one ledger row', async () => {
    await debitForSummary({
      tenantId: 't_1',
      userId: 'u_1',
      allocationId: 'alloc_1',
      artifactId: 'art_42',
    });

    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(mockPrisma.tokenAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc_1' },
      data: { usedCalls: { increment: SUMMARY_TOKEN_MULTIPLIER } },
    });
    expect(mockPrisma.tokenLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't_1',
        allocationId: 'alloc_1',
        userId: 'u_1',
        kind: 'debit_generative_summary',
        delta: -SUMMARY_TOKEN_MULTIPLIER,
        reasonRef: 'summary:art_42',
      }),
    });
  });

  it('uses 25 as the multiplier (locks the calibrated value)', () => {
    expect(SUMMARY_TOKEN_MULTIPLIER).toBe(25);
  });
});
