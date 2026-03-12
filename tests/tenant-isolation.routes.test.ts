import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    tenantMembership: {
      findUnique: vi.fn(),
    },
    careGroup: {
      findFirst: vi.fn(),
    },
    home: {
      findFirst: vi.fn(),
    },
    employee: {
      findFirst: vi.fn(),
    },
    youngPerson: {
      findFirst: vi.fn(),
    },
    vehicle: {
      findFirst: vi.fn(),
    },
    announcement: {
      findFirst: vi.fn(),
    },
    announcementRead: {
      upsert: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    widget: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    refreshToken: {
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $disconnect: vi.fn(),
  },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: mockPrisma,
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
});

function authHeader(
  userId = 'user_1',
  role: 'staff' | 'manager' | 'admin' | 'super_admin' = 'manager',
) {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: 'tenant_1',
    tenantRole: role === 'staff' ? 'staff' : 'sub_admin',
  });
  return { authorization: `Bearer ${token}` };
}

function mockTenantContext(
  userId = 'user_1',
  role: 'staff' | 'manager' | 'admin' | 'super_admin' = 'manager',
) {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: userId,
    role,
    activeTenantId: 'tenant_1',
  });
  mockPrisma.tenant.findUnique.mockResolvedValue({
    id: 'tenant_1',
    isActive: true,
  });
  mockPrisma.tenantMembership.findUnique.mockResolvedValue({
    role: 'sub_admin',
    status: 'active',
  });
}

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

  it('denies tenant admin toggling AI access for a user outside tenant', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'admin_1', role: 'admin' })
      .mockResolvedValueOnce({ id: 'admin_1', role: 'admin', activeTenantId: 'tenant_1' });
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({ id: 'tenant_1', isActive: true });
    mockPrisma.tenantMembership.findUnique
      .mockResolvedValueOnce({ role: 'sub_admin', status: 'active' })
      .mockResolvedValueOnce(null);

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
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('requires break-glass before super-admin can read another tenant audit scope', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'super_1',
      role: 'super_admin',
      activeTenantId: 'tenant_1',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit?tenantId=tenant_2',
      headers: authHeader('super_1', 'super_admin'),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'BREAK_GLASS_REQUIRED' },
    });
    expect(mockPrisma.auditLog.count).not.toHaveBeenCalled();
  });
});
