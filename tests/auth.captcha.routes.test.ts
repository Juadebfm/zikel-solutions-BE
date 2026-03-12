import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { checkEmailAvailability } = vi.hoisted(() => ({
  checkEmailAvailability: vi.fn().mockResolvedValue({ available: true }),
}));

vi.mock('../src/modules/auth/auth.service.js', async () => {
  const actual = await vi.importActual<typeof import('../src/modules/auth/auth.service.js')>('../src/modules/auth/auth.service.js');
  return {
    ...actual,
    checkEmailAvailability,
  };
});

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
process.env.CAPTCHA_ENABLED = 'true';
process.env.CAPTCHA_SECRET_KEY = 'captcha_test_secret';
process.env.CAPTCHA_VERIFY_URL = 'https://captcha.example/verify';
process.env.CAPTCHA_MIN_SCORE = '0';

let app: FastifyInstance;

beforeAll(async () => {
  const server = await import('../src/server.js');
  app = await server.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  checkEmailAvailability.mockClear();
});

describe('Auth CAPTCHA middleware', () => {
  it('rejects public auth request when captcha token is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/check-email?email=test@example.com',
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      error: {
        code: 'CAPTCHA_REQUIRED',
      },
    });
  });

  it('rejects public auth request when captcha verification fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/check-email?email=test@example.com',
      headers: {
        'x-captcha-token': 'bad-token',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      error: {
        code: 'CAPTCHA_INVALID',
      },
    });
  });

  it('allows request with valid captcha token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, action: 'auth_check_email', score: 0.9 }),
    }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/check-email?email=test@example.com',
      headers: {
        'x-captcha-token': 'good-token',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(checkEmailAvailability).toHaveBeenCalledWith('test@example.com');
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        available: true,
      },
    });
  });
});
