import { describe, expect, it } from 'vitest';
import { enrichAuditLogCreateData } from '../src/lib/audit-metadata.js';

describe('enrichAuditLogCreateData', () => {
  it('adds missing request metadata defaults', () => {
    const data = enrichAuditLogCreateData(
      {
        tenantId: 'tenant_1',
        userId: 'user_1',
        action: 'record_updated',
      } as const,
      {
        requestId: 'req_123',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest-agent',
        source: 'GET /api/v1/tasks',
      },
    );

    expect(data.ipAddress).toBe('127.0.0.1');
    expect(data.userAgent).toBe('vitest-agent');
    expect(data.metadata).toMatchObject({
      requestId: 'req_123',
      source: 'GET /api/v1/tasks',
    });
  });

  it('preserves existing source and request metadata values', () => {
    const data = enrichAuditLogCreateData(
      {
        tenantId: 'tenant_1',
        userId: 'user_1',
        action: 'permission_changed',
        ipAddress: '10.0.0.1',
        userAgent: 'custom-agent',
        metadata: {
          source: 'tenants.memberships.update',
          requestId: 'existing_req',
          changedFields: ['role'],
        },
      } as const,
      {
        requestId: 'req_123',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest-agent',
        source: 'PATCH /api/v1/tenants/memberships/:id',
      },
    );

    expect(data.ipAddress).toBe('10.0.0.1');
    expect(data.userAgent).toBe('custom-agent');
    expect(data.metadata).toMatchObject({
      source: 'tenants.memberships.update',
      requestId: 'existing_req',
      changedFields: ['role'],
    });
  });

  it('normalizes primitive metadata and adds source fallback', () => {
    const data = enrichAuditLogCreateData(
      {
        tenantId: 'tenant_1',
        userId: 'user_1',
        action: 'record_deleted',
        metadata: 'cleanup-run',
      } as const,
      null,
    );

    expect(data.metadata).toMatchObject({
      detail: 'cleanup-run',
      source: 'system',
    });
  });
});

