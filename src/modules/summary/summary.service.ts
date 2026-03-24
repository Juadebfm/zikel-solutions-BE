import {
  AuditAction,
  TenantRole,
  TaskApprovalStatus,
  TaskStatus,
  UserRole,
  type TaskPriority,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type { BatchApproveBody, ReviewTaskBody, SummaryListQuery } from './summary.schema.js';

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
const ACTIVE_WORKFLOW_STATUSES: TaskStatus[] = [TaskStatus.pending, TaskStatus.in_progress];
const EXCLUDED_APPROVAL_BUCKET_STATUSES: TaskApprovalStatus[] = [
  TaskApprovalStatus.pending_approval,
  TaskApprovalStatus.rejected,
];
const APPROVAL_STATUS_LABELS: Record<TaskApprovalStatus, string> = {
  not_required: 'Not Required',
  pending_approval: 'Awaiting Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  processing: 'Processing',
};
const PENDING_APPROVAL_LABELS = {
  pendingApprovalTitle: 'Items Awaiting Approval',
  configuredInformation: 'Current Filters',
  formName: 'Form',
  logStatuses: 'Submission Status',
  status: 'Approval Status',
  homeOrSchool: 'Home / School',
  relatesTo: 'Related To',
  taskDate: 'Due Date',
  originallyRecordedOn: 'Submitted On',
  originallyRecordedBy: 'Submitted By',
  lastUpdatedOn: 'Updated On',
  lastUpdatedBy: 'Updated By',
  pendingApprovalStatus: 'Awaiting Approval',
  resetGrid: 'Reset table',
} as const;

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

async function getReviewMap(userId: string, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, Date>();
  const rows = await prisma.taskReviewEvent.findMany({
    where: {
      userId,
      taskId: { in: taskIds },
    },
    select: {
      taskId: true,
      reviewedAt: true,
    },
  });
  return new Map(rows.map((row) => [row.taskId, row.reviewedAt]));
}

async function ensureActorReviewedAllPendingApprovals(user: UserContext) {
  const pendingRows = await prisma.task.findMany({
    where: {
      tenantId: user.tenantId,
      deletedAt: null,
      approvalStatus: TaskApprovalStatus.pending_approval,
    },
    select: { id: true },
  });

  if (pendingRows.length === 0) {
    return;
  }

  const pendingTaskIds = pendingRows.map((row) => row.id);
  const reviews = await prisma.taskReviewEvent.findMany({
    where: {
      tenantId: user.tenantId,
      userId: user.id,
      taskId: { in: pendingTaskIds },
    },
    select: { taskId: true },
  });

  const reviewedTaskIds = new Set(reviews.map((row) => row.taskId));
  const hasUnreviewed = pendingTaskIds.some((taskId) => !reviewedTaskIds.has(taskId));
  if (hasUnreviewed) {
    throw httpError(
      409,
      'REVIEW_REQUIRED_BEFORE_ACKNOWLEDGE',
      'Please review the item(s) before acknowledging.',
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseApprovers(payload: Prisma.JsonValue | null): string[] {
  const payloadObj = asRecord(payload);
  if (!payloadObj) return [];

  const approverNames = payloadObj.approverNames;
  if (Array.isArray(approverNames)) {
    return approverNames.filter((item): item is string => typeof item === 'string');
  }

  const approvers = payloadObj.approvers;
  if (Array.isArray(approvers)) {
    return approvers.filter((item): item is string => typeof item === 'string');
  }
  if (typeof approvers === 'string') {
    return approvers
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
  }

  return [];
}

async function getUserNameMap(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>();

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  });

  return new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));
}

type TaskToApproveRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  formName: string | null;
  formGroup: string | null;
  submissionPayload: Prisma.JsonValue | null;
  approvalStatus: TaskApprovalStatus;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  submittedAt: Date | null;
  submittedById: string | null;
  updatedById: string | null;
  createdById: string | null;
  youngPerson: {
    firstName: string;
    lastName: string;
    home: { name: string } | null;
  } | null;
  assignee: {
    user: { firstName: string; lastName: string };
    home: { name: string } | null;
  } | null;
};

