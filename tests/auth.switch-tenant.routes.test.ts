import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { switchTenant } = vi.hoisted(() => ({
  switchTenant: vi.fn(),
}));

vi.mock('../src/modules/auth/auth.service.js', () => ({
  switchTenant,
}));

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

function authHeader(userId = 'user_1', role: 'staff' | 'manager' | 'admin' = 'staff') {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: 'tenant_1',
    tenantRole: 'staff',
    mfaVerified: true,
    aud: 'tenant',
  });
  return { authorization: `Bearer ${token}` };
}

describe('auth switch-tenant route', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch-tenant',
      payload: { tenantId: 'tenant_1' },
    });

    expect(res.statusCode).toBe(401);
    expect(switchTenant).not.toHaveBeenCalled();
  });

  it('validates request body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch-tenant',
      headers: authHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(switchTenant).not.toHaveBeenCalled();
  });

  it('switches tenant and signs access token with tenant claims', async () => {
    switchTenant.mockResolvedValueOnce({
      user: {
        id: 'user_1',
        email: 'user_1@example.com',
        role: 'staff',
        firstName: 'User',
        middleName: null,
        lastName: 'One',
        gender: null,
        country: 'UK',
        phoneNumber: null,
        avatarUrl: null,
        language: 'en',
        timezone: 'Europe/London',
        emailVerified: true,
        acceptedTerms: true,
        isActive: true,
        aiAccessEnabled: true,
        activeTenantId: 'tenant_1',
        lastLoginAt: null,
        createdAt: new Date('2026-03-12T10:00:00.000Z'),
        updatedAt: new Date('2026-03-12T10:00:00.000Z'),
      },
      session: {
        activeTenantId: 'tenant_1',
        activeTenantRole: 'tenant_admin',
        mfaRequired: true,
        mfaVerified: false,
        memberships: [
          {
            tenantId: 'tenant_1',
            tenantName: 'Acme Care',
            tenantSlug: 'acme-care',
            tenantRole: 'tenant_admin',
          },
        ],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch-tenant',
      headers: authHeader('user_1', 'staff'),
      payload: { tenantId: 'tenant_1' },
    });

    expect(res.statusCode).toBe(200);
    expect(switchTenant).toHaveBeenCalledWith('user_1', 'tenant_1');

    const body = res.json();
    const decoded = app.jwt.verify<{ tenantId: string; tenantRole: string }>(
      body.data.tokens.accessToken,
    );
    expect(decoded.tenantId).toBe('tenant_1');
    expect(decoded.tenantRole).toBe('tenant_admin');
  });
});
