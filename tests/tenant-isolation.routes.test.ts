import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    tenantUser: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    tenantMembership: {
      findUnique: vi.fn(),
    },
    careGroup: { findFirst: vi.fn() },
    home: { findFirst: vi.fn() },
    employee: { findFirst: vi.fn() },
    youngPerson: { findFirst: vi.fn() },
    vehicle: { findFirst: vi.fn() },
    announcement: { findFirst: vi.fn() },
    announcementRead: { upsert: vi.fn() },
    task: { findFirst: vi.fn(), update: vi.fn() },
    widget: { findUnique: vi.fn(), delete: vi.fn() },
    auditLog: {
      create: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    platformAuditLog: {
      create: vi.fn(async () => ({})),
    },
    refreshToken: { updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $disconnect: vi.fn(async () => undefined),
    $on: vi.fn(),
  },
}));

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

const ALL_PERMS = [
  'employees:read', 'employees:write',
  'homes:read', 'homes:write',
  'care_groups:read', 'care_groups:write',
  'young_people:read', 'young_people:write',
  'tasks:read', 'tasks:write', 'tasks:approve',
  'safeguarding:read', 'safeguarding:write',
  'reports:read', 'reports:export',
  'audit:read',
  'settings:read', 'settings:write',
  'members:read', 'members:write',
  'roles:read', 'roles:write',
  'ai:use', 'ai:admin',
  'announcements:read', 'announcements:write',
  'vehicles:read', 'vehicles:write',
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit_1' });
});

function authHeader(
  userId = 'user_1',
  role: 'staff' | 'manager' | 'admin' = 'manager',
  mfaVerified?: boolean,
) {
  const tenantRole = role === 'staff' ? 'staff' : 'sub_admin';
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: 'tenant_1',
    tenantRole,
    mfaVerified: mfaVerified ?? true,
    aud: 'tenant',
  });
  return { authorization: `Bearer ${token}` };
}

function mockTenantContext(
  userId = 'user_1',
  userRole: 'staff' | 'manager' | 'admin' = 'manager',
  roleName: 'Owner' | 'Admin' | 'Care Worker' = 'Admin',
  permissions: string[] = ALL_PERMS,
) {
  mockPrisma.tenantUser.findUnique.mockResolvedValue({
    id: userId,
    role: userRole,
    activeTenantId: 'tenant_1',
    activeTenant: { id: 'tenant_1', isActive: true },
    tenantMemberships: [
      {
        tenantId: 'tenant_1',
        status: 'active',
        role: { name: roleName, permissions },
      },
    ],
  });
  mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant_1', isActive: true });
  mockPrisma.tenantMembership.findUnique.mockResolvedValue({
    role: { name: roleName, permissions },
    status: 'active',
  });
}

/**
 * The Prisma `tenantScopeExtension` auto-injects `where: { tenantId }` from
 * the request's tenant context, so every test below relies on the simple
 * truth: when the cross-tenant row does not satisfy the auto-injected
 * tenantId, prisma returns null and the route hands back a 404.
 *
 * In these mocks we simulate that by returning null from the prisma stub
 * (the extension itself is not exercised because prisma is fully mocked,
 * but the route's downstream "if (!row) throw NOT_FOUND" path is what we
 * are guarding here).
 */
