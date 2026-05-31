/**
 * Unit tests for the tenant-side audit export service.
 *
 * Covers the BE-domain invariants that a compliance officer cares about:
 *   - Only Owner/Admin (Tenant) can export — Residential Care Worker is forbidden
 *   - Row shape matches the shared TenantAuditExportRow contract
 *   - 50k cap enforced; `truncated` set when totalMatching exceeds the cap
 *   - Filter parameters (action, userId, fromDate/toDate) translate to the
 *     correct Prisma where clause
 *   - Self-audit row written on every export (Ofsted chain-of-custody)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, requireTenantContext } = vi.hoisted(() => ({
  mockPrisma: {
    tenantUser: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn() },
    auditLog: {
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(async () => ({})),
    },
  },
  requireTenantContext: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/tenant-context.js', () => ({ requireTenantContext }));
vi.mock('../src/lib/sensitive-read-audit.js', () => ({
  logSensitiveReadAccess: vi.fn(),
}));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { exportTenantAudit } = await import('../src/modules/audit/audit.service.js');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'al_1',
    tenantId: 't_1',
    userId: 'u_1',
    impersonatorId: null,
    action: 'record_accessed',
    entityType: 'young_person',
    entityId: 'yp_1',
    metadata: { foo: 'bar' },
    ipAddress: '1.2.3.4',
    userAgent: 'curl/8',
    createdAt: new Date('2026-05-26T08:00:00.000Z'),
    user: { email: 'admin@zikel.dev', firstName: 'Ada', lastName: 'Lovelace' },
    impersonator: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default actor: Admin role (passes isAuditViewer)
  mockPrisma.tenantUser.findUnique.mockResolvedValue({
    id: 'u_1',
    role: 'admin',
    activeTenantId: 't_1',
  });
  requireTenantContext.mockResolvedValue({
    tenantId: 't_1',
    userRole: 'admin',
    tenantRole: 'tenant_admin',
  });
  mockPrisma.tenant.findUnique.mockResolvedValue({
    id: 't_1',
    name: 'Acme Care',
    slug: 'acme-care',
  });
});

describe('exportTenantAudit', () => {
  it('returns rows in the shared TenantAuditExportRow shape', async () => {
    mockPrisma.auditLog.count.mockResolvedValue(1);
    mockPrisma.auditLog.findMany.mockResolvedValue([makeRow()]);

    const result = await exportTenantAudit({ actorUserId: 'u_1', format: 'csv' });

    expect(result.tenant).toEqual({ id: 't_1', name: 'Acme Care', slug: 'acme-care' });
    expect(result.rows).toHaveLength(1);
    // Shape — denormalized user fields land at the top level.
    expect(result.rows[0]).toMatchObject({
      id: 'al_1',
      action: 'record_accessed',
      userEmail: 'admin@zikel.dev',
      userName: 'Ada Lovelace',
      impersonatorEmail: null,
    });
    expect(result.totalMatching).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('throws 403 FORBIDDEN for non-viewer roles (e.g. Residential Care Worker)', async () => {
    // RCW has UserRole='staff' and TenantRole='staff' — neither isAuditViewer accepts.
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      id: 'u_2',
      role: 'staff',
      activeTenantId: 't_1',
    });
    requireTenantContext.mockResolvedValue({
      tenantId: 't_1',
      userRole: 'staff',
      tenantRole: 'staff',
    });

    await expect(
      exportTenantAudit({ actorUserId: 'u_2', format: 'csv' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('sets truncated=true when totalMatching exceeds the 50k cap', async () => {
    mockPrisma.auditLog.count.mockResolvedValue(75_000);
    mockPrisma.auditLog.findMany.mockResolvedValue(
      Array.from({ length: 50_000 }, (_, i) => makeRow({ id: `al_${i}` })),
    );

    const result = await exportTenantAudit({ actorUserId: 'u_1', format: 'json' });

    expect(result.totalMatching).toBe(75_000);
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(50_000);
  });

  it('applies action + userId + date-window filters to the Prisma where clause', async () => {
    mockPrisma.auditLog.count.mockResolvedValue(0);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    await exportTenantAudit({
      actorUserId: 'u_1',
      format: 'csv',
      action: 'login',
      userId: 'u_target',
      fromDate: new Date('2026-04-01T00:00:00.000Z'),
      toDate: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't_1',
          action: 'login',
          userId: 'u_target',
          createdAt: {
            gte: new Date('2026-04-01T00:00:00.000Z'),
            lte: new Date('2026-05-01T00:00:00.000Z'),
          },
        }),
      }),
    );
  });

  it('hard-scopes the query to the actor\'s tenantId — never reads other tenants', async () => {
    mockPrisma.auditLog.count.mockResolvedValue(0);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    await exportTenantAudit({ actorUserId: 'u_1', format: 'csv' });

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't_1' }),
      }),
    );
  });

  it('writes a self-audit AuditLog row (chain-of-custody)', async () => {
    mockPrisma.auditLog.count.mockResolvedValue(3);
    mockPrisma.auditLog.findMany.mockResolvedValue([makeRow(), makeRow(), makeRow()]);

    await exportTenantAudit({
      actorUserId: 'u_1',
      format: 'csv',
      action: 'login',
      ipAddress: '10.0.0.5',
      userAgent: 'TestAgent/1.0',
    });

    // The self-audit is fire-and-forget; give the microtask queue a tick to flush.
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't_1',
          userId: 'u_1',
          action: 'record_accessed',
          entityType: 'tenant_audit_log_export',
          ipAddress: '10.0.0.5',
          userAgent: 'TestAgent/1.0',
          metadata: expect.objectContaining({
            event: 'tenant_audit_log_exported',
            format: 'csv',
            rowsReturned: 3,
            totalMatching: 3,
            truncated: false,
            filterAction: 'login',
          }),
        }),
      }),
    );
  });
});
