import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, getSummaryStats } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    tenantMembership: {
      findUnique: vi.fn(),
    },
    home: {
      count: vi.fn(),
    },
    careGroup: {
      count: vi.fn(),
    },
    youngPerson: {
      count: vi.fn(),
    },
    employee: {
      count: vi.fn(),
    },
    vehicle: {
      count: vi.fn(),
    },
    task: {
      count: vi.fn(),
    },
    supportTicket: {
      count: vi.fn(),
    },
    announcement: {
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
  getSummaryStats: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/modules/summary/summary.service.js', () => ({ getSummaryStats }));

import * as aiService from '../src/modules/ai/ai.service.js';

const ORIGINAL_ENV = { ...process.env };

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
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user_1', role: 'staff', activeTenantId: 'tenant_1' })
      .mockResolvedValueOnce({ id: 'user_1', aiAccessEnabled: true });
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 'tenant_1', isActive: true });
    mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce({
      role: 'staff',
      status: 'active',
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

    const result = await aiService.askAi('user_1', {
      query: 'What should I focus on?',
      page: 'summary',
    });

    expect(result.source).toBe('fallback');
    expect(result.statsSource).toBe('server');
    expect(result.answer.toLowerCase()).toContain('focus');
    expect(result.minimalResponse).toMatchObject({
      enabled: true,
    });
    expect(result.languageSafety.rubric.version).toBe('pace-language-v1');
    expect(result.promptQa.passed).toBe(true);
    expect(result.analysis.curiosity.patternInsightSummaries.length).toBeGreaterThanOrEqual(0);
    expect(result.analysis.strengthProfile).toBe('staff');
    expect(result.analysis.platformSnapshot).toBeNull();
    expect(getSummaryStats).toHaveBeenCalledWith('user_1');
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns model response when AI provider succeeds', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user_2', role: 'staff', activeTenantId: 'tenant_1' })
      .mockResolvedValueOnce({ id: 'user_2', aiAccessEnabled: true });
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 'tenant_1', isActive: true });
    mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce({
      role: 'staff',
      status: 'active',
    });
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
        stats: {
          overdue: 0,
          dueToday: 1,
          pendingApproval: 0,
        },
      },
    });

    expect(result.source).toBe('model');
    expect(result.model).toBe('test-model');
    expect(result.answer).toBe('Model-backed answer');
    expect(result.languageSafety.rubric.passed).toBe(true);
    expect(result.minimalResponse.enabled).toBe(true);
    expect(result.statsSource).toBe('client');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('redacts sensitive model prompt context before provider call', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user_2', role: 'staff', activeTenantId: 'tenant_1' })
      .mockResolvedValueOnce({ id: 'user_2', aiAccessEnabled: true });
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 'tenant_1', isActive: true });
    mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce({
      role: 'staff',
      status: 'active',
    });
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
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user_3', role: 'staff', activeTenantId: 'tenant_1' })
      .mockResolvedValueOnce({ id: 'user_3', aiAccessEnabled: false });
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 'tenant_1', isActive: true });
    mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce({
      role: 'staff',
      status: 'active',
    });

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

  it('allows admin service to enable AI access for a user', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'admin_1', role: 'super_admin' })
      .mockResolvedValueOnce({ id: 'user_target' });
    mockPrisma.user.update.mockResolvedValueOnce({
      id: 'user_target',
      aiAccessEnabled: true,
      updatedAt: new Date('2026-03-12T08:00:00.000Z'),
    });

    const result = await aiService.setUserAiAccess('admin_1', 'user_target', { enabled: true });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_target' },
      data: { aiAccessEnabled: true },
      select: {
        id: true,
        aiAccessEnabled: true,
        updatedAt: true,
      },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: null,
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
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'owner_1', role: 'staff', activeTenantId: 'tenant_1' })
      .mockResolvedValueOnce({ id: 'owner_1', aiAccessEnabled: true });
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 'tenant_1', isActive: true });
    mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce({
      role: 'tenant_admin',
      status: 'active',
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
    expect(result.analysis.strengthProfile).toBe('owner');
    expect(result.minimalResponse.enabled).toBe(false);
    expect(result.analysis.platformSnapshot).toMatchObject({
      homes: 5,
      careGroups: 2,
      openTasks: 41,
      overdueTasks: 7,
      openSupportTickets: 3,
    });
    expect(result.analysis.topPriorities.length).toBeGreaterThan(0);
    expect(result.analysis.curiosity.exploreNext.length).toBeGreaterThan(0);
    expect(mockPrisma.home.count).toHaveBeenCalledTimes(1);
  });

  it('applies non-blaming language guardrails to model responses', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user_4', role: 'staff', activeTenantId: 'tenant_1' })
      .mockResolvedValueOnce({ id: 'user_4', aiAccessEnabled: true });
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 'tenant_1', isActive: true });
    mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce({
      role: 'staff',
      status: 'active',
    });
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
    expect(result.answer.toLowerCase()).not.toContain('non-compliant');
    expect(result.answer.toLowerCase()).not.toContain('attention-seeking');
    expect(result.languageSafety.nonBlamingGuardrailsApplied).toBe(true);
    expect(result.languageSafety.flaggedTerms).toEqual(
      expect.arrayContaining(['non_compliant', 'attention_seeking']),
    );
    expect(result.promptQa.passed).toBe(true);
  });
});