describe('Tenant isolation (cross-tenant access denial)', () => {
  it('denies reading a care group from another tenant', async () => {
    mockTenantContext();
    mockPrisma.careGroup.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/care-groups/cg_other_tenant',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'CARE_GROUP_NOT_FOUND' },
    });
  });

  it('denies reading a home from another tenant', async () => {
    mockTenantContext();
    mockPrisma.home.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/homes/home_other_tenant',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'HOME_NOT_FOUND' },
    });
  });

  it('denies reading an employee from another tenant', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/employees/emp_other_tenant',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'EMPLOYEE_NOT_FOUND' },
    });
  });

  it('denies reading a young person from another tenant', async () => {
    mockTenantContext();
    mockPrisma.youngPerson.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/young-people/yp_other_tenant',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'YOUNG_PERSON_NOT_FOUND' },
    });
  });

  it('denies reading an announcement from another tenant', async () => {
    mockTenantContext();
    mockPrisma.announcement.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/announcements/ann_other_tenant',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'ANNOUNCEMENT_NOT_FOUND' },
    });
  });

  it('denies reading a vehicle from another tenant', async () => {
    mockTenantContext();
    mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/vehicles/veh_other_tenant',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'VEHICLE_NOT_FOUND' },
    });
  });

  it('denies reading a task from another tenant', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task_other_tenant',
      headers: authHeader('user_1', 'manager'),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'TASK_NOT_FOUND' },
    });
  });

  it('denies approving a task from another tenant', async () => {
    mockTenantContext('user_1', 'manager');
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.findFirst.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/tasks-to-approve/task_other_tenant/approve',
      headers: authHeader('user_1', 'manager'),
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'TASK_NOT_FOUND' },
    });
  });

  it('denies deleting a dashboard widget from another tenant', async () => {
    mockTenantContext();
    mockPrisma.widget.findUnique.mockResolvedValueOnce({
      id: 'widget_2',
      tenantId: 'tenant_2',
      userId: 'user_1',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/dashboard/widgets/widget_2',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'WIDGET_NOT_FOUND' },
    });
  });

  it('denies admin toggling AI access for a user outside tenant', async () => {
    // Hook chain in order:
    //   1. requirePermission(AI_ADMIN) → requireTenantContext → tenantUser.findUnique (full shape)
    //   2. handler setUserAiAccess → tenantUser.findUnique (actor short shape)
    //   3. handler setUserAiAccess → tenantMembership.findUnique (target)
    // Step (3) returning null is the cross-tenant guard.
    mockPrisma.tenantUser.findUnique
      .mockResolvedValueOnce({
        id: 'admin_1',
        role: 'admin',
        activeTenantId: 'tenant_1',
        activeTenant: { id: 'tenant_1', isActive: true },
        tenantMemberships: [
          {
            tenantId: 'tenant_1',
            status: 'active',
            role: { name: 'Owner', permissions: ALL_PERMS },
          },
        ],
      })
      .mockResolvedValueOnce({ id: 'admin_1', role: 'admin' });
    // Target user has no membership in tenant_1 → cross-tenant access denied.
    mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/ai/access/user_outside_tenant',
      headers: authHeader('admin_1', 'admin'),
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'USER_NOT_FOUND' },
    });
    expect(mockPrisma.tenantUser.update).not.toHaveBeenCalled();
  });

  // The legacy super_admin "break-glass cross-tenant audit read" path is
  // replaced by /admin/audit/tenants/:id under the platform audience. The
  // new gate is: any MFA-verified platform user can read; the read itself is
  // recorded in PlatformAuditLog so we keep a chain of custody for who looked
  // at what tenant's audit history. Lock that invariant in:
  it('platform user reading a tenant audit log records a PlatformAuditLog entry', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant_2',
      name: 'Other Care',
      slug: 'other-care',
      isActive: true,
    });
    mockPrisma.auditLog.count.mockResolvedValue(0);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);

    const platformToken = app.jwt.sign({
      sub: 'p_admin',
      email: 'admin@zikelsolutions.com',
      role: 'platform_admin',
      sid: 'ps_1',
      mfaVerified: true,
      aud: 'platform',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/audit/tenants/tenant_2',
      headers: { authorization: `Bearer ${platformToken}` },
    });

    expect(res.statusCode).toBe(200);
    // Wait one microtask tick so the fire-and-forget audit write resolves.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockPrisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          platformUserId: 'p_admin',
          targetTenantId: 'tenant_2',
          entityType: 'tenant_audit_log',
        }),
      }),
    );
  });
});
