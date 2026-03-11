import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const runSmoke = process.env.RUN_DB_SMOKE === '1';
const maybeDescribe = runSmoke ? describe : describe.skip;

let app: FastifyInstance;

maybeDescribe('Seeded summary provisions smoke', () => {
  beforeAll(async () => {
    const server = await import('../src/server.js');
    app = await server.buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns seeded events and shifts for manager account', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'manager@zikel.dev',
        password: 'Admin1234!',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const accessToken = loginRes.json().data?.tokens?.accessToken as string | undefined;
    expect(accessToken).toBeTruthy();

    const provisionsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/provisions',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(provisionsRes.statusCode).toBe(200);

    const payload = provisionsRes.json() as {
      success: boolean;
      data: Array<{ events: unknown[]; shifts: unknown[] }>;
    };
    expect(payload.success).toBe(true);
    expect(payload.data.length).toBeGreaterThan(0);

    const hasSeededTimeline = payload.data.some(
      (home) => home.events.length > 0 || home.shifts.length > 0,
    );
    expect(hasSeededTimeline).toBe(true);
  }, 30_000);
});
