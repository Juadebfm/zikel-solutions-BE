import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, getSummaryStats } = vi.hoisted(() => ({
  mockPrisma: {
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
});
