import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { requestMfaChallenge, verifyMfaChallenge } = vi.hoisted(() => ({
  requestMfaChallenge: vi.fn(),
  verifyMfaChallenge: vi.fn(),
}));

vi.mock('../src/modules/auth/auth.service.js', () => ({
  requestMfaChallenge,
  verifyMfaChallenge,
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

function authHeader(
  userId = 'super_1',
  role: 'super_admin' | 'staff' | 'manager' | 'admin' = 'super_admin',
) {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: 'tenant_1',
    tenantRole: role === 'staff' ? 'tenant_admin' : null,
    mfaVerified: false,
  });
  return { authorization: `Bearer ${token}` };
}

describe('auth MFA routes', () => {
  it('rejects unauthenticated challenge requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/challenge',
    });

    expect(res.statusCode).toBe(401);
    expect(requestMfaChallenge).not.toHaveBeenCalled();
  });

  it('requests MFA challenge for authenticated user', async () => {
    requestMfaChallenge.mockResolvedValueOnce({
      message: 'MFA code sent to your email.',
      cooldownSeconds: 60,
      otpDeliveryStatus: 'sent',
      resendAvailableAt: '2026-03-12T10:01:00.000Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/challenge',
      headers: authHeader('super_1', 'super_admin'),
    });

    expect(res.statusCode).toBe(200);
    expect(requestMfaChallenge).toHaveBeenCalledWith('super_1');
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        otpDeliveryStatus: 'sent',
      },
    });
  });

  it('validates MFA verify payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      headers: authHeader('super_1', 'super_admin'),
      payload: {
        code: '12345',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(verifyMfaChallenge).not.toHaveBeenCalled();
  });

  it('verifies MFA and returns an access token with mfaVerified=true', async () => {
    verifyMfaChallenge.mockResolvedValueOnce({
      user: {
        id: 'super_1',
        email: 'super_1@example.com',
        role: 'super_admin',
        firstName: 'Super',
        middleName: null,
        lastName: 'Admin',
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
        activeTenantId: null,
        lastLoginAt: null,
        createdAt: new Date('2026-03-12T10:00:00.000Z'),
        updatedAt: new Date('2026-03-12T10:00:00.000Z'),
      },
      session: {
        activeTenantId: null,
        activeTenantRole: null,
        memberships: [],
        mfaRequired: true,
        mfaVerified: true,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      headers: authHeader('super_1', 'super_admin'),
      payload: {
        code: '123456',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(verifyMfaChallenge).toHaveBeenCalledWith('super_1', { code: '123456' });

    const body = res.json();
    const decoded = app.jwt.verify<{ mfaVerified: boolean }>(body.data.tokens.accessToken);
    expect(decoded.mfaVerified).toBe(true);
  });
});
