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
    employee: {
      findFirst: vi.fn(),
    },
    youngPerson: {
      findFirst: vi.fn(),
    },
    vehicle: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    task: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    refreshToken: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
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
  tenantRole: 'staff' | 'sub_admin' | 'tenant_admin' = 'sub_admin',
  mfaVerified?: boolean,
) {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: 'tenant_1',
    tenantRole,
    mfaVerified: mfaVerified
      ?? (role === 'super_admin' || tenantRole === 'tenant_admin'),
  });
  return { authorization: `Bearer ${token}` };
}

function mockTenantContext(
  userId = 'user_1',
  role: 'staff' | 'manager' | 'admin' | 'super_admin' = 'manager',
  tenantRole: 'staff' | 'sub_admin' | 'tenant_admin' = 'sub_admin',
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
    role: tenantRole,
    status: 'active',
  });
}

describe('New module routes', () => {
  it('GET /api/v1/vehicles returns tenant-scoped list', async () => {
    mockTenantContext();
    mockPrisma.vehicle.count.mockResolvedValueOnce(1);
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([
      {
        id: 'veh_1',
        tenantId: 'tenant_1',
        registration: 'ABC 123',
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        colour: 'Blue',
        isActive: true,
        nextServiceDue: null,
        motDue: null,
        createdAt: new Date('2026-03-12T09:00:00.000Z'),
        updatedAt: new Date('2026-03-12T09:00:00.000Z'),
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/vehicles',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'record_accessed',
        entityType: 'vehicle',
      }),
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: [{ id: 'veh_1', registration: 'ABC 123' }],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });
  });

  it('allows privileged tenant-admin read access when MFA is not verified', async () => {
    mockTenantContext('admin_1', 'admin', 'tenant_admin');
    mockPrisma.vehicle.count.mockResolvedValueOnce(1);
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([
      {
        id: 'veh_2',
        tenantId: 'tenant_1',
        registration: 'DEF 456',
        make: 'Nissan',
        model: 'Qashqai',
        year: 2021,
        colour: 'White',
        isActive: true,
        nextServiceDue: null,
        motDue: null,
        createdAt: new Date('2026-03-12T09:00:00.000Z'),
        updatedAt: new Date('2026-03-12T09:00:00.000Z'),
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/vehicles',
      headers: authHeader('admin_1', 'admin', 'tenant_admin', false),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: [{ id: 'veh_2', registration: 'DEF 456' }],
    });
  });

  it('blocks privileged tenant-admin write access when MFA is not verified', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vehicles',
      headers: authHeader('admin_1', 'admin', 'tenant_admin', false),
      payload: {
        registration: 'GHI 789',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'MFA_REQUIRED' },
    });
  });

  it('POST /api/v1/vehicles allows tenant sub-admin even with global staff role', async () => {
    mockTenantContext('staff_1', 'staff', 'sub_admin');
    mockPrisma.vehicle.create.mockResolvedValueOnce({
      id: 'veh_new',
      tenantId: 'tenant_1',
      registration: 'ABC 321',
      make: null,
      model: null,
      year: null,
      colour: null,
      isActive: true,
      nextServiceDue: null,
      motDue: null,
      createdAt: new Date('2026-03-12T09:00:00.000Z'),
      updatedAt: new Date('2026-03-12T09:00:00.000Z'),
    });
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vehicles',
      headers: authHeader('staff_1', 'staff', 'sub_admin'),
      payload: {
        registration: 'abc 321',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      success: true,
      data: { id: 'veh_new', registration: 'ABC 321' },
    });
  });

  it('GET /api/v1/tasks returns tenant-scoped list', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.count.mockResolvedValueOnce(1);
    mockPrisma.task.findMany.mockResolvedValueOnce([
      {
        id: 'task_1',
        tenantId: 'tenant_1',
        title: 'Medication check',
        description: null,
        status: 'pending',
        approvalStatus: 'pending_approval',
        priority: 'high',
        dueDate: null,
        completedAt: null,
        rejectionReason: null,
        approvedAt: null,
        assigneeId: 'emp_1',
        approvedById: null,
        youngPersonId: null,
        createdById: 'user_1',
        createdAt: new Date('2026-03-12T09:00:00.000Z'),
        updatedAt: new Date('2026-03-12T09:00:00.000Z'),
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: [{ id: 'task_1', title: 'Medication check' }],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });
  });

  it('GET /api/v1/audit returns scoped audit entries for privileged viewer', async () => {
    mockTenantContext('admin_1', 'admin', 'tenant_admin');
    mockPrisma.auditLog.count.mockResolvedValueOnce(1);
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'log_1',
        tenantId: 'tenant_1',
        userId: 'admin_1',
        action: 'record_updated',
        entityType: 'task',
        entityId: 'task_1',
        metadata: { field: 'status' },
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        createdAt: new Date('2026-03-12T09:00:00.000Z'),
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: authHeader('admin_1', 'admin', 'tenant_admin'),
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'record_accessed',
        entityType: 'audit_log',
      }),
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: [{ id: 'log_1', entityType: 'task' }],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });
  });

  it('POST /api/v1/audit/break-glass/access allows super-admin access switch', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'super_1',
      role: 'super_admin',
      activeTenantId: 'tenant_1',
    });
    mockPrisma.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant_2',
      isActive: true,
      name: 'Care Home B',
    });
    mockPrisma.user.update.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audit/break-glass/access',
      headers: authHeader('super_1', 'super_admin'),
      payload: {
        tenantId: 'tenant_2',
        reason: 'Emergency support for tenant outage investigation.',
        expiresInMinutes: 15,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        activeTenantId: 'tenant_2',
        previousTenantId: 'tenant_1',
      },
    });
  });

  it('POST /api/v1/audit/break-glass/release releases active super-admin tenant context', async () => {
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'super_1',
      role: 'super_admin',
      activeTenantId: 'tenant_2',
    });
    mockPrisma.auditLog.findFirst
      .mockResolvedValueOnce({
        metadata: {
          previousTenantId: 'tenant_1',
          targetTenantId: 'tenant_2',
          expiresAt,
        },
      })
      .mockResolvedValueOnce({
        metadata: {
          previousTenantId: 'tenant_1',
          targetTenantId: 'tenant_2',
          expiresAt,
        },
      });
    mockPrisma.user.update.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audit/break-glass/release',
      headers: authHeader('super_1', 'super_admin'),
      payload: {
        reason: 'Incident resolved, releasing elevated tenant context.',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        activeTenantId: 'tenant_1',
        releasedTenantId: 'tenant_2',
      },
    });
  });
});
