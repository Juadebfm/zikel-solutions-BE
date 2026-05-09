/**
 * Coverage for the /admin/tenants/* surface that platform staff use to view,
 * suspend, and reactivate tenants. Replaces the legacy super_admin tenant-
 * audience tests that were removed in Phase 5.
 *
 * Cross-audience JWT isolation is locked in by tests/phase-regression.test.ts
 * (Phase 1 — JWT audience isolation). This file focuses on the new admin
 * surface's role gating and state transitions.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockPrisma, sendTenantSuspendedEmail, sendTenantReactivatedEmail } = vi.hoisted(() => {
  const mp = {
    tenant: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    tenantMembership: {
      findMany: vi.fn(),
    },
    tenantSession: {
      updateMany: vi.fn(),
    },
    refreshToken: {
      updateMany: vi.fn(),
    },
    platformUser: {
      findUnique: vi.fn(),
    },
    platformAuditLog: {
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(),
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  };
  mp.$transaction.mockImplementation(async (ops: unknown) => {
    if (typeof ops === 'function') return (ops as (tx: typeof mp) => Promise<unknown>)(mp);
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops;
  });
  return {
    mockPrisma: mp,
    sendTenantSuspendedEmail: vi.fn(async () => undefined),
    sendTenantReactivatedEmail: vi.fn(async () => undefined),
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/tenant-lifecycle-email.js', () => ({
  sendTenantSuspendedEmail,
  sendTenantReactivatedEmail,
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
  mockPrisma.$transaction.mockImplementation(async (ops: unknown) => {
    if (typeof ops === 'function') return (ops as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops;
  });
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

describe('Admin Tenants — list & detail', () => {
  it('returns paginated list of tenants', async () => {
    mockPrisma.tenant.count.mockResolvedValue(2);
    mockPrisma.tenant.findMany.mockResolvedValue([
      {
        id: 't_1',
        name: 'Acme Care',
        slug: 'acme-care',
        country: 'UK',
        isActive: true,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        _count: { memberships: 5, homes: 2 },
      },
      {
        id: 't_2',
        name: 'Beacon Homes',
        slug: 'beacon-homes',
        country: 'UK',
        isActive: false,
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-02'),
        _count: { memberships: 3, homes: 1 },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants',
      headers: { authorization: `Bearer ${platformToken()}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; activeMemberCount: number; homeCount: number }>;
      meta: { total: number };
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]?.activeMemberCount).toBe(5);
    expect(body.meta.total).toBe(2);
  });

  it('returns 404 on detail for an unknown tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/tenants/missing_id',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('TENANT_NOT_FOUND');
  });
});

describe('Admin Tenants — suspend / reactivate', () => {
  it('platform_admin can suspend an active tenant; sessions are revoked', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't_1',
      name: 'Acme Care',
      isActive: true,
    });
    mockPrisma.tenant.update.mockResolvedValue({ id: 't_1', isActive: false });
    mockPrisma.tenantSession.updateMany.mockResolvedValue({ count: 3 });
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 5 });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants/t_1/suspend',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: { reason: 'Compliance review pending' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: { id: 't_1', isActive: false },
    });
    expect(mockPrisma.tenantSession.updateMany).toHaveBeenCalled();
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalled();
  });

  it("support role cannot suspend (PLATFORM_ROLE_DENIED)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants/t_1/suspend',
      headers: {
        authorization: `Bearer ${platformToken({ role: 'support' })}`,
        'content-type': 'application/json',
      },
      payload: { reason: 'Compliance review pending' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('PLATFORM_ROLE_DENIED');
  });

  it('returns 409 when suspending an already-suspended tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't_1',
      name: 'Acme',
      isActive: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants/t_1/suspend',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: { reason: 'Compliance review pending' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('TENANT_ALREADY_SUSPENDED');
  });

  it('platform_admin can reactivate a suspended tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't_1',
      name: 'Acme',
      isActive: false,
    });
    mockPrisma.tenant.update.mockResolvedValue({ id: 't_1', isActive: true });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants/t_1/reactivate',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: { reason: 'Compliance review cleared' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: { id: 't_1', isActive: true },
    });
  });

  it('a non-MFA-verified platform session is blocked from mutating', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants/t_1/suspend',
      headers: {
        authorization: `Bearer ${platformToken({ mfaVerified: false })}`,
        'content-type': 'application/json',
      },
      payload: { reason: 'Compliance review pending' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('MFA_REQUIRED');
  });

  it('suspending a tenant fires sendTenantSuspendedEmail to each active Owner', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't_1',
      name: 'Acme Care',
      isActive: true,
    });
    mockPrisma.tenant.update.mockResolvedValue({ id: 't_1', isActive: false });
    mockPrisma.tenantSession.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.tenantMembership.findMany.mockResolvedValue([
      {
        user: {
          email: 'owner1@example.com',
          firstName: 'Owen',
          lastName: 'One',
          isActive: true,
        },
      },
      {
        user: {
          email: 'owner2@example.com',
          firstName: 'Owa',
          lastName: 'Two',
          isActive: true,
        },
      },
    ]);
    mockPrisma.platformUser.findUnique.mockResolvedValue({ email: 'admin@zikelsolutions.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants/t_1/suspend',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: { reason: 'Compliance review pending' },
    });
    expect(res.statusCode).toBe(200);

    // Email is fire-and-forget — wait one microtask tick.
    await new Promise((r) => setImmediate(r));

    expect(sendTenantSuspendedEmail).toHaveBeenCalledTimes(2);
    expect(sendTenantSuspendedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: 'owner1@example.com',
        tenantName: 'Acme Care',
        reason: 'Compliance review pending',
        platformUserEmail: 'admin@zikelsolutions.com',
      }),
    );
  });

  it('reactivating a tenant fires sendTenantReactivatedEmail to each active Owner', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't_1',
      name: 'Acme Care',
      isActive: false,
    });
    mockPrisma.tenant.update.mockResolvedValue({ id: 't_1', isActive: true });
    mockPrisma.tenantMembership.findMany.mockResolvedValue([
      {
        user: {
          email: 'owner1@example.com',
          firstName: 'Owen',
          lastName: 'One',
          isActive: true,
        },
      },
    ]);
    mockPrisma.platformUser.findUnique.mockResolvedValue({ email: 'admin@zikelsolutions.com' });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants/t_1/reactivate',
      headers: {
        authorization: `Bearer ${platformToken()}`,
        'content-type': 'application/json',
      },
      payload: { reason: 'Compliance review cleared' },
    });
    expect(res.statusCode).toBe(200);

    await new Promise((r) => setImmediate(r));

    expect(sendTenantReactivatedEmail).toHaveBeenCalledTimes(1);
    expect(sendTenantReactivatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: 'owner1@example.com',
        tenantName: 'Acme Care',
        reason: 'Compliance review cleared',
      }),
    );
  });
});
