/**
 * Tests for the daily-log summary generator.
 *
 * Coverage:
 *   - Source-fetch query shape (correct date window, correct filters)
 *   - No-source-records short-circuit
 *   - Fallback content path when AI disabled
 *   - Fallback content path when provider call fails
 *   - Model path: real shape returned and persisted with `source: 'model'`
 *   - Schema validation failures fall back gracefully
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, env } = vi.hoisted(() => ({
  mockPrisma: {
    task: { findMany: vi.fn() },
  },
  // Mutable env stub so each test can toggle AI_ENABLED at runtime.
  // Mocking src/config/env.js entirely bypasses the Zod validation at module
  // load and gives us a single object the generator reads from on each call.
  env: {
    AI_ENABLED: false,
    AI_API_KEY: undefined as string | undefined,
    AI_BASE_URL: 'https://api.openai.com/v1',
    AI_MODEL: 'gpt-5.4-mini',
    AI_TIMEOUT_MS: 12000,
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/config/env.js', () => ({ env }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { generateDailyLogSummary, DAILY_LOG_SUMMARY_PROMPT_VERSION } = await import(
  '../src/modules/generative/daily-log-summary.generator.js'
);

// Capture fetch invocations.
const fetchSpy = vi.fn();
const realFetch = globalThis.fetch;

function makeLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_1',
    title: 'Morning shift',
    description: 'Quiet start; breakfast served at 08:00.',
    submittedAt: new Date('2026-05-26T08:30:00.000Z'),
    submissionPayload: { dailyLogCategory: 'general' },
    youngPersonId: null,
    homeId: 'h_1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchSpy;
});

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
});

describe('source fetch', () => {
  it('queries Task rows with the right category, home, and date window', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    env.AI_ENABLED = false;

    await generateDailyLogSummary({ tenantId: 't_1', homeId: 'h_1', date: '2026-05-26' });

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't_1',
          homeId: 'h_1',
          category: 'daily_log',
          deletedAt: null,
          submittedAt: {
            gte: new Date('2026-05-26T00:00:00.000Z'),
            lt: new Date('2026-05-27T00:00:00.000Z'),
          },
        }),
        orderBy: { submittedAt: 'asc' },
      }),
    );
  });

  it('returns { noSourceRecords: true } when zero logs found', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const result = await generateDailyLogSummary({
      tenantId: 't_1',
      homeId: 'h_1',
      date: '2026-05-26',
    });

    expect(result).toEqual({ noSourceRecords: true });
  });
});

describe('fallback path (no AI)', () => {
  beforeEach(() => {
    env.AI_ENABLED = false;
    env.AI_API_KEY = undefined;
  });

  it('returns deterministic fallback content marked source:fallback', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      makeLog(),
      makeLog({ id: 'task_2', title: 'Afternoon', description: 'YP did homework.' }),
    ]);

    const result = await generateDailyLogSummary({
      tenantId: 't_1',
      homeId: 'h_1',
      date: '2026-05-26',
    });

    if ('noSourceRecords' in result) throw new Error('expected content');
    expect(result.source).toBe('fallback');
    expect(result.modelId).toBe('fallback');
    expect(result.promptVersion).toBe(DAILY_LOG_SUMMARY_PROMPT_VERSION);
    expect(result.sourceRecordIds).toEqual(['task_1', 'task_2']);
    expect(result.content.shiftHighlights.length).toBeGreaterThan(0);
    expect(result.content.languageSafetyPassed).toBe(true);
    // No real network call should have been attempted.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('model path', () => {
  beforeEach(() => {
    env.AI_ENABLED = true;
    env.AI_API_KEY = 'sk_test_dummy';
    env.AI_BASE_URL = 'https://api.openai.com/v1';
    env.AI_MODEL = 'gpt-5.4-mini';
    env.AI_TIMEOUT_MS = 12000;
  });

  it('returns content from the provider when the response is valid JSON matching the schema', async () => {
    mockPrisma.task.findMany.mockResolvedValue([makeLog()]);
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                shiftHighlights: ['Quiet morning.', 'Breakfast at 8.'],
                incidentsOfNote: [],
                safeguardingFlags: [],
                followUpRequired: [],
                freeformSummary: 'A calm morning shift with breakfast served on time.',
                languageSafetyPassed: true,
              }),
            },
          },
        ],
      }),
    });

    const result = await generateDailyLogSummary({
      tenantId: 't_1',
      homeId: 'h_1',
      date: '2026-05-26',
    });
    if ('noSourceRecords' in result) throw new Error('expected content');

    expect(result.source).toBe('model');
    expect(result.modelId).toBe('gpt-5.4-mini');
    expect(result.content.shiftHighlights).toContain('Quiet morning.');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('falls back when the provider returns a non-2xx response', async () => {
    mockPrisma.task.findMany.mockResolvedValue([makeLog()]);
    fetchSpy.mockResolvedValue({ ok: false, status: 502 });

    const result = await generateDailyLogSummary({
      tenantId: 't_1',
      homeId: 'h_1',
      date: '2026-05-26',
    });
    if ('noSourceRecords' in result) throw new Error('expected content');
    expect(result.source).toBe('fallback');
  });

  it('falls back when the provider returns malformed JSON', async () => {
    mockPrisma.task.findMany.mockResolvedValue([makeLog()]);
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'not json at all' } }],
      }),
    });

    const result = await generateDailyLogSummary({
      tenantId: 't_1',
      homeId: 'h_1',
      date: '2026-05-26',
    });
    if ('noSourceRecords' in result) throw new Error('expected content');
    expect(result.source).toBe('fallback');
  });

  it('falls back when the response is JSON but fails Zod validation', async () => {
    mockPrisma.task.findMany.mockResolvedValue([makeLog()]);
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ wrongShape: true }),
            },
          },
        ],
      }),
    });

    const result = await generateDailyLogSummary({
      tenantId: 't_1',
      homeId: 'h_1',
      date: '2026-05-26',
    });
    if ('noSourceRecords' in result) throw new Error('expected content');
    expect(result.source).toBe('fallback');
  });
});
