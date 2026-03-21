import {
  AuditAction,
  TenantRole,
  TaskApprovalStatus,
  TaskStatus,
  UserRole,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type { BatchApproveBody, SummaryListQuery } from './summary.schema.js';

type UserContext = {
  id: string;
  tenantId: string;
  role: UserRole;
  tenantRole: TenantRole | null;
  employee: { id: string; homeId: string | null } | null;
};

const TODO_SORTABLE_FIELDS = new Set([
  'title',
  'status',
  'approvalStatus',
  'priority',
  'dueDate',
  'createdAt',
  'updatedAt',
]);
const REWARD_POINTS_PER_COMPLETED_TASK = 10;

function getTodayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function canApprove(user: UserContext) {
  if (user.role === UserRole.super_admin) return true;
  if (user.tenantRole === TenantRole.tenant_admin || user.tenantRole === TenantRole.sub_admin) {
    return true;
  }
  return user.role === UserRole.manager || user.role === UserRole.admin;
}

async function getUserContext(userId: string): Promise<UserContext> {
  const tenant = await requireTenantContext(userId);
  const [user, employee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
      },
    }),
    prisma.employee.findFirst({
      where: {
        userId,
        tenantId: tenant.tenantId,
        isActive: true,
      },
      select: {
        id: true,
        homeId: true,
      },
    }),
  ]);

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  return {
    id: user.id,
    role: user.role,
    tenantId: tenant.tenantId,
    tenantRole: tenant.tenantRole,
    employee,
  };
}

function buildPersonalTaskScope(user: UserContext): Prisma.TaskWhereInput {
  if (user.employee?.id) {
    return {
      AND: [
        { tenantId: user.tenantId, deletedAt: null },
        { OR: [{ assigneeId: user.employee.id }, { createdById: user.id }] },
      ],
    };
  }
  return {
    tenantId: user.tenantId,
    createdById: user.id,
    deletedAt: null,
  };
}

