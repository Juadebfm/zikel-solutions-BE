import {
  AuditAction,
  TaskApprovalStatus,
  TaskStatus,
  TenantRole,
  UserRole,
  type Prisma,
  type Task,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type { CreateTaskBody, ListTasksQuery, UpdateTaskBody } from './tasks.schema.js';

type TaskActorContext = {
  userId: string;
  userRole: UserRole;
  tenantId: string;
  tenantRole: TenantRole | null;
  employeeId: string | null;
};

const SORTABLE_FIELDS = new Set([
  'title',
  'status',
  'approvalStatus',
  'priority',
  'dueDate',
  'createdAt',
  'updatedAt',
]);

function isPrivilegedActor(actor: TaskActorContext) {
  if (actor.userRole === UserRole.super_admin) return true;
  if (actor.userRole === UserRole.admin || actor.userRole === UserRole.manager) return true;
  return actor.tenantRole === TenantRole.tenant_admin || actor.tenantRole === TenantRole.sub_admin;
}

function ownsTask(actor: TaskActorContext, task: Pick<Task, 'createdById' | 'assigneeId'>) {
  if (task.createdById === actor.userId) return true;
  return Boolean(actor.employeeId && task.assigneeId === actor.employeeId);
}

function mapTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    approvalStatus: task.approvalStatus,
    priority: task.priority,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    rejectionReason: task.rejectionReason,
    approvedAt: task.approvedAt,
    assigneeId: task.assigneeId,
    approvedById: task.approvedById,
    youngPersonId: task.youngPersonId,
    createdById: task.createdById,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function paginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function orderByFromQuery(query: ListTasksQuery): Prisma.TaskOrderByWithRelationInput[] {
  if (query.sortBy && SORTABLE_FIELDS.has(query.sortBy)) {
    return [{ [query.sortBy]: query.sortOrder }] as Prisma.TaskOrderByWithRelationInput[];
  }
  return [{ dueDate: 'asc' }, { createdAt: 'desc' }];
}

async function resolveActorContext(actorUserId: string): Promise<TaskActorContext> {
  const tenant = await requireTenantContext(actorUserId);
  const [user, employee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, role: true },
    }),
    prisma.employee.findFirst({
      where: {
        userId: actorUserId,
        tenantId: tenant.tenantId,
        isActive: true,
      },
      select: { id: true },
    }),
  ]);

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  return {
    userId: user.id,
    userRole: user.role,
    tenantId: tenant.tenantId,
    tenantRole: tenant.tenantRole,
    employeeId: employee?.id ?? null,
  };
}

async function ensureTaskRelationsInTenant(
  tenantId: string,
  body: {
    assigneeId?: string | null | undefined;
    youngPersonId?: string | null | undefined;
  },
) {
  if (body.assigneeId !== undefined && body.assigneeId !== null) {
    const employee = await prisma.employee.findFirst({
      where: {
        id: body.assigneeId,
        tenantId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!employee) {
      throw httpError(422, 'ASSIGNEE_NOT_FOUND', 'Assignee does not exist in active tenant.');
    }
  }

  if (body.youngPersonId !== undefined && body.youngPersonId !== null) {
    const youngPerson = await prisma.youngPerson.findFirst({
      where: { id: body.youngPersonId, tenantId },
      select: { id: true },
    });
    if (!youngPerson) {
      throw httpError(422, 'YOUNG_PERSON_NOT_FOUND', 'Young person does not exist in active tenant.');
    }
  }
}

export async function listTasks(actorUserId: string, query: ListTasksQuery) {
  const actor = await resolveActorContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;

  const filters: Prisma.TaskWhereInput[] = [{ tenantId: actor.tenantId, deletedAt: null }];
  const privileged = isPrivilegedActor(actor);

  if (!privileged || query.mine) {
    const personalScope: Prisma.TaskWhereInput = actor.employeeId
      ? { OR: [{ createdById: actor.userId }, { assigneeId: actor.employeeId }] }
      : { createdById: actor.userId };
    filters.push(personalScope);
  }

  if (query.search) {
    filters.push({
      OR: [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }
  if (query.status) filters.push({ status: query.status });
  if (query.approvalStatus) filters.push({ approvalStatus: query.approvalStatus });
  if (query.priority) filters.push({ priority: query.priority });
  if (query.assigneeId) filters.push({ assigneeId: query.assigneeId });
  if (query.youngPersonId) filters.push({ youngPersonId: query.youngPersonId });

  const where: Prisma.TaskWhereInput = { AND: filters };

  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: orderByFromQuery(query),
      skip,
      take: query.pageSize,
    }),
  ]);

  await logSensitiveReadAccess({
    actorUserId,
    tenantId: actor.tenantId,
    entityType: 'task',
    source: 'tasks.list',
    scope: 'list',
    resultCount: rows.length,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      hasSearch: Boolean(query.search),
      status: query.status ?? null,
      approvalStatus: query.approvalStatus ?? null,
      priority: query.priority ?? null,
      assigneeId: query.assigneeId ?? null,
      youngPersonId: query.youngPersonId ?? null,
      mine: query.mine ?? null,
    },
  });

  return {
    data: rows.map(mapTask),
    meta: paginationMeta(total, query.page, query.pageSize),
  };
}

