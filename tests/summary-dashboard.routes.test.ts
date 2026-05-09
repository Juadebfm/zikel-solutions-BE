import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    tenantUser: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
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
    task: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    taskReviewEvent: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    uploadedFile: {
      findMany: vi.fn(),
    },
    announcement: {
      count: vi.fn(),
    },
    home: {
      findMany: vi.fn(),
    },
    homeEvent: {
      findMany: vi.fn(),
    },
    employeeShift: {
      findMany: vi.fn(),
    },
    widget: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
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
  mockPrisma.tenantUser.findMany.mockResolvedValue([]);
  mockPrisma.taskReviewEvent.findMany.mockResolvedValue([]);
  mockPrisma.taskReviewEvent.findFirst.mockResolvedValue(null);
  mockPrisma.uploadedFile.findMany.mockResolvedValue([]);
  mockPrisma.auditLog.findMany.mockResolvedValue([]);
});

// Phase 3 permission catalogue (mirrors src/auth/permissions.ts). Owner gets all.
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

function authHeader(userId = 'user_1', role: 'staff' | 'manager' | 'admin' = 'manager') {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: 'tenant_1',
    tenantRole: role === 'staff' ? 'staff' : 'sub_admin',
    mfaVerified: true,
    aud: 'tenant',
  });
  return { authorization: `Bearer ${token}` };
}

function mockTenantContext(
  userId = 'user_1',
  userRole: 'staff' | 'manager' | 'admin' = 'manager',
  tenantRole: 'staff' | 'sub_admin' | 'tenant_admin' = 'sub_admin',
) {
  // tenantRole legacy enum is derived from role.name in tenant-context.ts:
  //   Owner→tenant_admin, Admin→sub_admin, anything else→staff. We round-trip
  //   that here by picking a roleName that maps back to the desired enum.
  const roleName = tenantRole === 'tenant_admin' ? 'Owner'
    : tenantRole === 'sub_admin' ? 'Admin'
    : 'Care Worker';
  mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
    id: userId,
    role: userRole,
    activeTenantId: 'tenant_1',
    activeTenant: { id: 'tenant_1', isActive: true },
    tenantMemberships: [
      {
        tenantId: 'tenant_1',
        status: 'active',
        role: { name: roleName, permissions: ALL_PERMS },
      },
    ],
  });
  mockPrisma.tenant.findUnique.mockResolvedValueOnce({
    id: 'tenant_1',
    isActive: true,
  });
  mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce({
    role: { name: roleName, permissions: ALL_PERMS },
    status: 'active',
  });
}

