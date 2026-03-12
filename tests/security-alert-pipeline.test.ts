import { describe, expect, it, vi } from 'vitest';
import { AuditAction } from '@prisma/client';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';

function makeClientMock() {
  return {
    auditLog: {
      count: vi.fn(),
    },
    securityAlertDelivery: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'delivery_1' }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
  };
}

describe('security-alert-pipeline', () => {
  it('queues alert delivery for cross-tenant blocked events', async () => {
    const { queueAndDispatchSecurityAlert } = await import('../src/lib/security-alert-pipeline.js');
    const client = makeClientMock();

    await queueAndDispatchSecurityAlert(client as never, {
      id: 'log_1',
      tenantId: 'tenant_1',
      userId: 'user_1',
      action: AuditAction.record_updated,
      entityType: 'cross_tenant_access_blocked',
      entityId: 'task_1',
      metadata: null,
      createdAt: new Date('2026-03-12T10:00:00.000Z'),
    });

    expect(client.securityAlertDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        auditLogId: 'log_1',
        type: 'cross_tenant_attempts',
        severity: 'high',
        status: 'pending',
      }),
      select: { id: true },
    });
  });

  it('queues repeated auth failure alert at threshold when no recent duplicate exists', async () => {
    const { queueAndDispatchSecurityAlert } = await import('../src/lib/security-alert-pipeline.js');
    const client = makeClientMock();
    client.auditLog.count.mockResolvedValueOnce(5);
    client.securityAlertDelivery.findFirst.mockResolvedValueOnce(null);

    await queueAndDispatchSecurityAlert(client as never, {
      id: 'log_2',
      tenantId: null,
      userId: 'user_2',
      action: AuditAction.login,
      entityType: 'auth_login_failed',
      entityId: null,
      metadata: { failedAttempts: 5 },
      createdAt: new Date('2026-03-12T10:10:00.000Z'),
    });

    expect(client.auditLog.count).toHaveBeenCalledTimes(1);
    expect(client.securityAlertDelivery.findFirst).toHaveBeenCalledTimes(1);
    expect(client.securityAlertDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        auditLogId: 'log_2',
        userId: 'user_2',
        type: 'repeated_auth_failures',
        severity: 'high',
      }),
      select: { id: true },
    });
  });

  it('suppresses duplicate repeated auth failure alerts inside dedupe window', async () => {
    const { queueAndDispatchSecurityAlert } = await import('../src/lib/security-alert-pipeline.js');
    const client = makeClientMock();
    client.auditLog.count.mockResolvedValueOnce(7);
    client.securityAlertDelivery.findFirst.mockResolvedValueOnce({ id: 'existing_alert' });

    await queueAndDispatchSecurityAlert(client as never, {
      id: 'log_3',
      tenantId: null,
      userId: 'user_3',
      action: AuditAction.login,
      entityType: 'auth_login_failed',
      entityId: null,
      metadata: { failedAttempts: 7 },
      createdAt: new Date('2026-03-12T10:20:00.000Z'),
    });

    expect(client.securityAlertDelivery.create).not.toHaveBeenCalled();
  });
});
