import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const {
  login,
  refreshAccessToken,
  getSessionExpiry,
} = vi.hoisted(() => ({
  login: vi.fn(),
  refreshAccessToken: vi.fn(),
  getSessionExpiry: vi.fn(),
}));

vi.mock('../src/modules/auth/auth.service.js', () => ({
  login,
  refreshAccessToken,
  getSessionExpiry,
}));

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
process.env.SESSION_WARNING_WINDOW_SECONDS = '300';
process.env.AUTH_LEGACY_REFRESH_TOKEN_IN_BODY = 'false';

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

function authHeader(userId = 'user_1') {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role: 'staff',
  });
  return { authorization: `Bearer ${token}` };
}

const baseUser = {
  id: 'user_1',
  email: 'user_1@example.com',
  role: 'staff' as const,
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
};

const baseSession = {
  activeTenantId: 'tenant_1',
  activeTenantRole: 'tenant_admin' as const,
  mfaRequired: false,
  mfaVerified: true,
  memberships: [
    {
      tenantId: 'tenant_1',
      tenantName: 'Acme Care',
      tenantSlug: 'acme-care',
      tenantRole: 'tenant_admin' as const,
    },
  ],
};

describe('auth session expiry contract routes', () => {
  it('includes server/session/token expiry metadata on login response', async () => {
    login.mockResolvedValueOnce({
      user: baseUser,
      refreshToken: 'refresh_token_1',
      session: baseSession,
      sessionExpiry: {
        idleExpiresAt: new Date('2026-04-01T12:30:00.000Z'),
        absoluteExpiresAt: new Date('2026-04-01T20:00:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'user_1@example.com',
        password: 'Password123!',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.serverTime).toEqual(expect.any(String));
    expect(new Date(body.data.serverTime).toString()).not.toBe('Invalid Date');
    expect(body.data.session).toMatchObject({
      idleExpiresAt: '2026-04-01T12:30:00.000Z',
      absoluteExpiresAt: '2026-04-01T20:00:00.000Z',
      warningWindowSeconds: 300,
    });
    expect(body.data.tokens).toMatchObject({
      accessToken: expect.any(String),
      accessTokenExpiresAt: expect.any(String),
      refreshTokenExpiresAt: '2026-04-01T20:00:00.000Z',
    });
    expect(body.data.tokens.refreshToken).toBeUndefined();
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    expect(String(setCookie)).toContain('zikel_rt=');
    expect(String(setCookie)).toContain('HttpOnly');
  });

  it('includes server/session/token expiry metadata on refresh response', async () => {
    refreshAccessToken.mockResolvedValueOnce({
      user: baseUser,
      newRefreshToken: 'refresh_token_2',
      session: baseSession,
      sessionExpiry: {
        idleExpiresAt: new Date('2026-04-01T12:35:00.000Z'),
        absoluteExpiresAt: new Date('2026-04-01T20:00:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'refresh_token_1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.serverTime).toEqual(expect.any(String));
    expect(body.data.session).toMatchObject({
      idleExpiresAt: '2026-04-01T12:35:00.000Z',
      absoluteExpiresAt: '2026-04-01T20:00:00.000Z',
      warningWindowSeconds: 300,
    });
    expect(body.data.tokens).toMatchObject({
      accessTokenExpiresAt: expect.any(String),
      refreshTokenExpiresAt: '2026-04-01T20:00:00.000Z',
    });
    expect(body.data.tokens.refreshToken).toBeUndefined();
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    expect(String(setCookie)).toContain('zikel_rt=');
    expect(String(setCookie)).toContain('HttpOnly');
  });

  it('accepts refresh token from HttpOnly cookie when body is empty', async () => {
    refreshAccessToken.mockResolvedValueOnce({
      user: baseUser,
      newRefreshToken: 'refresh_token_3',
      session: baseSession,
      sessionExpiry: {
        idleExpiresAt: new Date('2026-04-01T12:40:00.000Z'),
        absoluteExpiresAt: new Date('2026-04-01T20:00:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: '__Host-zikel_rt=refresh_token_cookie_1' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledWith('refresh_token_cookie_1');
  });

  it('clears refresh cookie when refresh fails with terminal session-expiry code', async () => {
    refreshAccessToken.mockRejectedValueOnce({
      statusCode: 401,
      code: 'SESSION_IDLE_EXPIRED',
      message: 'Session expired due to inactivity. Please sign in again.',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: '__Host-zikel_rt=expired_refresh_token' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'SESSION_IDLE_EXPIRED' },
    });
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    expect(String(setCookie)).toContain('zikel_rt=');
    expect(String(setCookie)).toContain('Expires=');
  });

  it('clears refresh cookie when refresh fails with replay code', async () => {
    refreshAccessToken.mockRejectedValueOnce({
      statusCode: 401,
      code: 'REFRESH_TOKEN_REUSED',
      message: 'Refresh token has already been used. Please sign in again.',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: '__Host-zikel_rt=reused_refresh_token' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'REFRESH_TOKEN_REUSED' },
    });
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    expect(String(setCookie)).toContain('zikel_rt=');
    expect(String(setCookie)).toContain('Expires=');
  });

  it('does not clear refresh cookie when refresh fails with generic invalid code', async () => {
    refreshAccessToken.mockRejectedValueOnce({
      statusCode: 401,
      code: 'REFRESH_TOKEN_INVALID',
      message: 'Refresh token is invalid.',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: '__Host-zikel_rt=unknown_refresh_token' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'REFRESH_TOKEN_INVALID' },
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns ISO expiry timestamps from session-expiry endpoint', async () => {
    getSessionExpiry.mockResolvedValueOnce({
      serverTime: '2026-04-01T12:00:00.000Z',
      session: {
        idleExpiresAt: new Date('2026-04-01T12:30:00.000Z'),
        absoluteExpiresAt: new Date('2026-04-01T20:00:00.000Z'),
      },
      tokens: {
        refreshTokenExpiresAt: new Date('2026-04-01T20:00:00.000Z'),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session-expiry?token=refresh_token_2',
      headers: authHeader('user_1'),
    });

    expect(res.statusCode).toBe(200);
    expect(getSessionExpiry).toHaveBeenCalledWith('user_1', 'refresh_token_2');
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        serverTime: '2026-04-01T12:00:00.000Z',
        session: {
          idleExpiresAt: '2026-04-01T12:30:00.000Z',
          absoluteExpiresAt: '2026-04-01T20:00:00.000Z',
          warningWindowSeconds: 300,
        },
        tokens: {
          refreshTokenExpiresAt: '2026-04-01T20:00:00.000Z',
        },
      },
    });
  });
});
