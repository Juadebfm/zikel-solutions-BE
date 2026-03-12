import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'crypto';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';
process.env.SECURITY_ALERT_WEBHOOK_SHARED_SECRET = 'test_webhook_secret_12345';

let app: FastifyInstance;

const validPayload = {
  deliveryId: 'delivery_123',
  alert: {
    type: 'cross_tenant_attempts',
    severity: 'high',
    details: 'Blocked cross-tenant access attempt detected.',
    context: { path: '/api/v1/tasks/task_1' },
  },
  source: {
    auditLogId: 'log_123',
    action: 'record_updated',
    entityType: 'cross_tenant_access_blocked',
    entityId: 'task_1',
    tenantId: 'tenant_1',
    userId: 'user_1',
    timestamp: '2026-03-12T18:00:00.000Z',
    metadata: { reason: 'tenant_mismatch' },
  },
  emittedAt: '2026-03-12T18:00:01.000Z',
};

function signedHeaders(payload: unknown, timestamp = Math.floor(Date.now() / 1_000).toString()) {
  const secret = process.env.SECURITY_ALERT_WEBHOOK_SHARED_SECRET ?? '';
  const payloadBody = JSON.stringify(payload);
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payloadBody}`)
    .digest('hex');

  return {
    'x-zikel-alert-source': 'security-alert-pipeline',
    'x-zikel-webhook-timestamp': timestamp,
    'x-zikel-webhook-signature': `v1=${signature}`,
  };
}

beforeAll(async () => {
  const server = await import('../src/server.js');
  app = await server.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Security alert webhook receiver', () => {
  it('accepts payload with valid source and HMAC signature headers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/security-alerts/webhook',
      headers: signedHeaders(validPayload),
      payload: validPayload,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        accepted: true,
        deliveryId: 'delivery_123',
      },
    });
  });

  it('rejects request with missing signature headers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/security-alerts/webhook',
      headers: {
        'x-zikel-alert-source': 'security-alert-pipeline',
      },
      payload: validPayload,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing webhook signature headers.',
      },
    });
  });

  it('rejects request with invalid source header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/security-alerts/webhook',
      headers: {
        ...signedHeaders(validPayload),
        'x-zikel-alert-source': 'unknown-source',
      },
      payload: validPayload,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid security alert source header.',
      },
    });
  });
});