export async function getTask(actorUserId: string, taskId: string) {
  const actor = await resolveActorContext(actorUserId);
  const task = await prisma.task.findFirst({
    where: { id: taskId, tenantId: actor.tenantId, deletedAt: null },
  });

  if (!task) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  if (!isPrivilegedActor(actor) && !ownsTask(actor, task)) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  await logSensitiveReadAccess({
    actorUserId,
    tenantId: actor.tenantId,
    entityType: 'task',
    entityId: taskId,
    source: 'tasks.get',
    scope: 'detail',
    resultCount: 1,
  });

  return mapTask(task);
}

export async function createTask(actorUserId: string, body: CreateTaskBody) {
  const actor = await resolveActorContext(actorUserId);
  const privileged = isPrivilegedActor(actor);

  if (!privileged) {
    if (body.assigneeId && body.assigneeId !== actor.employeeId) {
      throw httpError(
        403,
        'TASK_ASSIGN_FORBIDDEN',
        'You can only assign tasks to yourself with your current role.',
      );
    }
    if (
      body.approvalStatus &&
      body.approvalStatus !== TaskApprovalStatus.not_required &&
      body.approvalStatus !== TaskApprovalStatus.pending_approval
    ) {
      throw httpError(
        403,
        'TASK_APPROVAL_STATE_FORBIDDEN',
        'You do not have permission to set this approval status.',
      );
    }
  }

  const createRelationInputs: { assigneeId?: string; youngPersonId?: string } = {};
  if (body.assigneeId !== undefined) createRelationInputs.assigneeId = body.assigneeId;
  if (body.youngPersonId !== undefined) createRelationInputs.youngPersonId = body.youngPersonId;
  await ensureTaskRelationsInTenant(actor.tenantId, createRelationInputs);

  const task = await prisma.task.create({
    data: {
      tenantId: actor.tenantId,
      title: body.title,
      description: body.description ?? null,
      status: body.status ?? TaskStatus.pending,
      approvalStatus: body.approvalStatus ?? TaskApprovalStatus.not_required,
      priority: body.priority,
      dueDate: body.dueDate ?? null,
      assigneeId: body.assigneeId ?? null,
      youngPersonId: body.youngPersonId ?? null,
      createdById: actor.userId,
      completedAt: body.status === TaskStatus.completed ? new Date() : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_created,
      entityType: 'task',
      entityId: task.id,
    },
  });

  return mapTask(task);
}

export async function updateTask(actorUserId: string, taskId: string, body: UpdateTaskBody) {
  const actor = await resolveActorContext(actorUserId);
  const existing = await prisma.task.findFirst({
    where: { id: taskId, tenantId: actor.tenantId, deletedAt: null },
    select: {
      id: true,
      createdById: true,
      assigneeId: true,
      approvalStatus: true,
      status: true,
    },
  });

  if (!existing) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  const privileged = isPrivilegedActor(actor);
  if (!privileged && !ownsTask(actor, existing)) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  if (!privileged) {
    if (body.assigneeId !== undefined && body.assigneeId !== actor.employeeId && body.assigneeId !== null) {
      throw httpError(
        403,
        'TASK_ASSIGN_FORBIDDEN',
        'You can only assign tasks to yourself with your current role.',
      );
    }
    if (body.approvalStatus !== undefined && body.approvalStatus !== existing.approvalStatus) {
      throw httpError(
        403,
        'TASK_APPROVAL_STATE_FORBIDDEN',
        'You do not have permission to change task approval status.',
      );
    }
  }

  const updateRelationInputs: { assigneeId?: string | null; youngPersonId?: string | null } = {};
  if (body.assigneeId !== undefined) updateRelationInputs.assigneeId = body.assigneeId;
  if (body.youngPersonId !== undefined) updateRelationInputs.youngPersonId = body.youngPersonId;
  await ensureTaskRelationsInTenant(actor.tenantId, updateRelationInputs);

  const updateData: Prisma.TaskUncheckedUpdateInput = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.status !== undefined) {
    updateData.status = body.status;
    updateData.completedAt = body.status === TaskStatus.completed ? new Date() : null;
  }
  if (body.approvalStatus !== undefined) {
    updateData.approvalStatus = body.approvalStatus;
    updateData.approvedAt =
      body.approvalStatus === TaskApprovalStatus.approved ||
      body.approvalStatus === TaskApprovalStatus.rejected
        ? new Date()
        : null;
  }
  if (body.priority !== undefined) updateData.priority = body.priority;
  if (body.dueDate !== undefined) updateData.dueDate = body.dueDate;
  if (body.assigneeId !== undefined) updateData.assigneeId = body.assigneeId;
  if (body.youngPersonId !== undefined) updateData.youngPersonId = body.youngPersonId;
  if (body.rejectionReason !== undefined) updateData.rejectionReason = body.rejectionReason;

  const task = await prisma.task.update({
    where: { id: taskId },
    data: updateData,
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_updated,
      entityType: 'task',
      entityId: taskId,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapTask(task);
}

export async function deleteTask(actorUserId: string, taskId: string) {
  const actor = await resolveActorContext(actorUserId);
  const existing = await prisma.task.findFirst({
    where: { id: taskId, tenantId: actor.tenantId, deletedAt: null },
    select: {
      id: true,
      createdById: true,
      assigneeId: true,
    },
  });

  if (!existing) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  if (!isPrivilegedActor(actor) && !ownsTask(actor, existing)) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  const deletedAt = new Date();
  await prisma.task.update({
    where: { id: taskId },
    data: { deletedAt },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_deleted,
      entityType: 'task',
      entityId: taskId,
      metadata: {
        softDelete: true,
        deletedAt: deletedAt.toISOString(),
      },
    },
  });

  return { message: 'Task archived.' };
}
