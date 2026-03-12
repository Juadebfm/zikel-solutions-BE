import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { askAi, setUserAiAccess } = vi.hoisted(() => ({
  askAi: vi.fn(),
  setUserAiAccess: vi.fn(),
}));

vi.mock('../src/modules/ai/ai.service.js', () => ({ askAi, setUserAiAccess }));

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

  it('forbids non-admin users from toggling AI access', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/access/user_24',
      headers: authHeader('manager_1', 'manager'),
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(403);
    expect(setUserAiAccess).not.toHaveBeenCalled();
  });

  it('allows admin to toggle AI access', async () => {
    setUserAiAccess.mockResolvedValueOnce({
      userId: 'user_24',
      aiAccessEnabled: true,
      updatedAt: '2026-03-12T08:00:00.000Z',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/access/user_24',
      headers: authHeader('admin_1', 'admin'),
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(setUserAiAccess).toHaveBeenCalledWith('admin_1', 'user_24', { enabled: true });
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        userId: 'user_24',
        aiAccessEnabled: true,
      },
    });
  });

  it('validates AI access toggle body', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/access/user_24',
      headers: authHeader('admin_1', 'admin'),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'FST_ERR_VALIDATION' },
    });
    expect(setUserAiAccess).not.toHaveBeenCalled();
  });
});
