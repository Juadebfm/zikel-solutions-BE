import {
  AuditAction,
  TaskApprovalStatus,
  TaskStatus,
  UserRole,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import type { BatchApproveBody, SummaryListQuery } from './summary.schema.js';

type UserContext = {
  id: string;
  role: UserRole;
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

function getTodayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function canApprove(role: UserRole) {
  return role === UserRole.manager || role === UserRole.admin;
}

async function getUserContext(userId: string): Promise<UserContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      employee: {
        select: {
          id: true,
          homeId: true,
        },
      },
    },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  return user;
}

function buildPersonalTaskScope(user: UserContext): Prisma.TaskWhereInput {
  if (user.employee?.id) {
    return {
      OR: [{ assigneeId: user.employee.id }, { createdById: user.id }],
    };
  }
  return { createdById: user.id };
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

function toTodoItem(
  task: {
    id: string;
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

  const withScope = (extra: Prisma.TaskWhereInput): Prisma.TaskWhereInput => ({
    AND: [scope, extra],
  });

  const [overdue, dueToday, pendingApproval, rejected, draft, future] =
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
        where: canApprove(user.role)
          ? { approvalStatus: TaskApprovalStatus.pending_approval }
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
    ]);

  return {
    overdue,
    dueToday,
    pendingApproval,
    rejected,
    draft,
    future,
    comments: 0,
    rewards: 0,
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

export async function listTasksToApprove(userId: string, query: SummaryListQuery) {
  const user = await getUserContext(userId);
  if (!canApprove(user.role)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  const skip = (query.page - 1) * query.pageSize;
  const filters: Prisma.TaskWhereInput[] = [
    { approvalStatus: TaskApprovalStatus.pending_approval },
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
    data: rows,
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function approveTask(userId: string, taskId: string, comment?: string) {
  const user = await getUserContext(userId);
  if (!canApprove(user.role)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  const existing = await prisma.task.findUnique({ where: { id: taskId } });
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
  if (!canApprove(user.role)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: body.taskIds } },
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

  const homes = canApprove(user.role)
    ? await prisma.home.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : user.employee?.homeId
      ? await prisma.home.findMany({
          where: { id: user.employee.homeId },
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
        homeId: { in: homeIds },
        startsAt: { gte: start, lte: end },
      },
      orderBy: [{ homeId: 'asc' }, { startsAt: 'asc' }],
    }),
    prisma.employeeShift.findMany({
      where: {
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
