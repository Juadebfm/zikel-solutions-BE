import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, getSummaryStats } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
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
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user_1', aiAccessEnabled: true });
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
    expect(getSummaryStats).toHaveBeenCalledWith('user_1');
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('returns model response when AI provider succeeds', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user_2', aiAccessEnabled: true });
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
    expect(result.statsSource).toBe('client');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('blocks ask-ai when user AI access is disabled', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user_3', aiAccessEnabled: false });

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
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'user_target' });
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
});
