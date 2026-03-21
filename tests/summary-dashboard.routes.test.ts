import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
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
  mockPrisma.user.findMany.mockResolvedValue([]);
});

function authHeader(userId = 'user_1', role: 'staff' | 'manager' | 'admin' = 'manager') {
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
  userRole: 'staff' | 'manager' | 'admin' = 'manager',
  tenantRole: 'staff' | 'sub_admin' | 'tenant_admin' = 'sub_admin',
) {
  mockPrisma.user.findUnique.mockResolvedValueOnce({
    id: userId,
    role: userRole,
    activeTenantId: 'tenant_1',
  });
  mockPrisma.tenant.findUnique.mockResolvedValueOnce({
    id: 'tenant_1',
    isActive: true,
  });
  mockPrisma.tenantMembership.findUnique.mockResolvedValueOnce({
    role: tenantRole,
    status: 'active',
  });
}

describe('Summary routes', () => {
  it('GET /api/v1/summary/stats returns summary KPIs', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.task.count
      .mockResolvedValueOnce(3) // overdue
      .mockResolvedValueOnce(5) // dueToday
      .mockResolvedValueOnce(2) // pendingApproval
      .mockResolvedValueOnce(1) // rejected
      .mockResolvedValueOnce(4) // draft
      .mockResolvedValueOnce(6) // future
      .mockResolvedValueOnce(9); // completed tasks
    mockPrisma.announcement.count.mockResolvedValueOnce(7); // unread announcements

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
        comments: 7,
        rewards: 90,
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
    mockPrisma.user.findUnique.mockResolvedValueOnce({
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
    mockPrisma.user.findUnique.mockResolvedValueOnce({
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
      data: [
        {
          id: 'task_abc123',
          taskRef: 'TSK-20260320-ABC123',
          title: 'Daily Summary For JUADEB GABRIEL',
          relation: 'Juadeb Gabriel',
        },
      ],
    });
  });

  it('GET /api/v1/summary/overdue-tasks returns only overdue rows with taskRef', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.user.findUnique.mockResolvedValueOnce({
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
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
    });
    mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'emp_1', homeId: 'home_1' });
    mockPrisma.user.findMany.mockResolvedValueOnce([
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
        pendingApprovalTitle: 'Items Awaiting Approval',
        configuredInformation: 'Current Filters',
        status: 'Approval Status',
        pendingApprovalStatus: 'Awaiting Approval',
        resetGrid: 'Reset table',
      },
      data: [
        {
          id: 'task_zyx987',
          taskRef: 'TSK-20260320-ZYX987',
          title: 'Daily Cleaning Schedule',
          formGroup: 'Daily Cleaning Schedule',
          approvalStatus: 'pending_approval',
          approvalStatusLabel: 'Awaiting Approval',
          homeOrSchool: 'Fortuna Homes',
          relatedTo: 'Juadeb Gabriel',
          submittedBy: 'Ruhman Akoto',
          updatedBy: 'Izu Obani',
          approvers: ['Sonia Akoto', 'Izu Obani'],
        },
      ],
    });
  });

  it('GET /api/v1/summary/tasks-to-approve applies form/date/search filters', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.user.findUnique.mockResolvedValueOnce({
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

  it('GET /api/v1/summary/tasks-to-approve/:id returns dynamic detail payload', async () => {
    mockTenantContext('user_1', 'manager', 'sub_admin');
    mockPrisma.user.findUnique.mockResolvedValueOnce({
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
    mockPrisma.user.findMany.mockResolvedValueOnce([
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