function toTasksToApproveItem(
  row: TaskToApproveRow,
  userNameMap: Map<string, string>,
  reviewMap: Map<string, Date>,
) {
  const submittedBy =
    (row.submittedById ? userNameMap.get(row.submittedById) : null)
    ?? (row.createdById ? userNameMap.get(row.createdById) : null)
    ?? null;
  const updatedBy =
    (row.updatedById ? userNameMap.get(row.updatedById) : null)
    ?? submittedBy
    ?? null;
  const reviewedAt = reviewMap.get(row.id) ?? null;

  return {
    id: row.id,
    taskRef: toTaskRef(row),
    title: row.title,
    formGroup: row.formGroup ?? row.formName ?? null,
    approvalStatus: row.approvalStatus,
    approvalStatusLabel: APPROVAL_STATUS_LABELS[row.approvalStatus],
    homeOrSchool: row.youngPerson?.home?.name ?? row.assignee?.home?.name ?? null,
    relatedTo: row.youngPerson
      ? `${row.youngPerson.firstName} ${row.youngPerson.lastName}`.trim()
      : null,
    taskDate: row.dueDate,
    submittedOn: row.submittedAt ?? row.createdAt,
    submittedBy,
    updatedOn: row.updatedAt,
    updatedBy,
    approvers: parseApprovers(row.submissionPayload),
    reviewedByCurrentUser: reviewedAt !== null,
    reviewedAt,
  };
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
  const normalWorkflowApprovalScope: Prisma.TaskWhereInput = {
    approvalStatus: { notIn: EXCLUDED_APPROVAL_BUCKET_STATUSES },
  };

  const [overdue, dueToday, pendingApproval, rejected, draft, future, comments, completedTasks] =
    await Promise.all([
      prisma.task.count({
        where: withScope({
          ...normalWorkflowApprovalScope,
          status: { in: ACTIVE_WORKFLOW_STATUSES },
          dueDate: { lt: start },
        }),
      }),
      prisma.task.count({
        where: withScope({
          ...normalWorkflowApprovalScope,
          status: { in: ACTIVE_WORKFLOW_STATUSES },
          dueDate: { gte: start, lte: end },
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
        where: withScope({
          ...normalWorkflowApprovalScope,
          status: TaskStatus.pending,
          dueDate: null,
        }),
      }),
      prisma.task.count({
        where: withScope({
          ...normalWorkflowApprovalScope,
          status: { in: ACTIVE_WORKFLOW_STATUSES },
          dueDate: { gt: end },
        }),
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
      approvalStatus: { notIn: EXCLUDED_APPROVAL_BUCKET_STATUSES },
      status: { in: ACTIVE_WORKFLOW_STATUSES },
      dueDate: { lt: start },
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
        { formName: { contains: query.search, mode: 'insensitive' } },
        { formGroup: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }
  if (query.formGroup) {
    filters.push({
      OR: [
        { formGroup: { contains: query.formGroup, mode: 'insensitive' } },
        { formName: { contains: query.formGroup, mode: 'insensitive' } },
      ],
    });
  }
  if (query.taskDateFrom) {
    filters.push({ dueDate: { gte: query.taskDateFrom } });
  }
  if (query.taskDateTo) {
    filters.push({ dueDate: { lte: query.taskDateTo } });
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
          select: {
            firstName: true,
            lastName: true,
            home: { select: { name: true } },
          },
        },
        assignee: {
          select: {
            user: {
              select: { firstName: true, lastName: true },
            },
            home: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const userIds = [
    ...new Set(
      rows.flatMap((row) => [row.submittedById, row.updatedById, row.createdById]).filter((id): id is string => Boolean(id)),
    ),
  ];
  const taskIds = rows.map((row) => row.id);
  const [userNameMap, reviewMap] = await Promise.all([
    getUserNameMap(userIds),
    getReviewMap(user.id, taskIds),
  ]);

  return {
    data: rows.map((row) => toTasksToApproveItem(row as TaskToApproveRow, userNameMap, reviewMap)),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
    labels: PENDING_APPROVAL_LABELS,
  };
}

export async function getTaskToApproveDetail(userId: string, taskId: string) {
  const user = await getUserContext(userId);
  if (!canApprove(user)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  const row = await prisma.task.findFirst({
    where: {
      id: taskId,
      tenantId: user.tenantId,
      deletedAt: null,
      approvalStatus: TaskApprovalStatus.pending_approval,
    },
    include: {
      youngPerson: {
        select: {
          firstName: true,
          lastName: true,
          home: { select: { name: true } },
        },
      },
      assignee: {
        select: {
          user: {
            select: { firstName: true, lastName: true },
          },
          home: { select: { name: true } },
        },
      },
    },
  });

  if (!row) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  const userIds = [
    ...new Set([row.submittedById, row.updatedById, row.createdById].filter((id): id is string => Boolean(id))),
  ];
  const [userNameMap, reviewRow] = await Promise.all([
    getUserNameMap(userIds),
    prisma.taskReviewEvent.findFirst({
      where: {
        tenantId: user.tenantId,
        taskId: row.id,
        userId: user.id,
      },
      select: { reviewedAt: true },
    }),
  ]);
  const submittedBy =
    (row.submittedById ? userNameMap.get(row.submittedById) : null)
    ?? (row.createdById ? userNameMap.get(row.createdById) : null)
    ?? null;
  const updatedBy =
    (row.updatedById ? userNameMap.get(row.updatedById) : null)
    ?? submittedBy
    ?? null;
  const approvers = parseApprovers(row.submissionPayload);
  const relatedTo = row.youngPerson
    ? `${row.youngPerson.firstName} ${row.youngPerson.lastName}`.trim()
    : null;
  const homeOrSchool = row.youngPerson?.home?.name ?? row.assignee?.home?.name ?? null;
  const reviewedAt = reviewRow?.reviewedAt ?? null;

  return {
    id: row.id,
    taskRef: toTaskRef(row),
    title: row.title,
    formName: row.formName ?? null,
    formGroup: row.formGroup ?? row.formName ?? null,
    approvalStatus: row.approvalStatus,
    approvalStatusLabel: APPROVAL_STATUS_LABELS[row.approvalStatus],
    meta: {
      taskId: row.id,
      taskRef: toTaskRef(row),
      homeOrSchool,
      relatedTo,
      taskDate: row.dueDate,
      submittedOn: row.submittedAt ?? row.createdAt,
      submittedBy,
      updatedOn: row.updatedAt,
      updatedBy,
      approvers,
    },
    labels: PENDING_APPROVAL_LABELS,
    // Keep per-form field labels/value structure as submitted (dynamic, no hardcoded rewrite).
    renderPayload: row.submissionPayload ?? { sections: [] },
    reviewedByCurrentUser: reviewedAt !== null,
    reviewedAt,
  };
}

export async function recordTaskReviewEvent(userId: string, taskId: string, body: ReviewTaskBody) {
  const user = await getUserContext(userId);
  if (!canApprove(user)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  const existing = await prisma.task.findFirst({
    where: {
      id: taskId,
      tenantId: user.tenantId,
      deletedAt: null,
      approvalStatus: TaskApprovalStatus.pending_approval,
    },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  const reviewedAt = new Date();
  const review = await prisma.taskReviewEvent.upsert({
    where: {
      taskId_userId: {
        taskId,
        userId: user.id,
      },
    },
    update: {
      action: body.action,
      reviewedAt,
    },
    create: {
      tenantId: user.tenantId,
      taskId,
      userId: user.id,
      action: body.action,
      reviewedAt,
    },
    select: {
      action: true,
      reviewedAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.record_accessed,
      entityType: 'task_approval_review',
      entityId: taskId,
      metadata: { action: body.action },
    },
  });

  return {
    taskId,
    reviewedByCurrentUser: true as const,
    reviewedAt: review.reviewedAt,
    action: review.action,
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

  await ensureActorReviewedAllPendingApprovals(user);

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

  if (body.action === 'approve') {
    await ensureActorReviewedAllPendingApprovals(user);
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
