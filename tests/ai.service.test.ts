import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 8.1: ai-access.ts (transitive import) loads env.js at module init.
// Hoisted so the mutation runs BEFORE the static import at line 28 below
// triggers env validation. Plain top-level `process.env.X = …` runs AFTER
// hoisted imports under vitest's ESM-aware loader.
vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
  }
});

const { mockPrisma, getSummaryStats } = vi.hoisted(() => ({
  mockPrisma: {
    tenantUser: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tenantMembership: {
      findUnique: vi.fn(),
      // Phase 7.4: per-role cap lookup uses findFirst.
      findFirst: vi.fn(async () => ({ role: { name: 'Owner' } })),
    },
    home: { count: vi.fn() },
    careGroup: { count: vi.fn() },
    youngPerson: { count: vi.fn() },
    employee: { count: vi.fn() },
    vehicle: { count: vi.fn() },
    task: { count: vi.fn() },
    supportTicket: { count: vi.fn() },
    announcement: { count: vi.fn() },
    auditLog: { create: vi.fn() },
    aiCallEvent: { create: vi.fn(async () => ({ id: 'evt_1' })) },
    // Phase 7.4 — token-metering tables. Defaults emulate "infinite quota
    // available, no restrictions" so existing tests don't need to think about it.
    subscription: { findUnique: vi.fn(async () => null) },
    tenant: { findUnique: vi.fn(async () => ({ createdAt: new Date('2026-04-01') })) },
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
    tokenLedgerEntry: {
      create: vi.fn(async () => ({})),
      aggregate: vi.fn(async () => ({ _sum: { delta: 0 } })),
    },
    tenantAiRestriction: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops;
    }),
  },
  getSummaryStats: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/modules/summary/summary.service.js', () => ({ getSummaryStats }));

import * as aiService from '../src/modules/ai/ai.service.js';

const ORIGINAL_ENV = { ...process.env };

// Permission catalogue subset — Owner gets all permissions; staff get a
// minimal subset. The actual values mirror src/auth/permissions.ts.
const OWNER_PERMS = ['homes:read', 'young_people:read', 'tasks:read', 'tasks:approve',
  'employees:read', 'reports:read', 'reports:export', 'settings:write',
  'members:write', 'safeguarding:read', 'announcements:read', 'vehicles:read', 'ai:use'];
const STAFF_PERMS = ['care_logs:read', 'care_logs:write', 'tasks:read', 'ai:use'];

/**
 * Builds the two consecutive `tenantUser.findUnique` responses the askAi flow
 * needs: first for `requireTenantContext` (full user + activeTenant +
 * tenantMemberships), then for `assertAiEnabledForRequest` (Phase 8.1 shape:
 * `{ id, aiAccessEnabled, activeTenantId, activeTenant: { id, aiEnabled, isActive } }`).
 *
 * `roleName` controls the derived legacy `tenantRole`:
 *   - 'Owner' → tenant_admin → strengthProfile 'owner'
 *   - 'Admin' → sub_admin   → strengthProfile 'manager'
 *   - 'Care Worker' → staff → strengthProfile 'staff'
 */
function mockUserAndAccess(args: {
  userId: string;
  userRole?: 'staff' | 'manager' | 'admin';
  roleName?: 'Owner' | 'Admin' | 'Care Worker' | 'Read-Only';
  permissions?: string[];
  aiAccessEnabled?: boolean;
  tenantAiEnabled?: boolean;
}) {
  const userRole = args.userRole ?? 'staff';
  const roleName = args.roleName ?? 'Care Worker';
  const permissions = args.permissions ?? STAFF_PERMS;
  const tenantAiEnabled = args.tenantAiEnabled ?? true;
  mockPrisma.tenantUser.findUnique
    .mockResolvedValueOnce({
      id: args.userId,
      role: userRole,
      activeTenantId: 'tenant_1',
      activeTenant: { id: 'tenant_1', isActive: true },
      tenantMemberships: [
        {
          tenantId: 'tenant_1',
          status: 'active',
          role: { name: roleName, permissions },
        },
      ],
    })
    .mockResolvedValueOnce({
      id: args.userId,
      aiAccessEnabled: args.aiAccessEnabled ?? true,
      activeTenantId: 'tenant_1',
      activeTenant: { id: 'tenant_1', aiEnabled: tenantAiEnabled, isActive: true },
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AI_ENABLED;
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_TIMEOUT_MS;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ai.service', () => {
  it('returns fallback response when AI is disabled', async () => {
    mockUserAndAccess({ userId: 'user_1' });
    process.env.AI_ENABLED = 'false';
    getSummaryStats.mockResolvedValueOnce({
      overdue: 3,
      dueToday: 1,
      pendingApproval: 2,
      rejected: 0,
      draft: 0,
      future: 4,
      comments: 0,
      rewards: 0,
    });

    const result = await aiService.askAi('user_1', {
      query: 'What should I focus on?',
      page: 'summary',
    });

    expect(result.source).toBe('fallback');
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.meta).toMatchObject({
      strengthProfile: 'staff',
      statsSource: 'server',
      languageSafetyPassed: true,
    });
    expect(getSummaryStats).toHaveBeenCalledWith('user_1');
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns model response when AI provider succeeds', async () => {
    mockUserAndAccess({ userId: 'user_2' });
    process.env.AI_ENABLED = 'true';
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_BASE_URL = 'https://example.com/v1';
    process.env.AI_MODEL = 'test-model';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Model-backed answer' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await aiService.askAi('user_2', {
      query: 'Summarize today',
      page: 'summary',
      context: {
        stats: { overdue: 0, dueToday: 1, pendingApproval: 0 },
      },
    });

    expect(result.source).toBe('model');
    expect(result.message).toBe('Model-backed answer');
    expect(result.meta).toMatchObject({
      model: 'test-model',
      statsSource: 'client',
      languageSafetyPassed: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('redacts sensitive model prompt context before provider call', async () => {
    mockUserAndAccess({ userId: 'user_2' });
    process.env.AI_ENABLED = 'true';
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_BASE_URL = 'https://example.com/v1';
    process.env.AI_MODEL = 'test-model';
    process.env.AI_CONTEXT_REDACTION_ENABLED = 'true';
    process.env.AI_CONTEXT_REDACTION_MODE = 'strict';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Redacted model answer' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await aiService.askAi('user_2', {
      query: 'Call ava.morris@example.com on +44 7000 100 222',
      page: 'daily_logs',
      context: {
        items: [
          {
            id: 'cmnajj6070005ifplto8d5kji',
            title: 'Daily log for Ava Morris',
            status: 'submitted',
            assignee: 'Ava Morris',
            home: 'Northbridge Home',
            extra: {
              contactEmail: 'ava.morris@example.com',
              phone: '+44 7000 100 222',
            },
          },
        ],
      },
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const prompt = requestBody.messages?.[1]?.content as string;
    expect(prompt).toContain('[redacted-email]');
    expect(prompt).toContain('[redacted-phone]');
    expect(prompt).not.toContain('ava.morris@example.com');
    expect(prompt).not.toContain('+44 7000 100 222');
  });

  it('blocks ask-ai when user AI access is disabled', async () => {
    mockUserAndAccess({ userId: 'user_3', aiAccessEnabled: false });

    await expect(
      aiService.askAi('user_3', {
        query: 'What should I focus on?',
        page: 'summary',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'AI_ACCESS_DISABLED',
    });

    expect(getSummaryStats).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('allows admin to enable AI access for another tenant member', async () => {
    // setUserAiAccess: actor lookup, then requireTenantContext, then membership check, then update.
    mockPrisma.tenantUser.findUnique
      // actor lookup at start of setUserAiAccess
      .mockResolvedValueOnce({ id: 'admin_1', role: 'admin' })
      // requireTenantContext
      .mockResolvedValueOnce({
        id: 'admin_1',
        role: 'admin',
        activeTenantId: 'tenant_1',
        activeTenant: { id: 'tenant_1', isActive: true },
        tenantMemberships: [
          {
            tenantId: 'tenant_1',
            status: 'active',
            role: { name: 'Owner', permissions: OWNER_PERMS },
          },
        ],
      });
    mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce({ status: 'active' });
    mockPrisma.tenantUser.update.mockResolvedValueOnce({
      id: 'user_target',
      aiAccessEnabled: true,
      updatedAt: new Date('2026-03-12T08:00:00.000Z'),
    });

    const result = await aiService.setUserAiAccess('admin_1', 'user_target', { enabled: true });

    expect(mockPrisma.tenantUser.update).toHaveBeenCalledWith({
      where: { id: 'user_target' },
      data: { aiAccessEnabled: true },
      select: { id: true, aiAccessEnabled: true, updatedAt: true },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant_1',
        userId: 'admin_1',
        action: 'permission_changed',
        entityType: 'user_ai_access',
        entityId: 'user_target',
        metadata: { enabled: true },
      },
    });
    expect(result).toMatchObject({
      userId: 'user_target',
      aiAccessEnabled: true,
    });
  });

  it('returns consolidated platform snapshot for owner profile on summary', async () => {
    mockUserAndAccess({
      userId: 'owner_1',
      userRole: 'admin',
      roleName: 'Owner',
      permissions: OWNER_PERMS,
    });
    process.env.AI_ENABLED = 'false';
    getSummaryStats.mockResolvedValueOnce({
      overdue: 3,
      dueToday: 1,
      pendingApproval: 2,
      rejected: 0,
      draft: 0,
      future: 4,
      comments: 0,
      rewards: 0,
    });
    mockPrisma.home.count.mockResolvedValueOnce(5);
    mockPrisma.careGroup.count.mockResolvedValueOnce(2);
    mockPrisma.youngPerson.count.mockResolvedValueOnce(24);
    mockPrisma.employee.count.mockResolvedValueOnce(19);
    mockPrisma.vehicle.count.mockResolvedValueOnce(6);
    mockPrisma.task.count
      .mockResolvedValueOnce(41)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(4);
    mockPrisma.supportTicket.count.mockResolvedValueOnce(3);
    mockPrisma.announcement.count.mockResolvedValueOnce(1);

    const result = await aiService.askAi('owner_1', {
      query: 'What should I focus on today?',
      page: 'summary',
      context: {
        todos: [
          { title: 'Medication review', priority: 'high', dueDate: new Date(Date.now() - 60_000).toISOString() },
        ],
      },
    });

    expect(result.source).toBe('fallback');
    expect(result.meta.strengthProfile).toBe('owner');
    // Owner profile pulls a platform snapshot; we verify it via the count
    // queries that get fired (Home/CareGroup/Task counts are owner-only) plus
    // the fact that `highlights` end up populated.
    expect(mockPrisma.home.count).toHaveBeenCalledTimes(1);
    expect(mockPrisma.careGroup.count).toHaveBeenCalledTimes(1);
    expect(Array.isArray(result.highlights)).toBe(true);
  });

  it('applies non-blaming language guardrails to model responses', async () => {
    mockUserAndAccess({ userId: 'user_4' });
    process.env.AI_ENABLED = 'true';
    process.env.AI_API_KEY = 'test-key';
    process.env.AI_BASE_URL = 'https://example.com/v1';
    process.env.AI_MODEL = 'test-model';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'The child was non-compliant and attention-seeking.' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await aiService.askAi('user_4', {
      query: 'What should I focus on?',
      page: 'summary',
      displayMode: 'minimal',
      context: {
        todos: [{ title: 'Medication review', priority: 'high' }],
      },
    });

    expect(result.source).toBe('model');
    expect(result.message.toLowerCase()).not.toContain('non-compliant');
    expect(result.message.toLowerCase()).not.toContain('attention-seeking');
    // Guardrails pass through `meta.languageSafetyPassed`; granular
    // `flaggedTerms` are kept inside the audit-log metadata, not exposed in
    // the API response. We verify the audit-log captured the rewrite.
    expect(result.meta.languageSafetyPassed).toBe(true);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({ languageGuardrailApplied: true }),
      }),
    });
  });
});
