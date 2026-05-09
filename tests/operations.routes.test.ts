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
    employee: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
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
      findUniqueOrThrow: vi.fn(),
    },
    taskReference: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    formTemplate: {
      findMany: vi.fn(),
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

// Permission catalogue (matches src/auth/permissions.ts). Owner gets all.
const ALL_PERMS = [
  'employees:read', 'employees:write', 'employees:invite', 'employees:deactivate',
  'homes:read', 'homes:write',
  'care_groups:read', 'care_groups:write',
  'young_people:read', 'young_people:write', 'young_people:sensitive_read',
  'tasks:read', 'tasks:write', 'tasks:approve',
  'care_logs:read', 'care_logs:write',
  'safeguarding:read', 'safeguarding:write', 'safeguarding:escalate',
  'reports:read', 'reports:export',
  'audit:read',
  'settings:read', 'settings:write',
  'members:read', 'members:write',
  'roles:read', 'roles:write',
  'billing:read', 'billing:write',
  'ai:use', 'ai:admin',
  'announcements:read', 'announcements:write',
  'vehicles:read', 'vehicles:write',
  'help_center:admin',
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.employee.findUnique.mockResolvedValue(null);
  mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  mockPrisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof mockPrisma) => Promise<unknown>)({
        ...mockPrisma,
        task: {
          ...mockPrisma.task,
          update: mockPrisma.task.update,
          findUniqueOrThrow: mockPrisma.task.findUniqueOrThrow,
        },
        taskReference: {
          deleteMany: mockPrisma.taskReference.deleteMany,
          createMany: mockPrisma.taskReference.createMany,
        },
      } as never);
    }
    return Promise.all(arg as Array<Promise<unknown>>);
  });
});

/**
 * Forge a tenant-audience JWT. `tenantRoleName` controls the legacy
 * `tenantRole` claim (Owner→tenant_admin, Admin→sub_admin, anything else→staff).
 * `mfaVerified` defaults to true for Owner so privileged-write tests pass;
 * pass false to test the MFA gate.
 */
function authHeader(
  userId = 'user_1',
  role: 'staff' | 'manager' | 'admin' = 'manager',
  tenantRoleName: 'Owner' | 'Admin' | 'Care Worker' = 'Admin',
  mfaVerified?: boolean,
) {
  const tenantRoleEnum =
    tenantRoleName === 'Owner' ? 'tenant_admin'
      : tenantRoleName === 'Admin' ? 'sub_admin'
      : 'staff';
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: 'tenant_1',
    tenantRole: tenantRoleEnum,
    mfaVerified: mfaVerified ?? (tenantRoleName === 'Owner'),
    aud: 'tenant',
  });
  return { authorization: `Bearer ${token}` };
}

/**
 * Mock the prisma.tenantUser.findUnique result that requireTenantContext
 * consumes. Returns a user with a single active membership in tenant_1
 * holding the specified role + permissions.
 */
