/**
 * Coverage for `GET /admin/audit/tenants/:id/export` — CSV and JSON formats,
 * filename + content-type headers, chain-of-custody PlatformAuditLog write,
 * and the truncation flag when total > export max.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockPrisma } = vi.hoisted(() => {
  const mp = {
    tenant: { findUnique: vi.fn() },
    auditLog: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    platformAuditLog: {
      create: vi.fn(async () => ({})),
    },
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  };
  return { mockPrisma: mp };
});

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

beforeEach(() => {
  vi.clearAllMocks();
});

function platformToken(extra: Record<string, unknown> = {}) {
  return app.jwt.sign({
    sub: 'p_admin',
    email: 'admin@zikelsolutions.com',
    role: 'platform_admin',
    sid: 'ps_1',
    mfaVerified: true,
    aud: 'platform',
    ...extra,
  });
}

describe('GET /admin/audit/tenants/:id/export', () => {
  const tenantStub = {
    id: 'tenant_1',
    name: 'Acme Care',
    slug: 'acme-care',
    isActive: true,
  };

  const auditRowStub = {
    id: 'log_1',
    tenantId: 'tenant_1',
    userId: 'user_1',
    impersonatorId: null,
    action: 'login' as const,
    entityType: null,
    entityId: null,
    metadata: { foo: 'bar, with comma' },
    ipAddress: '1.2.3.4',
    userAgent: 'Mozilla/5.0',
    createdAt: new Date('2026-04-01T12:00:00Z'),
    user: { email: 'staff@example.com', firstName: 'Sam', lastName: 'Staff' },
    impersonator: null,
  };

  it('defaults to CSV with the right headers, filename, and BOM', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(tenantStub);
    mockPrisma.auditLog.count.mockResolvedValue(1);
    mockPrisma.auditLog.findMany.mockResolvedValue([auditRowStub]);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/tenants/tenant_1/export',
      headers: { authorization: `Bearer ${platformToken()}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(String(res.headers['content-disposition'])).toMatch(/attachment; filename="audit-acme-care-/);
    expect(String(res.headers['content-disposition'])).toMatch(/\.csv"$/);
    expect(res.headers['x-audit-export-total-matching']).toBe('1');
    expect(res.headers['x-audit-export-returned']).toBe('1');
    expect(res.headers['x-audit-export-truncated']).toBe('false');

    const body = res.body;
    // UTF-8 BOM at start.
    expect(body.charCodeAt(0)).toBe(0xfeff);
    // Header row.
    expect(body).toContain('AuditLogId,CreatedAt,TenantId,Action');
    // Quoted comma in metadata.
    expect(body).toContain('"{""foo"":""bar, with comma""}"');
    // Email and date populated.
    expect(body).toContain('staff@example.com');
    expect(body).toContain('2026-04-01T12:00:00.000Z');
  });

  it('returns JSON when format=json', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(tenantStub);
    mockPrisma.auditLog.count.mockResolvedValue(1);
    mockPrisma.auditLog.findMany.mockResolvedValue([auditRowStub]);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/tenants/tenant_1/export?format=json',
      headers: { authorization: `Bearer ${platformToken()}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(String(res.headers['content-disposition'])).toMatch(/\.json"$/);

    const body = res.json() as {
      tenant: { id: string };
      totalMatching: number;
      rowsReturned: number;
      truncated: boolean;
      items: Array<{ id: string; userEmail: string; userName: string }>;
    };
    expect(body.tenant.id).toBe('tenant_1');
    expect(body.totalMatching).toBe(1);
    expect(body.rowsReturned).toBe(1);
    expect(body.truncated).toBe(false);
    expect(body.items[0]?.userEmail).toBe('staff@example.com');
    expect(body.items[0]?.userName).toBe('Sam Staff');
  });

  it('records a chain-of-custody PlatformAuditLog row tagged tenant_audit_exported', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(tenantStub);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/tenants/tenant_1/export?format=csv',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(200);

    // Fire-and-forget audit write — wait one microtask tick.
    await new Promise((r) => setImmediate(r));

    expect(mockPrisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          platformUserId: 'p_admin',
          targetTenantId: 'tenant_1',
          entityType: 'tenant_audit_log',
          metadata: expect.objectContaining({
            event: 'tenant_audit_exported',
            format: 'csv',
            rowsReturned: 0,
            totalMatching: 0,
            truncated: false,
          }),
        }),
      }),
    );
  });

  it('flags truncated=true when total exceeds the export cap', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(tenantStub);
    mockPrisma.auditLog.count.mockResolvedValue(60_000);
    mockPrisma.auditLog.findMany.mockResolvedValue([auditRowStub]);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/tenants/tenant_1/export?format=json',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-audit-export-truncated']).toBe('true');
    const body = res.json() as { truncated: boolean; totalMatching: number };
    expect(body.truncated).toBe(true);
    expect(body.totalMatching).toBe(60_000);
  });

  it('returns 404 when the tenant does not exist', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/tenants/missing_id/export',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('TENANT_NOT_FOUND');
  });

  it('rejects a non-MFA-verified platform session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/tenants/tenant_1/export',
      headers: { authorization: `Bearer ${platformToken({ mfaVerified: false })}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('MFA_REQUIRED');
  });
});