describe('Summary routes', () => {
  it('GET /api/v1/summary/stats returns summary KPIs', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    // Phase 1+: comments now resolves via auditLog→task.count (not announcement.count),
    // and `rewards` is the raw pendingRewards task count (not multiplied).
    // Order of task.count calls: overdue, dueToday, pendingApproval, rejected,
    // draft, future, [comments task.count is skipped when no commented task IDs
    // exist], pendingRewards.
    mockPrisma.task.count
      .mockResolvedValueOnce(3) // overdue
      .mockResolvedValueOnce(5) // dueToday
      .mockResolvedValueOnce(2) // pendingApproval
      .mockResolvedValueOnce(1) // rejected
      .mockResolvedValueOnce(4) // draft
      .mockResolvedValueOnce(6) // future
      .mockResolvedValueOnce(9); // pendingRewards (with no comments task IDs, this slot)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/stats',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        overdue: 3,
        dueToday: 5,
        pendingApproval: 2,
        rejected: 1,
        draft: 4,
        future: 6,
        comments: 0,   // listCommentedTaskIdsForTenant short-circuits to 0 with empty mock
        rewards: 9,    // raw pendingRewards count
      },
    });

    const overdueWhere = mockPrisma.task.count.mock.calls[0]?.[0]?.where;
    const dueTodayWhere = mockPrisma.task.count.mock.calls[1]?.[0]?.where;
    const draftWhere = mockPrisma.task.count.mock.calls[4]?.[0]?.where;
    const futureWhere = mockPrisma.task.count.mock.calls[5]?.[0]?.where;

    expect(overdueWhere).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          status: { in: ['pending', 'in_progress'] },
          approvalStatus: { notIn: ['pending_approval', 'rejected'] },
          dueDate: { lt: expect.any(Date) },
        }),
      ]),
    });
    expect(dueTodayWhere).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          status: { in: ['pending', 'in_progress'] },
          approvalStatus: { notIn: ['pending_approval', 'rejected'] },
          dueDate: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        }),
      ]),
    });
    expect(draftWhere).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          status: 'pending',
          approvalStatus: { notIn: ['pending_approval', 'rejected'] },
          dueDate: null,
        }),
      ]),
    });
    expect(futureWhere).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          status: { in: ['pending', 'in_progress'] },
          approvalStatus: { notIn: ['pending_approval', 'rejected'] },
          dueDate: { gt: expect.any(Date) },
        }),
      ]),
    });
  });

  it('GET /api/v1/summary/provisions returns grouped events and shifts', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.home.findMany.mockResolvedValueOnce([
      { id: 'home_1', name: 'Sunrise House' },
    ]);
    mockPrisma.homeEvent.findMany.mockResolvedValueOnce([
      {
        id: 'evt_1',
        homeId: 'home_1',
        title: 'Medication Round',
        description: 'Morning meds',
        startsAt: new Date('2026-03-11T09:00:00.000Z'),
      },
    ]);
    mockPrisma.employeeShift.findMany.mockResolvedValueOnce([
      {
        id: 'shift_1',
        homeId: 'home_1',
        employeeId: 'emp_1',
        startTime: new Date('2026-03-11T07:00:00.000Z'),
        endTime: new Date('2026-03-11T15:00:00.000Z'),
        employee: {
          user: {
            firstName: 'Amina',
            lastName: 'Okafor',
          },
        },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/provisions',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: [
        {
          homeId: 'home_1',
          homeName: 'Sunrise House',
          events: [
            {
              id: 'evt_1',
              title: 'Medication Round',
            },
          ],
          shifts: [
            {
              employeeId: 'emp_1',
              employeeName: 'Amina Okafor',
            },
          ],
        },
      ],
    });
  });

  it('GET /api/v1/summary/todos includes a friendly taskRef', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.count.mockResolvedValueOnce(1);
    mockPrisma.task.findMany.mockResolvedValueOnce([
      {
        id: 'task_abc123',
        createdAt: new Date('2026-03-20T10:15:00.000Z'),
        title: 'Daily Summary For JUADEB GABRIEL',
        category: 'task_log',
        status: 'pending',
        approvalStatus: 'not_required',
        priority: 'medium',
        dueDate: new Date('2026-03-21T10:00:00.000Z'),
        youngPerson: {
          firstName: 'Juadeb',
          lastName: 'Gabriel',
        },
        assignee: {
          user: {
            firstName: 'Gabriel',
            lastName: 'Femi',
          },
        },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/todos',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      labels: {
        listTitle: 'Tasks',
        workflowStatus: 'Workflow Status',
        approvalStatus: 'Approval Status',
      },
      data: [
        {
          id: 'task_abc123',
          taskRef: 'TSK-20260320-ABC123',
          title: 'Daily Summary For JUADEB GABRIEL',
          status: 'pending',
          approvalStatus: 'not_required',
          review: {
            reviewedByCurrentUser: false,
          },
        },
      ],
    });
  });

  it('GET /api/v1/summary/overdue-tasks returns only overdue rows with taskRef', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.count.mockResolvedValueOnce(2);
    mockPrisma.task.findMany.mockResolvedValueOnce([
      {
        id: 'task_old001',
        createdAt: new Date('2026-03-19T08:00:00.000Z'),
        title: 'Overdue Safeguarding Follow-up',
        category: 'task_log',
        status: 'pending',
        approvalStatus: 'not_required',
        priority: 'high',
        dueDate: new Date('2026-03-20T10:00:00.000Z'),
        youngPerson: {
          firstName: 'Juadeb',
          lastName: 'Gabriel',
        },
        assignee: {
          user: {
            firstName: 'Gabriel',
            lastName: 'Femi',
          },
        },
      },
      {
        id: 'task_old002',
        createdAt: new Date('2026-03-19T09:00:00.000Z'),
        title: 'Overdue Incident Documentation',
        category: 'incident',
        status: 'pending',
        approvalStatus: 'not_required',
        priority: 'urgent',
        dueDate: new Date('2026-03-20T11:00:00.000Z'),
        youngPerson: {
          firstName: 'Gabriel',
          lastName: 'Femi',
        },
        assignee: {
          user: {
            firstName: 'Gabriel',
            lastName: 'Femi',
          },
        },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/overdue-tasks',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: [
        {
          id: 'task_old001',
          taskRef: 'TSK-20260319-OLD001',
          title: 'Overdue Safeguarding Follow-up',
        },
        {
          id: 'task_old002',
          taskRef: 'TSK-20260319-OLD002',
          title: 'Overdue Incident Documentation',
        },
      ],
    });

    const overdueWhere = mockPrisma.task.findMany.mock.calls[0]?.[0]?.where;
    expect(overdueWhere).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          status: { in: ['pending', 'in_progress'] },
          approvalStatus: { notIn: ['pending_approval', 'rejected'] },
          dueDate: { lt: expect.any(Date) },
        }),
      ]),
    });
  });

  it('GET /api/v1/summary/tasks-to-approve returns table-ready approval rows', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.tenantUser.findMany.mockResolvedValueOnce([
      { id: 'admin_1', firstName: 'Ruhman', lastName: 'Akoto' },
      { id: 'manager_1', firstName: 'Izu', lastName: 'Obani' },
    ]);
    mockPrisma.task.count.mockResolvedValueOnce(1);
    mockPrisma.task.findMany.mockResolvedValueOnce([
      {
        id: 'task_zyx987',
        tenantId: 'tenant_1',
        formName: 'Daily Cleaning Schedule',
        formGroup: 'Daily Cleaning Schedule',
        category: 'task_log',
        submissionPayload: {
          approverNames: ['Sonia Akoto', 'Izu Obani'],
        },
        title: 'Daily Cleaning Schedule',
        description: 'Pending manager approval for today.',
        status: 'pending',
        approvalStatus: 'pending_approval',
        priority: 'high',
        dueDate: new Date('2026-03-21T14:00:00.000Z'),
        submittedAt: new Date('2026-03-21T12:23:00.000Z'),
        submittedById: 'admin_1',
        updatedById: 'manager_1',
        completedAt: null,
        rejectionReason: null,
        approvedAt: null,
        assigneeId: 'emp_1',
        approvedById: null,
        youngPersonId: 'yp_1',
        createdById: 'admin_1',
        createdAt: new Date('2026-03-20T11:00:00.000Z'),
        updatedAt: new Date('2026-03-20T11:00:00.000Z'),
        youngPerson: {
          firstName: 'Juadeb',
          lastName: 'Gabriel',
          home: { name: 'Fortuna Homes' },
        },
        assignee: {
          user: {
            firstName: 'Gabriel',
            lastName: 'Femi',
          },
          home: { name: 'Fortuna Homes' },
        },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/tasks-to-approve',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      labels: {
        listTitle: 'Tasks',
        workflowStatus: 'Workflow Status',
        approvalStatus: 'Approval Status',
      },
      data: [
        {
          id: 'task_zyx987',
          taskRef: 'TSK-20260320-ZYX987',
          title: 'Daily Cleaning Schedule',
          category: 'task_log',
          approvalStatus: 'pending_approval',
          references: [],
          review: {
            reviewedByCurrentUser: false,
            reviewedAt: null,
          },
        },
      ],
    });
    const findManyArgs = mockPrisma.task.findMany.mock.calls[0]?.[0];
    const andFilters = findManyArgs.where.AND as Array<Record<string, unknown>>;
    expect(andFilters).not.toContainEqual({ reviewEvents: { none: { userId: 'user_1' } } });
    expect(
      andFilters.some((entry) => {
        if (!('dueDate' in entry)) return false;
        const dueDateFilter = (entry as { dueDate?: Record<string, unknown> }).dueDate ?? {};
        return 'lt' in dueDateFilter || 'lte' in dueDateFilter;
      }),
    ).toBe(false);
  });

  it('GET /api/v1/summary/tasks-to-approve applies form/date/search filters', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.count.mockResolvedValueOnce(0);
    mockPrisma.task.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url:
        '/api/v1/summary/tasks-to-approve'
        + '?formGroup=Daily%20Cleaning%20Schedule'
        + '&taskDateFrom=2026-03-21T00:00:00.000Z'
        + '&taskDateTo=2026-03-21T23:59:59.999Z'
        + '&search=cleaning',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const findManyArgs = mockPrisma.task.findMany.mock.calls[0]?.[0];
    expect(findManyArgs.where).toMatchObject({
      AND: expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            { formGroup: { contains: 'Daily Cleaning Schedule', mode: 'insensitive' } },
          ]),
        }),
        { dueDate: { gte: new Date('2026-03-21T00:00:00.000Z') } },
        { dueDate: { lte: new Date('2026-03-21T23:59:59.999Z') } },
      ]),
    });
  });

  it('GET /api/v1/summary/tasks-to-approve supports scope=all without gate filtering', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.count.mockResolvedValueOnce(0);
    mockPrisma.task.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/tasks-to-approve?scope=all',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const findManyArgs = mockPrisma.task.findMany.mock.calls[0]?.[0];
    const andFilters = findManyArgs.where.AND as Array<Record<string, unknown>>;
    expect(andFilters).not.toContainEqual({ reviewEvents: { none: { userId: 'user_1' } } });
    expect(andFilters.some((entry) => 'dueDate' in entry)).toBe(false);
  });

  it('GET /api/v1/summary/tasks-to-approve supports scope=gate overdue filter', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.count.mockResolvedValueOnce(0);
    mockPrisma.task.findMany.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/tasks-to-approve?scope=gate',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const findManyArgs = mockPrisma.task.findMany.mock.calls[0]?.[0];
    expect(findManyArgs.where).toMatchObject({
      AND: expect.arrayContaining([
        { dueDate: { lt: expect.any(Date) } },
        { reviewEvents: { none: { userId: 'user_1' } } },
      ]),
    });
  });

  it('GET /api/v1/summary/tasks-to-approve/:id returns dynamic detail payload', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task_1494',
      tenantId: 'tenant_1',
      formTemplateKey: 'weekly-menu',
      formName: 'Weekly Menu Planner',
      formGroup: 'Weekly Menu',
      category: 'document',
      title: 'Weekly Menu - 21/03/2026',
      description: 'Pending approval item',
      status: 'pending',
      approvalStatus: 'pending_approval',
      priority: 'medium',
      dueDate: new Date('2026-03-21T09:16:00.000Z'),
      submittedAt: new Date('2026-03-21T16:18:00.000Z'),
      submittedById: 'user_submitter_1',
      updatedById: 'user_updater_1',
      submissionPayload: {
        approverNames: ['Sonia Akoto', 'Izu Obani'],
        sections: [
          {
            title: 'Monday',
            fields: [
              { label: 'Breakfast', type: 'text', value: 'Corn flakes and smoothie' },
            ],
          },
        ],
      },
      completedAt: null,
      rejectionReason: null,
      approvedAt: null,
      assigneeId: 'emp_1',
      approvedById: null,
      youngPersonId: 'yp_1',
      createdById: 'user_submitter_1',
      createdAt: new Date('2026-03-21T16:18:00.000Z'),
      updatedAt: new Date('2026-03-21T16:20:00.000Z'),
      youngPerson: {
        firstName: 'Juadeb',
        lastName: 'Gabriel',
        home: { name: 'Fortuna Homes' },
      },
      assignee: {
        user: { firstName: 'Gabriel', lastName: 'Femi' },
        home: { name: 'Fortuna Homes' },
      },
    });
    mockPrisma.tenantUser.findMany.mockResolvedValueOnce([
      { id: 'user_submitter_1', firstName: 'Ruhman', lastName: 'Akoto' },
      { id: 'user_updater_1', firstName: 'Jubilee', lastName: 'Penn' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/summary/tasks-to-approve/task_1494',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        id: 'task_1494',
        taskRef: 'TSK-20260321-SK1494',
        formName: 'Weekly Menu Planner',
        formGroup: 'Weekly Menu',
        approvalStatusLabel: 'Awaiting Approval',
        meta: {
          homeOrSchool: 'Fortuna Homes',
          relatedTo: 'Juadeb Gabriel',
          submittedBy: 'Ruhman Akoto',
          updatedBy: 'Jubilee Penn',
          approvers: ['Sonia Akoto', 'Izu Obani'],
        },
        labels: {
          pendingApprovalTitle: 'Items Awaiting Approval',
          formName: 'Form',
          homeOrSchool: 'Home / School',
          taskDate: 'Due Date',
          pendingApprovalStatus: 'Awaiting Approval',
        },
        reviewedByCurrentUser: false,
        reviewedAt: null,
        renderPayload: {
          sections: [
            {
              title: 'Monday',
            },
          ],
        },
      },
    });
  });

  it('POST /api/v1/summary/tasks-to-approve/:id/review-events records review state', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task_1494',
      approvalStatus: 'pending_approval',
    });
    mockPrisma.taskReviewEvent.upsert.mockResolvedValueOnce({
      action: 'open_document',
      reviewedAt: new Date('2026-03-23T10:01:00.000Z'),
    });
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/tasks-to-approve/task_1494/review-events',
      headers: authHeader(),
      payload: { action: 'open_document' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        taskId: 'task_1494',
        reviewedByCurrentUser: true,
        action: 'open_document',
      },
    });
    expect(mockPrisma.taskReviewEvent.upsert).toHaveBeenCalledWith({
      where: {
        taskId_userId: {
          taskId: 'task_1494',
          userId: 'user_1',
        },
      },
      update: {
        action: 'open_document',
        reviewedAt: expect.any(Date),
      },
      create: {
        tenantId: 'tenant_1',
        taskId: 'task_1494',
        userId: 'user_1',
        action: 'open_document',
        reviewedAt: expect.any(Date),
      },
      select: {
        action: true,
        reviewedAt: true,
      },
    });
  });

  it('POST /api/v1/summary/tasks-to-approve/:id/approve blocks acknowledge when any popup item is unreviewed', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task_1',
      approvalStatus: 'pending_approval',
    });
    mockPrisma.task.findMany.mockResolvedValueOnce([
      { id: 'task_1' },
      { id: 'task_2' },
    ]);
    mockPrisma.taskReviewEvent.findMany.mockResolvedValueOnce([
      { taskId: 'task_1' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/tasks-to-approve/task_1/approve',
      headers: authHeader(),
      payload: { gateScope: 'global' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      success: false,
      error: {
        code: 'REVIEW_REQUIRED_BEFORE_ACKNOWLEDGE',
        message: 'Please review the item(s) before acknowledging.',
      },
    });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it('POST /api/v1/summary/tasks-to-approve/:id/approve uses per-task gate by default', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task_1',
      tenantId: 'tenant_1',
      submissionPayload: { sections: [] },
      approvalStatus: 'pending_approval',
      title: 'Task 1',
      description: null,
      status: 'pending',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      rejectionReason: null,
      approvedAt: null,
      assigneeId: null,
      approvedById: null,
      youngPersonId: null,
      createdById: 'user_2',
      submittedAt: null,
      submittedById: null,
      updatedById: 'user_2',
      formTemplateKey: null,
      formName: null,
      formGroup: null,
      category: 'task_log',
      deletedAt: null,
      createdAt: new Date('2026-03-20T11:00:00.000Z'),
      updatedAt: new Date('2026-03-20T11:00:00.000Z'),
    });
    mockPrisma.taskReviewEvent.findFirst.mockResolvedValueOnce({
      taskId: 'task_1',
    });
    mockPrisma.task.update.mockResolvedValueOnce({
      id: 'task_1',
      tenantId: 'tenant_1',
      title: 'Task 1',
      description: null,
      status: 'pending',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      rejectionReason: null,
      approvedAt: new Date('2026-03-24T10:00:00.000Z'),
      assigneeId: null,
      approvedById: 'emp_1',
      youngPersonId: null,
      createdById: 'user_2',
      submittedAt: null,
      submittedById: null,
      updatedById: 'user_2',
      formTemplateKey: null,
      formName: null,
      formGroup: null,
      category: 'task_log',
      approvalStatus: 'approved',
      signatureFileId: null,
      submissionPayload: { sections: [] },
      references: [],
      deletedAt: null,
      createdAt: new Date('2026-03-20T11:00:00.000Z'),
      updatedAt: new Date('2026-03-24T10:00:00.000Z'),
    });
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/tasks-to-approve/task_1/approve',
      headers: authHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
    expect(mockPrisma.taskReviewEvent.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant_1',
        userId: 'user_1',
        taskId: 'task_1',
      },
      select: { taskId: true },
    });
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });

  it('POST /api/v1/summary/tasks-to-approve/:id/approve stores signature evidence when provided', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.findFirst.mockResolvedValueOnce({
      id: 'task_1',
      tenantId: 'tenant_1',
      submissionPayload: { sections: [] },
      approvalStatus: 'pending_approval',
      title: 'Task 1',
      description: null,
      status: 'pending',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      rejectionReason: null,
      approvedAt: null,
      assigneeId: null,
      approvedById: null,
      youngPersonId: null,
      createdById: 'user_2',
      submittedAt: null,
      submittedById: null,
      updatedById: 'user_2',
      formTemplateKey: null,
      formName: null,
      formGroup: null,
      category: 'task_log',
      deletedAt: null,
      createdAt: new Date('2026-03-20T11:00:00.000Z'),
      updatedAt: new Date('2026-03-20T11:00:00.000Z'),
    });
    mockPrisma.uploadedFile.findMany.mockResolvedValueOnce([{ id: 'file_sig_1' }]);
    mockPrisma.taskReviewEvent.findFirst.mockResolvedValueOnce({ taskId: 'task_1' });
    mockPrisma.task.update.mockResolvedValueOnce({
      id: 'task_1',
      tenantId: 'tenant_1',
      submissionPayload: {
        sections: [],
        acknowledgement: {
          signatureFileId: 'file_sig_1',
        },
      },
      approvalStatus: 'approved',
      title: 'Task 1',
      description: null,
      status: 'pending',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      rejectionReason: null,
      approvedAt: new Date('2026-03-24T10:00:00.000Z'),
      assigneeId: null,
      approvedById: 'emp_1',
      youngPersonId: null,
      createdById: 'user_2',
      submittedAt: null,
      submittedById: null,
      updatedById: 'user_2',
      formTemplateKey: null,
      formName: null,
      formGroup: null,
      category: 'task_log',
      references: [],
      deletedAt: null,
      createdAt: new Date('2026-03-20T11:00:00.000Z'),
      updatedAt: new Date('2026-03-24T10:00:00.000Z'),
    });
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/tasks-to-approve/task_1/approve',
      headers: authHeader(),
      payload: { comment: 'Approved after signature', signatureFileId: 'file_sig_1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });
    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task_1' },
        data: expect.objectContaining({
          approvalStatus: 'approved',
          submissionPayload: expect.objectContaining({
            acknowledgement: expect.objectContaining({
              mode: 'single',
              signatureFileId: 'file_sig_1',
              comment: 'Approved after signature',
            }),
          }),
        }),
      }),
    );
  });

  it('POST /api/v1/summary/tasks-to-approve/process-batch blocks approve submit when popup has unreviewed items', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.findMany.mockResolvedValueOnce([
      { id: 'task_1' },
      { id: 'task_2' },
    ]);
    mockPrisma.taskReviewEvent.findMany.mockResolvedValueOnce([
      { taskId: 'task_1' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/tasks-to-approve/process-batch',
      headers: authHeader(),
      payload: { taskIds: ['task_1'], action: 'approve' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      success: false,
      error: {
        code: 'REVIEW_REQUIRED_BEFORE_ACKNOWLEDGE',
        message: 'Please review the item(s) before acknowledging.',
      },
    });
  });

  it('POST /api/v1/summary/tasks-to-approve/process-batch stores signature evidence for approve action', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.uploadedFile.findMany.mockResolvedValueOnce([{ id: 'file_sig_1' }]);
    mockPrisma.task.findMany
      .mockResolvedValueOnce([{ id: 'task_1' }])
      .mockResolvedValueOnce([
        { id: 'task_1', approvalStatus: 'pending_approval', submissionPayload: { sections: [] } },
      ]);
    mockPrisma.taskReviewEvent.findMany.mockResolvedValueOnce([{ taskId: 'task_1' }]);
    mockPrisma.task.update.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/tasks-to-approve/process-batch',
      headers: authHeader(),
      payload: { taskIds: ['task_1'], action: 'approve', signatureFileId: 'file_sig_1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: { processed: 1, failed: [] },
    });
    expect(mockPrisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task_1' },
        data: expect.objectContaining({
          approvalStatus: 'approved',
          submissionPayload: expect.objectContaining({
            acknowledgement: expect.objectContaining({
              mode: 'batch',
              signatureFileId: 'file_sig_1',
            }),
          }),
        }),
      }),
    );
  });

  it('POST /api/v1/summary/tasks-to-approve/process-batch rejects signature on reject action', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/summary/tasks-to-approve/process-batch',
      headers: authHeader(),
      payload: { taskIds: ['task_1'], action: 'reject', signatureFileId: 'file_sig_1' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'signatureFileId is only supported when action is approve.',
      },
    });
  });
});

describe('Dashboard routes', () => {
  it('GET /api/v1/dashboard/widgets returns my widgets', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.widget.findMany.mockResolvedValueOnce([
      {
        id: 'widget_1',
        tenantId: 'tenant_1',
        userId: 'user_1',
        title: 'My Tasks This Month',
        period: 'this_month',
        reportsOn: 'tasks',
        createdAt: new Date('2026-03-10T00:00:00.000Z'),
        updatedAt: new Date('2026-03-10T00:00:00.000Z'),
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/widgets',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      success: true,
      data: [
        {
          id: 'widget_1',
          title: 'My Tasks This Month',
        },
      ],
    });
  });

  it('POST /api/v1/dashboard/widgets validates body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboard/widgets',
      headers: authHeader(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'FST_ERR_VALIDATION' },
    });
  });

  it('DELETE /api/v1/dashboard/widgets/:id blocks deleting another user widget', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.widget.findUnique.mockResolvedValueOnce({
      id: 'widget_2',
      tenantId: 'tenant_1',
      userId: 'user_other',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/dashboard/widgets/widget_2',
      headers: authHeader('user_1'),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
