/**
 * Phase regression tests — one per phase, locking in the architectural
 * invariant promised by [changes.md](../changes.md). These are the floor; the
 * larger phase gates (logout-all across two browsers, QR-code scan, etc.) are
 * smoke-tested manually.
 *
 * Each test mocks the Prisma client and any service primitives it doesn't
 * exercise, then injects HTTP requests into a booted Fastify app.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockPrisma, isImpersonationGrantActive, verifyPassword, normalizePasswordCheckTiming, hashPassword } = vi.hoisted(() => {
  const mp = {
    tenantUser: { findUnique: vi.fn(), update: vi.fn() },
    platformUser: { findUnique: vi.fn() },
    tenantMembership: { findFirst: vi.fn(), findUnique: vi.fn() },
    platformMfaCredential: { findUnique: vi.fn() },
    refreshToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    tenantSession: { create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    tenantMfaCredential: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  };
  // $transaction default — accept either an array of ops or a callback.
  mp.$transaction.mockImplementation(async (ops: unknown) => {
    if (typeof ops === 'function') return (ops as (tx: typeof mp) => Promise<unknown>)(mp);
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops;
  });
  return {
    mockPrisma: mp,
    isImpersonationGrantActive: vi.fn(async () => true),
    verifyPassword: vi.fn(async () => ({ match: true, algorithm: 'argon2id', needsRehash: false })),
    normalizePasswordCheckTiming: vi.fn(async () => undefined),
    hashPassword: vi.fn(async (p: string) => `argon2id$mock$${p}`),
  };
});

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/password.js', () => ({ verifyPassword, normalizePasswordCheckTiming, hashPassword }));
vi.mock('../src/modules/admin/impersonation.service.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../src/modules/admin/impersonation.service.js',
  );
  return { ...actual, isImpersonationGrantActive };
});

// Required env so envSchema parses cleanly.
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
  isImpersonationGrantActive.mockResolvedValue(true);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function tenantToken(extra: Record<string, unknown> = {}) {
  return app.jwt.sign({
    sub: 'u_tenant_1',
    email: 'staff@example.com',
    role: 'staff',
    tenantId: 't_1',
    tenantRole: 'staff',
    mfaVerified: true,
    sid: 's_1',
    aud: 'tenant',
    ...extra,
  });
}

function platformToken(extra: Record<string, unknown> = {}) {
  return app.jwt.sign({
    sub: 'p_1',
    email: 'admin@zikelsolutions.com',
    role: 'platform_admin',
    sid: 'ps_1',
    mfaVerified: true,
    aud: 'platform',
    ...extra,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Phase 1 — cross-audience JWT rejection
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 1 — JWT audience isolation', () => {
  it('rejects a tenant-audience token presented to /admin/auth/me', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/auth/me',
      headers: { authorization: `Bearer ${tenantToken()}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    // /admin/* expects audience='platform'; got tenant → TENANT_TOKEN_REJECTED.
    expect(body.error?.code).toBe('TENANT_TOKEN_REJECTED');
  });

  it('rejects a platform-audience token presented to a tenant route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${platformToken()}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string } };
    // /api/v1/* expects audience='tenant'; got platform → PLATFORM_TOKEN_REJECTED.
    expect(body.error?.code).toBe('PLATFORM_TOKEN_REJECTED');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Phase 2 — replayed refresh token revokes the entire session
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 2 — refresh-token theft detection', () => {
  it('revokes the whole session when a revoked refresh token is replayed', async () => {
    const stolenToken = 'stolen_refresh_token_value';
    const sessionId = 's_compromised';
    const userId = 'u_victim';

    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt_revoked',
      sessionId,
      userId,
      token: stolenToken,
      revokedAt: new Date('2025-01-01T00:00:00Z'), // already used
      idleExpiresAt: new Date(Date.now() + 60_000),
      session: { revokedAt: null, absoluteExpiresAt: new Date(Date.now() + 60_000) },
      user: { isActive: true, role: 'staff' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: stolenToken },
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('REFRESH_TOKEN_REUSED');

    // Tripwire: BOTH the session AND remaining tokens are revoked.
    expect(mockPrisma.tenantSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      }),
    );
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      }),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Phase 3 — capability-based authorization denies on missing permission
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 3 — requirePermission denial', () => {
  it("returns 403 PERMISSION_DENIED when the user's role lacks the required permission", async () => {
    // Read-Only membership: tenant context resolves but permissions[] does not
    // include 'employees:write', so POST /api/v1/employees must 403.
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      id: 'u_readonly',
      role: 'staff',
      activeTenantId: 't_1',
      activeTenant: { id: 't_1', isActive: true },
      tenantMemberships: [
        {
          tenantId: 't_1',
          status: 'active',
          role: { name: 'Read-Only', permissions: ['employees:read'] },
        },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/employees',
      headers: {
        authorization: `Bearer ${tenantToken({ sub: 'u_readonly' })}`,
        'content-type': 'application/json',
      },
      payload: { userId: 'u_other', jobTitle: 'Test' },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json() as { error?: { code?: string; details?: unknown } };
    expect(body.error?.code).toBe('PERMISSION_DENIED');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Phase 4 — login with MFA enrolled returns a challenge token
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 4 — login MFA challenge gate', () => {
  it("returns { mfaEnrollmentRequired, enrollmentToken } when an Owner has no TOTP enrolled (hard block)", async () => {
    // Owner without TOTP: login must NOT mint a session. It must hand back
    // a single-purpose enrollment token instead — defining the industry-
    // standard "enrollment-required" hard block decided 2026-05-08.
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      id: 'u_owner_unenrolled',
      email: 'owner@example.com',
      passwordHash: '$argon2id$mock',
      isActive: true,
      emailVerified: true,
      lockedUntil: null,
      failedAttempts: 0,
      role: 'admin',
      activeTenantId: 't_1',
    });
    mockPrisma.tenantUser.update.mockResolvedValue({});
    // No confirmed credential.
    mockPrisma.tenantMfaCredential.findUnique.mockResolvedValue(null);
    // Active Owner membership — privileged.
    mockPrisma.tenantMembership.findFirst.mockResolvedValue({ id: 'm_owner' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'owner@example.com', password: 'AnyValid#Password1!' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data?: {
        mfaEnrollmentRequired?: boolean;
        enrollmentToken?: string;
        enrollmentExpiresInSeconds?: number;
        tokens?: unknown;
      };
    };
    expect(body.data?.mfaEnrollmentRequired).toBe(true);
    expect(typeof body.data?.enrollmentToken).toBe('string');
    expect(typeof body.data?.enrollmentExpiresInSeconds).toBe('number');
    // Hard block: NO session tokens at this stage.
    expect(body.data?.tokens).toBeUndefined();
  });

  it("returns { mfaRequired: true, challengeToken } when the user has TOTP enrolled", async () => {
    // Password module is mocked at the top of this file — verifyPassword always
    // returns { match: true } so we reach the MFA gate.
    mockPrisma.tenantUser.findUnique.mockResolvedValue({
      id: 'u_owner',
      email: 'owner@example.com',
      passwordHash: '$argon2id$mock',
      isActive: true,
      emailVerified: true,
      lockedUntil: null,
      failedAttempts: 0,
      role: 'admin',
      activeTenantId: 't_1',
    });
    mockPrisma.tenantUser.update.mockResolvedValue({});
    mockPrisma.tenantMfaCredential.findUnique.mockResolvedValue({
      id: 'mfa_1',
      userId: 'u_owner',
      confirmedAt: new Date(),
      secretEncrypted: 'iv:tag:ciphertext',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'owner@example.com', password: 'AnyValid#Password1!' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data?: { mfaRequired?: boolean; challengeToken?: string };
    };
    expect(body.data?.mfaRequired).toBe(true);
    expect(typeof body.data?.challengeToken).toBe('string');
    // The MFA gate must NOT issue session tokens at this stage.
    expect((body.data as Record<string, unknown>).tokens).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Phase 5 — impersonation stamps audit-log impersonatorId
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 5 — impersonation audit stamping', () => {
  it("auto-stamps impersonatorId on AuditLog.create when an impersonation token is in use", async () => {
    // The auth plugin checks isImpersonationGrantActive(grantId) before
    // accepting an impersonation token. Stub it true so the request proceeds.
    isImpersonationGrantActive.mockResolvedValue(true);

    // Capture auditLog.create payloads.
    const createSpy = mockPrisma.auditLog.create.mockResolvedValue({});

    // Make any tenant route call that writes an audit row. We inject the audit
    // write directly via the prisma extension's enrichment by calling the
    // service-level audit writer. Easiest: directly import enrichAuditLogCreateData
    // and assert it carries impersonatorId from request context.
    const { enrichAuditLogCreateData } = await import('../src/lib/audit-metadata.js');

    const enriched = enrichAuditLogCreateData(
      { tenantId: 't_1', userId: 'u_owner', action: 'login' as never },
      {
        requestId: 'req_1',
        ipAddress: '1.2.3.4',
        userAgent: 'vitest',
        source: 'test',
        tenantId: 't_1',
        unscopedTenant: false,
        impersonatorId: 'p_support_engineer_1',
        cache: new Map(),
      },
    );

    expect((enriched as { impersonatorId?: string }).impersonatorId).toBe(
      'p_support_engineer_1',
    );
    // Spy is unused in this assertion path but kept available for future
    // end-to-end coverage that exercises the live extension.
    void createSpy;
  });

  it('rejects an impersonation token whose grant has been revoked', async () => {
    isImpersonationGrantActive.mockResolvedValue(false);

    const token = tenantToken({
      impersonatorId: 'p_1',
      impersonationGrantId: 'g_revoked',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('IMPERSONATION_REVOKED');
  });
});