function buildTaskOrderBy(query: SummaryListQuery): Prisma.TaskOrderByWithRelationInput[] {
  if (query.sortBy && TODO_SORTABLE_FIELDS.has(query.sortBy)) {
    return [{ [query.sortBy]: query.sortOrder }] as Prisma.TaskOrderByWithRelationInput[];
  }

  return [{ dueDate: 'asc' }, { createdAt: 'desc' }];
}

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function toTaskRef(task: { id: string; createdAt: Date }) {
  const year = task.createdAt.getUTCFullYear();
  const month = String(task.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(task.createdAt.getUTCDate()).padStart(2, '0');
  const alphanumericId = task.id.replace(/[^a-zA-Z0-9]/g, '');
  const suffix = alphanumericId.slice(-6).toUpperCase().padStart(6, '0');
  return `TSK-${year}${month}${day}-${suffix}`;
}

function toTodoItem(
  task: {
    id: string;
    createdAt: Date;
    title: string;
    status: TaskStatus;
    approvalStatus: TaskApprovalStatus;
    priority: string;
    dueDate: Date | null;
    youngPerson: { firstName: string; lastName: string } | null;
    assignee: { user: { firstName: string; lastName: string } } | null;
  },
) {
  return {
    id: task.id,
    taskRef: toTaskRef(task),
    title: task.title,
    relation: task.youngPerson
      ? `${task.youngPerson.firstName} ${task.youngPerson.lastName}`
      : null,
    status: task.status,
    approvalStatus: task.approvalStatus,
    priority: task.priority,
    assignee: task.assignee
      ? `${task.assignee.user.firstName} ${task.assignee.user.lastName}`
      : null,
    dueDate: task.dueDate,
  };
}

export async function getSummaryStats(userId: string) {
  const user = await getUserContext(userId);
  const scope = buildPersonalTaskScope(user);
  const { start, end } = getTodayBounds();
  const now = new Date();

  const withScope = (extra: Prisma.TaskWhereInput): Prisma.TaskWhereInput => ({
    AND: [scope, extra],
  });

  const [overdue, dueToday, pendingApproval, rejected, draft, future, comments, completedTasks] =
    await Promise.all([
      prisma.task.count({
        where: withScope({
          dueDate: { lt: start },
          status: { notIn: [TaskStatus.completed, TaskStatus.cancelled] },
        }),
      }),
      prisma.task.count({
        where: withScope({
          dueDate: { gte: start, lte: end },
          status: { notIn: [TaskStatus.completed, TaskStatus.cancelled] },
        }),
      }),
      prisma.task.count({
        where: canApprove(user)
          ? {
              tenantId: user.tenantId,
              deletedAt: null,
              approvalStatus: TaskApprovalStatus.pending_approval,
            }
          : withScope({ approvalStatus: TaskApprovalStatus.pending_approval }),
      }),
      prisma.task.count({
        where: withScope({ approvalStatus: TaskApprovalStatus.rejected }),
      }),
      prisma.task.count({
        where: withScope({ status: TaskStatus.pending, dueDate: null }),
      }),
      prisma.task.count({
        where: withScope({ dueDate: { gt: end } }),
      }),
      prisma.announcement.count({
        where: {
          tenantId: user.tenantId,
          deletedAt: null,
          publishedAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          reads: { none: { userId: user.id } },
        },
      }),
      prisma.task.count({
        where: withScope({ status: TaskStatus.completed }),
      }),
    ]);

  return {
    overdue,
    dueToday,
    pendingApproval,
    rejected,
    draft,
    future,
    comments,
    rewards: completedTasks * REWARD_POINTS_PER_COMPLETED_TASK,
  };
}

export async function listTodos(userId: string, query: SummaryListQuery) {
  const user = await getUserContext(userId);
  const scope = buildPersonalTaskScope(user);
  const skip = (query.page - 1) * query.pageSize;

  const filters: Prisma.TaskWhereInput[] = [scope];
  if (query.search) {
    filters.push({
      OR: [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.TaskWhereInput = { AND: filters };
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: buildTaskOrderBy(query),
      skip,
      take: query.pageSize,
      include: {
        youngPerson: {
          select: { firstName: true, lastName: true },
        },
        assignee: {
          select: {
            user: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    }),
  ]);

  return {
    data: rows.map((row) => toTodoItem(row)),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function listOverdueTodos(userId: string, query: SummaryListQuery) {
  const user = await getUserContext(userId);
  const scope = buildPersonalTaskScope(user);
  const skip = (query.page - 1) * query.pageSize;
  const { start } = getTodayBounds();

  const filters: Prisma.TaskWhereInput[] = [
    scope,
    {
      dueDate: { lt: start },
      status: { notIn: [TaskStatus.completed, TaskStatus.cancelled] },
    },
  ];

  if (query.search) {
    filters.push({
      OR: [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.TaskWhereInput = { AND: filters };
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: buildTaskOrderBy(query),
      skip,
      take: query.pageSize,
      include: {
        youngPerson: {
          select: { firstName: true, lastName: true },
        },
        assignee: {
          select: {
            user: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    }),
  ]);

  return {
    data: rows.map((row) => toTodoItem(row)),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function listTasksToApprove(userId: string, query: SummaryListQuery) {
  const user = await getUserContext(userId);
  if (!canApprove(user)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  const skip = (query.page - 1) * query.pageSize;
  const filters: Prisma.TaskWhereInput[] = [
    { tenantId: user.tenantId, deletedAt: null, approvalStatus: TaskApprovalStatus.pending_approval },
  ];

  if (query.search) {
    filters.push({
      OR: [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.TaskWhereInput = { AND: filters };
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: buildTaskOrderBy(query),
      skip,
      take: query.pageSize,
    }),
  ]);

  return {
    data: rows.map((row) => ({
      ...row,
      taskRef: toTaskRef(row),
    })),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function approveTask(userId: string, taskId: string, comment?: string) {
  const user = await getUserContext(userId);
  if (!canApprove(user)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  const existing = await prisma.task.findFirst({
    where: { id: taskId, tenantId: user.tenantId, deletedAt: null },
  });
  if (!existing) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }
  if (existing.approvalStatus !== TaskApprovalStatus.pending_approval) {
    throw httpError(409, 'INVALID_TASK_STATE', 'Task is not in pending_approval state.');
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      approvalStatus: TaskApprovalStatus.approved,
      approvedAt: new Date(),
      approvedById: user.employee?.id ?? null,
      rejectionReason: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.record_updated,
      entityType: 'task_approval',
      entityId: taskId,
      metadata: { action: 'approve', comment: comment ?? null },
    },
  });

  return updated;
}

export async function processTaskBatch(userId: string, body: BatchApproveBody) {
  const user = await getUserContext(userId);
  if (!canApprove(user)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: body.taskIds }, tenantId: user.tenantId, deletedAt: null },
    select: { id: true, approvalStatus: true },
  });
  const taskMap = new Map(tasks.map((task) => [task.id, task]));

  let processed = 0;
  const failed: Array<{ id: string; reason: string }> = [];

  for (const taskId of body.taskIds) {
    const task = taskMap.get(taskId);
    if (!task) {
      failed.push({ id: taskId, reason: 'Task not found.' });
      continue;
    }

    if (task.approvalStatus !== TaskApprovalStatus.pending_approval) {
      failed.push({ id: taskId, reason: 'Task is not in pending_approval state.' });
      continue;
    }

    try {
      await prisma.task.update({
        where: { id: taskId },
        data:
          body.action === 'approve'
            ? {
                approvalStatus: TaskApprovalStatus.approved,
                approvedAt: new Date(),
                approvedById: user.employee?.id ?? null,
                rejectionReason: null,
              }
            : {
                approvalStatus: TaskApprovalStatus.rejected,
                approvedAt: new Date(),
                approvedById: user.employee?.id ?? null,
                rejectionReason: body.rejectionReason ?? 'Rejected in batch review.',
              },
      });
      processed += 1;
    } catch {
      failed.push({ id: taskId, reason: 'Failed to update task.' });
    }
  }

  if (processed > 0) {
    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: AuditAction.record_updated,
        entityType: 'task_approval_batch',
        metadata: {
          action: body.action,
          processed,
          failed: failed.length,
        },
      },
    });
  }

  return { processed, failed };
}

export async function getTodayProvisions(userId: string) {
  const user = await getUserContext(userId);
  const { start, end } = getTodayBounds();

  const homes = canApprove(user)
    ? await prisma.home.findMany({
        where: { tenantId: user.tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : user.employee?.homeId
      ? await prisma.home.findMany({
          where: {
            id: user.employee.homeId,
            tenantId: user.tenantId,
            isActive: true,
          },
          select: { id: true, name: true },
        })
      : [];

  if (homes.length === 0) {
    return [];
  }

  const homeIds = homes.map((home) => home.id);
  const [events, shifts] = await Promise.all([
    prisma.homeEvent.findMany({
      where: {
        tenantId: user.tenantId,
        homeId: { in: homeIds },
        startsAt: { gte: start, lte: end },
      },
      orderBy: [{ homeId: 'asc' }, { startsAt: 'asc' }],
    }),
    prisma.employeeShift.findMany({
      where: {
        tenantId: user.tenantId,
        homeId: { in: homeIds },
        startTime: { lte: end },
        endTime: { gte: start },
      },
      include: {
        employee: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: [{ homeId: 'asc' }, { startTime: 'asc' }],
    }),
  ]);

  const eventsByHome = new Map<
    string,
    Array<{
      id: string;
      title: string;
      time: Date;
      description: string | null;
    }>
  >();
  for (const event of events) {
    const homeEvents = eventsByHome.get(event.homeId) ?? [];
    homeEvents.push({
      id: event.id,
      title: event.title,
      time: event.startsAt,
      description: event.description,
    });
    eventsByHome.set(event.homeId, homeEvents);
  }

  const shiftsByHome = new Map<
    string,
    Array<{
      employeeId: string;
      employeeName: string;
      startTime: Date;
      endTime: Date;
    }>
  >();
  for (const shift of shifts) {
    const homeShifts = shiftsByHome.get(shift.homeId) ?? [];
    homeShifts.push({
      employeeId: shift.employeeId,
      employeeName: `${shift.employee.user.firstName} ${shift.employee.user.lastName}`,
      startTime: shift.startTime,
      endTime: shift.endTime,
    });
    shiftsByHome.set(shift.homeId, homeShifts);
  }

  return homes.map((home) => ({
    homeId: home.id,
    homeName: home.name,
    events: eventsByHome.get(home.id) ?? [],
    shifts: shiftsByHome.get(home.id) ?? [],
  }));
}
