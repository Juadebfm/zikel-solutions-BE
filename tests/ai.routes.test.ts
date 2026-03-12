import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { askAi } = vi.hoisted(() => ({
  askAi: vi.fn(),
}));

vi.mock('../src/modules/ai/ai.service.js', () => ({ askAi }));

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';

let app: FastifyInstance;

beforeAll(async () => {
  const server = await import('../src/server.js');
  app = await server.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function authHeader(userId = 'user_1', role: 'staff' | 'manager' | 'admin' = 'manager') {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
  });
  return { authorization: `Bearer ${token}` };
}

describe('AI routes', () => {
  it('rejects unauthenticated request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      payload: { query: 'What should I focus on?' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns validation error for short query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      headers: authHeader(),
      payload: { query: 'hi' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'FST_ERR_VALIDATION' },
    });
  });

  it('returns ask-ai payload on success', async () => {
    askAi.mockResolvedValueOnce({
      answer: 'Focus on overdue tasks first.',
      suggestions: [{ label: 'Review overdue tasks', action: 'open_summary_todos_overdue' }],
      source: 'fallback',
      model: null,
      statsSource: 'server',
      generatedAt: '2026-03-12T07:00:00.000Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      headers: authHeader('user_42'),
      payload: { query: 'What should I focus on?' },
    });

    expect(res.statusCode).toBe(200);
    expect(askAi).toHaveBeenCalledWith('user_42', {
      query: 'What should I focus on?',
      page: 'summary',
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        source: 'fallback',
        model: null,
      },
    });
  });
});