function mockTenantContext(
  userId = 'user_1',
  userRole: 'staff' | 'manager' | 'admin' = 'manager',
  roleName: 'Owner' | 'Admin' | 'Care Worker' | 'Read-Only' = 'Admin',
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

function makeTaskRecord(overrides: Record<string, unknown> = {}) {
  const timestamp = new Date('2026-03-12T09:00:00.000Z');
  return {
    id: 'task_1',
    tenantId: 'tenant_1',
    title: 'Medication check',
    description: null,
    status: 'pending',
    approvalStatus: 'not_required',
    category: 'task_log',
    priority: 'high',
    dueDate: null,
    completedAt: null,
    rejectionReason: null,
    approvedAt: null,
    assigneeId: 'emp_1',
    approvedById: null,
    homeId: null,
    vehicleId: null,
    youngPersonId: null,
    createdById: 'user_1',
    formTemplateKey: null,
    formName: null,
    formGroup: 'Task Log',
    submissionPayload: { approverIds: [], approverNames: [], previewFields: [] },
    signatureFileId: null,
    submittedAt: null,
    submittedById: null,
    updatedById: 'user_1',
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    references: [],
    home: null,
    vehicle: null,
    youngPerson: null,
    assignee: null,
    ...overrides,
  };
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

  it('allows Owner read access pre-MFA (read ops not gated by MFA)', async () => {
    mockTenantContext('admin_1', 'admin', 'Owner');
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
      headers: authHeader('admin_1', 'admin', 'Owner', /* mfaVerified */ false),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: [{ id: 'veh_2', registration: 'DEF 456' }],
    });
  });

  it('blocks Owner write access pre-MFA (privileged mutation gate)', async () => {
    mockTenantContext('admin_1', 'admin', 'Owner');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vehicles',
      headers: authHeader('admin_1', 'admin', 'Owner', /* mfaVerified */ false),
      payload: { registration: 'GHI 789' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'MFA_REQUIRED' },
    });
  });

  it('POST /api/v1/vehicles allows a Care Worker with vehicles:write permission', async () => {
    // Phase 3: a Care Worker role with vehicles:write permission can create
    // vehicles even with userRole='staff'. Authorization is now capability-based.
    mockTenantContext('staff_1', 'staff', 'Care Worker', ['vehicles:read', 'vehicles:write']);
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
      headers: authHeader('staff_1', 'staff', 'Care Worker'),
      payload: { registration: 'abc 321' },
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

  it('GET /api/v1/tasks applies approvalStatus filter', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.count.mockResolvedValueOnce(0);
    mockPrisma.task.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?scope=all&approvalStatus=approved',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.task.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({ approvalStatus: { in: ['approved'] } }),
        ]),
      }),
    }));
  });

  it('GET /api/v1/tasks accepts approvalStatus sent_for_approval alias', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.count.mockResolvedValueOnce(0);
    mockPrisma.task.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?scope=all&approvalStatus=sent_for_approval',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.task.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({ approvalStatus: { in: ['pending_approval'] } }),
        ]),
      }),
    }));
  });

  it('GET /api/v1/tasks accepts period=future and applies dueDate lower-bound filter', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.count.mockResolvedValueOnce(0);
    mockPrisma.task.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?scope=all&period=future',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.task.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({ dueDate: expect.objectContaining({ gte: expect.any(Date) }) }),
        ]),
      }),
    }));
  });

  it('GET /api/v1/tasks applies summaryScope=pending_approval filter', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.count.mockResolvedValueOnce(0);
    mockPrisma.task.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?summaryScope=pending_approval',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.task.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            tenantId: 'tenant_1',
            deletedAt: null,
            approvalStatus: 'pending_approval',
          }),
        ]),
      }),
    }));
  });

  it('GET /api/v1/tasks applies summaryScope=comments filter', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([{ entityId: 'task_with_comment_1' }]);
    mockPrisma.task.count.mockResolvedValueOnce(1);
    mockPrisma.task.findMany.mockResolvedValueOnce([makeTaskRecord({ id: 'task_with_comment_1' })]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?summaryScope=comments',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.task.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            AND: expect.arrayContaining([
              expect.any(Object),
              expect.objectContaining({
                id: expect.objectContaining({ in: ['task_with_comment_1'] }),
              }),
            ]),
          }),
        ]),
      }),
    }));
  });

  it('GET /api/v1/tasks/:id returns task detail payload', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.findFirst.mockResolvedValueOnce(
      makeTaskRecord({
        id: 'task_detail_1',
        title: 'Incident review detail',
        description: 'Detailed incident record for QA',
        approvalStatus: 'pending_approval',
        submittedAt: new Date('2026-03-12T10:30:00.000Z'),
      }),
    );
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/task_detail_1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        id: 'task_detail_1',
        title: 'Incident review detail',
        attachments: [],
        comments: [],
      },
    });
  });

  it('POST /api/v1/tasks creates a task (happy path)', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.create.mockResolvedValueOnce(
      makeTaskRecord({
        id: 'task_new_1',
        title: 'New task from route test',
      }),
    );
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: authHeader(),
      payload: { title: 'New task from route test' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      success: true,
      data: { id: 'task_new_1', title: 'New task from route test' },
    });
  });

  it('PATCH /api/v1/tasks/:id updates a task (happy path)', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task_patch_1',
      createdById: 'user_1',
      assigneeId: 'emp_1',
      approvalStatus: 'not_required',
      status: 'pending',
    });
    mockPrisma.task.update.mockResolvedValueOnce({});
    mockPrisma.task.findUniqueOrThrow.mockResolvedValueOnce(
      makeTaskRecord({
        id: 'task_patch_1',
        title: 'Patched task title',
      }),
    );
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tasks/task_patch_1',
      headers: authHeader(),
      payload: { title: 'Patched task title' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: { id: 'task_patch_1', title: 'Patched task title' },
    });
  });

  it('GET /api/v1/tasks/categories returns explorer categories', async () => {
    mockTenantContext();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/categories',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: expect.arrayContaining([
        expect.objectContaining({ value: 'reg44', label: 'Reg 44 Visit' }),
        expect.objectContaining({ value: 'incident', label: 'Incident Report' }),
      ]),
    });
  });

  it('GET /api/v1/tasks/form-templates returns active templates', async () => {
    mockTenantContext();
    mockPrisma.formTemplate.findMany.mockResolvedValueOnce([
      {
        key: 'vehicle-safety-check',
        name: 'Vehicle Safety Check',
        group: 'Vehicle',
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/form-templates',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.formTemplate.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
      select: { key: true, name: true, group: true },
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: [
        {
          slug: 'vehicle-safety-check',
          label: 'Vehicle Safety Check',
          category: 'maintenance',
          formGroup: 'Vehicle',
        },
      ],
    });
  });

  it('POST /api/v1/tasks/:id/actions validates reassign payload', async () => {
    mockTenantContext();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task_1/actions',
      headers: authHeader(),
      payload: { action: 'reassign' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('POST /api/v1/tasks/:id/actions submit transitions task lifecycle (happy path)', async () => {
    mockTenantContext();
    mockPrisma.employee.findFirst
      .mockResolvedValueOnce({ id: 'emp_1' })
      .mockResolvedValueOnce({ id: 'emp_1' });
    mockPrisma.task.findFirst
      .mockResolvedValueOnce({
        id: 'task_action_1',
        status: 'pending',
        approvalStatus: 'not_required',
        assigneeId: 'emp_1',
        createdById: 'user_1',
        submissionPayload: { approverIds: ['approver_1'] },
      })
      .mockResolvedValueOnce(
        makeTaskRecord({
          id: 'task_action_1',
          approvalStatus: 'pending_approval',
          submittedAt: new Date('2026-03-12T10:30:00.000Z'),
          submissionPayload: {
            approverIds: ['approver_1'],
            approverNames: ['Sarah Jenkins'],
            previewFields: [],
          },
        }),
      );
    mockPrisma.task.update.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/task_action_1/actions',
      headers: authHeader(),
      payload: { action: 'submit' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        id: 'task_action_1',
        status: 'sent_for_approval',
        approvalStatus: 'pending_approval',
      },
    });
  });

  it('GET /api/v1/audit returns scoped audit entries for privileged viewer', async () => {
    mockTenantContext('admin_1', 'admin', 'Owner');
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
      headers: authHeader('admin_1', 'admin', 'Owner'),
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

  // Phase 6 (2026-05-08): the legacy break-glass routes were deleted (the
  // /admin/* migration is complete). Cross-tenant audit reads now go through
  // /admin/audit/tenants/:id (which itself records a chain-of-custody row in
  // PlatformAuditLog), and full tenant access goes through
  // /admin/tenants/:id/impersonate. Lock the deletion in: tenant audience
  // hits to the old paths now 404.
  it('POST /api/v1/audit/break-glass/access is removed — returns 404', async () => {
    mockTenantContext('admin_1', 'admin', 'Owner');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audit/break-glass/access',
      headers: authHeader('admin_1', 'admin', 'Owner'),
      payload: {
        tenantId: 'tenant_2',
        reason: 'Emergency support for tenant outage investigation.',
        expiresInMinutes: 15,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/v1/audit/break-glass/release is removed — returns 404', async () => {
    mockTenantContext('admin_1', 'admin', 'Owner');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audit/break-glass/release',
      headers: authHeader('admin_1', 'admin', 'Owner'),
      payload: {
        reason: 'Incident resolved, releasing elevated tenant context.',
      },
    });
    expect(res.statusCode).toBe(404);
  });
});
