import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
    },
    task: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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
});

function authHeader(userId = 'user_1', role: 'staff' | 'manager' | 'admin' = 'manager') {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
  });
  return { authorization: `Bearer ${token}` };
}

describe('Summary routes', () => {
  it('GET /api/v1/summary/stats returns summary KPIs', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
      employee: { id: 'emp_1', homeId: 'home_1' },
    });
    mockPrisma.task.count
      .mockResolvedValueOnce(3) // overdue
      .mockResolvedValueOnce(5) // dueToday
      .mockResolvedValueOnce(2) // pendingApproval
      .mockResolvedValueOnce(1) // rejected
      .mockResolvedValueOnce(4) // draft
      .mockResolvedValueOnce(6); // future

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
        comments: 0,
        rewards: 0,
      },
    });
  });

  it('GET /api/v1/summary/provisions returns grouped events and shifts', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user_1',
      role: 'manager',
      employee: { id: 'emp_1', homeId: 'home_1' },
    });
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
});

describe('Dashboard routes', () => {
  it('GET /api/v1/dashboard/widgets returns my widgets', async () => {
    mockPrisma.widget.findMany.mockResolvedValueOnce([
      {
        id: 'widget_1',
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
    mockPrisma.widget.findUnique.mockResolvedValueOnce({
      id: 'widget_2',
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
