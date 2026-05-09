import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { askAi, setUserAiAccess, mockPrisma } = vi.hoisted(() => ({
  askAi: vi.fn(),
  setUserAiAccess: vi.fn(),
  mockPrisma: {
    tenantUser: { findUnique: vi.fn() },
    auditLog: { create: vi.fn(async () => ({ id: 'audit_1' })) },
    $transaction: vi.fn(),
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  },
}));

vi.mock('../src/modules/ai/ai.service.js', () => ({ askAi, setUserAiAccess }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

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

// Owner permissions cover ai:admin so requirePermission(AI_ADMIN) passes.
const OWNER_PERMS = [
  'ai:use', 'ai:admin',
  'employees:read', 'homes:read', 'young_people:read', 'tasks:read',
  'safeguarding:read', 'reports:read', 'settings:read',
];

beforeEach(() => {
  vi.clearAllMocks();
  // Default tenant context: an Owner with all permissions. Any test that
  // wants a denied path can override this mockResolvedValueOnce.
  mockPrisma.tenantUser.findUnique.mockResolvedValue({
    id: 'user_default',
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
});

function authHeader(userId = 'user_1', role: 'staff' | 'manager' | 'admin' = 'manager') {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: 'tenant_1',
    tenantRole: 'tenant_admin',
    mfaVerified: true,
    aud: 'tenant',
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
      message: 'Focus on overdue tasks first.',
      highlights: [{
        title: 'Review overdue tasks',
        reason: 'Three tasks are past due',
        urgency: 'high',
        action: 'open_summary_todos_overdue',
      }],
      tip: 'Take one step at a time.',
      actions: [{ label: 'Review overdue tasks', action: 'open_summary_todos_overdue' }],
      source: 'fallback',
      generatedAt: '2026-03-12T07:00:00.000Z',
      meta: {
        model: null,
        page: 'summary',
        strengthProfile: 'staff',
        responseMode: 'focused',
        statsSource: 'server',
        languageSafetyPassed: true,
      },
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
      displayMode: 'auto',
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        source: 'fallback',
        message: 'Focus on overdue tasks first.',
        meta: { model: null, statsSource: 'server' },
      },
    });
  });

  it('accepts daily_logs page payload', async () => {
    askAi.mockResolvedValueOnce({
      message: 'Daily logs summary.',
      highlights: [],
      tip: null,
      actions: [{ label: 'Show submitted logs', action: 'filter_daily_logs_submitted' }],
      source: 'fallback',
      generatedAt: '2026-03-12T07:00:00.000Z',
      meta: {
        model: null,
        page: 'daily_logs',
        strengthProfile: 'staff',
        responseMode: 'focused',
        statsSource: 'none',
        languageSafetyPassed: true,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/ask',
      headers: authHeader('user_daily_logs'),
      payload: {
        query: 'Summarize today logs',
        page: 'daily_logs',
        context: {
          items: [
            {
              id: 'log_1',
              title: 'Daily Log - Northbridge',
              status: 'submitted',
              category: 'daily_log',
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(askAi).toHaveBeenCalledWith('user_daily_logs', {
      query: 'Summarize today logs',
      page: 'daily_logs',
      displayMode: 'auto',
      context: {
        items: [
          {
            id: 'log_1',
            title: 'Daily Log - Northbridge',
            status: 'submitted',
            category: 'daily_log',
          },
        ],
      },
    });
  });

  it('forbids non-admin users from toggling AI access', async () => {
    // Override default Owner mock — Care Worker role lacks `ai:admin` permission.
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'manager_1',
      role: 'manager',
      activeTenantId: 'tenant_1',
      activeTenant: { id: 'tenant_1', isActive: true },
      tenantMemberships: [
        {
          tenantId: 'tenant_1',
          status: 'active',
          role: { name: 'Care Worker', permissions: ['ai:use'] },
        },
      ],
    });

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
