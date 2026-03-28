import {
  AuditAction,
  TaskReferenceEntityType,
  TaskReferenceType,
  TaskApprovalStatus,
  TaskStatus,
  TenantRole,
  UserRole,
  Prisma,
  type Task,
  type TaskReference,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { assertUploadedFilesBelongToTenant } from '../uploads/uploads.service.js';
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
  'category',
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

type TaskWithReferences = Task & { references?: TaskReference[] };

function mapTaskReference(reference: TaskReference) {
  return {
    id: reference.id,
    type: reference.type,
    entityType: reference.entityType,
    entityId: reference.entityId,
    fileId: reference.fileId,
    url: reference.url,
    label: reference.label,
    metadata: reference.metadata,
    createdAt: reference.createdAt,
    updatedAt: reference.updatedAt,
  };
}

function mapTask(task: TaskWithReferences) {
  const category = task.category ?? 'task_log';
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    approvalStatus: task.approvalStatus,
    category,
    priority: task.priority,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    rejectionReason: task.rejectionReason,
    approvedAt: task.approvedAt,
    assigneeId: task.assigneeId,
    approvedById: task.approvedById,
    homeId: task.homeId,
    vehicleId: task.vehicleId,
    youngPersonId: task.youngPersonId,
    createdById: task.createdById,
    formTemplateKey: task.formTemplateKey,
    formName: task.formName,
    formGroup: task.formGroup,
    submissionPayload: task.submissionPayload,
    signatureFileId: task.signatureFileId,
    submittedAt: task.submittedAt,
    submittedById: task.submittedById,
    updatedById: task.updatedById,
    references: (task.references ?? []).map(mapTaskReference),
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectFileIdsFromPayload(value: unknown, accumulator = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectFileIdsFromPayload(item, accumulator);
    return accumulator;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const [key, nestedValue] of Object.entries(record)) {
      if (
        (key === 'fileId' || key === 'signatureFileId') &&
        typeof nestedValue === 'string' &&
        nestedValue.trim()
      ) {
        accumulator.add(nestedValue);
        continue;
      }

      if ((key === 'fileIds' || key === 'attachmentFileIds') && Array.isArray(nestedValue)) {
        for (const fileId of nestedValue) {
          if (typeof fileId === 'string' && fileId.trim()) accumulator.add(fileId);
        }
        continue;
      }

      collectFileIdsFromPayload(nestedValue, accumulator);
    }
  }

  return accumulator;
}

type TaskReferenceInput = {
  type: TaskReferenceType;
  entityType?: TaskReferenceEntityType | undefined;
  entityId?: string | undefined;
  fileId?: string | undefined;
  url?: string | undefined;
  label?: string | undefined;
  metadata?: unknown;
};

function collectFileIdsFromReferences(
  references: TaskReferenceInput[] | null | undefined,
  accumulator = new Set<string>(),
) {
  if (!references) return accumulator;
  for (const reference of references) {
    if (reference.fileId?.trim()) {
      accumulator.add(reference.fileId);
    }
  }
  return accumulator;
}

function buildSubmissionPayload(args: {
  rawPayload: unknown;
  attachmentFileIds?: string[] | null | undefined;
  signatureFileId?: string | null | undefined;
}) {
  const hasExplicitFileRefs =
    args.attachmentFileIds !== undefined || args.signatureFileId !== undefined;

  if (!hasExplicitFileRefs) {
    return args.rawPayload ?? null;
  }

  const payloadObject = args.rawPayload == null ? {} : asRecord(args.rawPayload);
  if (!payloadObject) {
    throw httpError(
      422,
      'VALIDATION_ERROR',
      'submissionPayload must be an object when attachmentFileIds or signatureFileId is provided.',
    );
  }

  const mergedPayload: Record<string, unknown> = { ...payloadObject };

  if (args.attachmentFileIds !== undefined) {
    if (args.attachmentFileIds === null) {
      delete mergedPayload.attachmentFileIds;
    } else {
      mergedPayload.attachmentFileIds = args.attachmentFileIds;
    }
  }

  if (args.signatureFileId !== undefined) {
    if (args.signatureFileId === null) {
      delete mergedPayload.signatureFileId;
    } else {
      mergedPayload.signatureFileId = args.signatureFileId;
    }
  }

  return mergedPayload;
}

function toNullableJsonInput(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
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
    homeId?: string | null | undefined;
    vehicleId?: string | null | undefined;
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

  if (body.homeId !== undefined && body.homeId !== null) {
    const home = await prisma.home.findFirst({
      where: { id: body.homeId, tenantId },
      select: { id: true },
    });
    if (!home) {
      throw httpError(422, 'HOME_NOT_FOUND', 'Home does not exist in active tenant.');
    }
  }

  if (body.vehicleId !== undefined && body.vehicleId !== null) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: body.vehicleId, tenantId },
      select: { id: true, homeId: true },
    });
    if (!vehicle) {
      throw httpError(422, 'VEHICLE_NOT_FOUND', 'Vehicle does not exist in active tenant.');
    }

    if (body.homeId && vehicle.homeId && vehicle.homeId !== body.homeId) {
      throw httpError(
        422,
        'VEHICLE_HOME_MISMATCH',
        'Vehicle is linked to a different home in active tenant.',
      );
    }
  }
}

async function assertEntityReferencesInTenant(
  tenantId: string,
  references: TaskReferenceInput[] | null | undefined,
) {
  if (!references || references.length === 0) return;

  const grouped = new Map<TaskReferenceEntityType, Set<string>>();
  for (const reference of references) {
    if (reference.type !== TaskReferenceType.entity) continue;
    if (!reference.entityType || !reference.entityId) continue;
    const bucket = grouped.get(reference.entityType) ?? new Set<string>();
    bucket.add(reference.entityId);
    grouped.set(reference.entityType, bucket);
  }

  for (const [entityType, idsSet] of grouped.entries()) {
    const ids = [...idsSet];
    if (ids.length === 0) continue;

    if (entityType === TaskReferenceEntityType.tenant) {
      const allSameTenant = ids.every((id) => id === tenantId);
      if (!allSameTenant) {
        throw httpError(422, 'INVALID_TASK_REFERENCE', `Invalid tenant reference for entityType=${entityType}.`);
      }
      continue;
    }

    if (entityType === TaskReferenceEntityType.care_group) {
      const total = await prisma.careGroup.count({ where: { id: { in: ids }, tenantId } });
      if (total !== ids.length) {
        throw httpError(422, 'INVALID_TASK_REFERENCE', `Invalid care group reference for entityType=${entityType}.`);
      }
      continue;
    }

    if (entityType === TaskReferenceEntityType.home) {
      const total = await prisma.home.count({ where: { id: { in: ids }, tenantId } });
      if (total !== ids.length) {
        throw httpError(422, 'INVALID_TASK_REFERENCE', `Invalid home reference for entityType=${entityType}.`);
      }
      continue;
    }

    if (entityType === TaskReferenceEntityType.young_person) {
      const total = await prisma.youngPerson.count({ where: { id: { in: ids }, tenantId } });
      if (total !== ids.length) {
        throw httpError(422, 'INVALID_TASK_REFERENCE', `Invalid young person reference for entityType=${entityType}.`);
      }
      continue;
    }

    if (entityType === TaskReferenceEntityType.vehicle) {
      const total = await prisma.vehicle.count({ where: { id: { in: ids }, tenantId } });
      if (total !== ids.length) {
        throw httpError(422, 'INVALID_TASK_REFERENCE', `Invalid vehicle reference for entityType=${entityType}.`);
      }
      continue;
    }

    if (entityType === TaskReferenceEntityType.employee) {
      const total = await prisma.employee.count({ where: { id: { in: ids }, tenantId } });
      if (total !== ids.length) {
        throw httpError(422, 'INVALID_TASK_REFERENCE', `Invalid employee reference for entityType=${entityType}.`);
      }
      continue;
    }

    if (entityType === TaskReferenceEntityType.task) {
      const total = await prisma.task.count({ where: { id: { in: ids }, tenantId, deletedAt: null } });
      if (total !== ids.length) {
        throw httpError(422, 'INVALID_TASK_REFERENCE', `Invalid task reference for entityType=${entityType}.`);
      }
    }
  }
}

function toReferenceCreateData(
  tenantId: string,
  references: TaskReferenceInput[] | null | undefined,
): Prisma.TaskReferenceUncheckedCreateWithoutTaskInput[] {
  if (!references || references.length === 0) return [];
  return references.map((reference) => ({
    tenantId,
    type: reference.type,
    entityType: reference.entityType ?? null,
    entityId: reference.entityId ?? null,
    fileId: reference.fileId ?? null,
    url: reference.url ?? null,
    label: reference.label ?? null,
    metadata: (reference.metadata ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
  }));
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
  if (query.category) filters.push({ category: query.category });
  if (query.priority) filters.push({ priority: query.priority });
  if (query.assigneeId) filters.push({ assigneeId: query.assigneeId });
  if (query.homeId) filters.push({ homeId: query.homeId });
  if (query.vehicleId) filters.push({ vehicleId: query.vehicleId });
  if (query.youngPersonId) filters.push({ youngPersonId: query.youngPersonId });

  const where: Prisma.TaskWhereInput = { AND: filters };

  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: orderByFromQuery(query),
      skip,
      take: query.pageSize,
      include: {
        references: {
          orderBy: { createdAt: 'asc' },
        },
      },
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
      category: query.category ?? null,
      priority: query.priority ?? null,
      assigneeId: query.assigneeId ?? null,
      homeId: query.homeId ?? null,
      vehicleId: query.vehicleId ?? null,
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
    include: {
      references: {
        orderBy: { createdAt: 'asc' },
      },
    },
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

  const createRelationInputs: {
    assigneeId?: string;
    homeId?: string;
    vehicleId?: string;
    youngPersonId?: string;
  } = {};
  if (body.assigneeId !== undefined) createRelationInputs.assigneeId = body.assigneeId;
  if (body.homeId !== undefined) createRelationInputs.homeId = body.homeId;
  if (body.vehicleId !== undefined) createRelationInputs.vehicleId = body.vehicleId;
  if (body.youngPersonId !== undefined) createRelationInputs.youngPersonId = body.youngPersonId;
  await ensureTaskRelationsInTenant(actor.tenantId, createRelationInputs);
  await assertEntityReferencesInTenant(actor.tenantId, body.references);

  const submissionPayload = buildSubmissionPayload({
    rawPayload: body.submissionPayload,
    attachmentFileIds: body.attachmentFileIds,
    signatureFileId: body.signatureFileId,
  });

  const referencedFileIds = [
    ...collectFileIdsFromPayload(submissionPayload),
    ...collectFileIdsFromReferences(body.references),
  ];
  if (body.signatureFileId?.trim()) referencedFileIds.push(body.signatureFileId);
  await assertUploadedFilesBelongToTenant(actor.tenantId, referencedFileIds);

  const submittedById = submissionPayload ? actor.userId : null;
  const submittedAt = body.submittedAt ?? (submittedById ? new Date() : null);

  const task = await prisma.task.create({
    data: {
      tenantId: actor.tenantId,
      formTemplateKey: body.formTemplateKey ?? null,
      formName: body.formName ?? null,
      formGroup: body.formGroup ?? null,
      submissionPayload: toNullableJsonInput(submissionPayload),
      submittedAt,
      submittedById,
      updatedById: actor.userId,
      title: body.title,
      description: body.description ?? null,
      status: body.status ?? TaskStatus.pending,
      approvalStatus: body.approvalStatus ?? TaskApprovalStatus.not_required,
      category: body.category,
      priority: body.priority,
      dueDate: body.dueDate ?? null,
      assigneeId: body.assigneeId ?? null,
      homeId: body.homeId ?? null,
      vehicleId: body.vehicleId ?? null,
      youngPersonId: body.youngPersonId ?? null,
      signatureFileId: body.signatureFileId ?? null,
      createdById: actor.userId,
      completedAt: body.status === TaskStatus.completed ? new Date() : null,
      ...(body.references?.length
        ? {
            references: {
              create: toReferenceCreateData(actor.tenantId, body.references),
            },
          }
        : {}),
    },
    include: {
      references: {
        orderBy: { createdAt: 'asc' },
      },
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

  const updateRelationInputs: {
    assigneeId?: string | null;
    homeId?: string | null;
    vehicleId?: string | null;
    youngPersonId?: string | null;
  } = {};
  if (body.assigneeId !== undefined) updateRelationInputs.assigneeId = body.assigneeId;
  if (body.homeId !== undefined) updateRelationInputs.homeId = body.homeId;
  if (body.vehicleId !== undefined) updateRelationInputs.vehicleId = body.vehicleId;
  if (body.youngPersonId !== undefined) updateRelationInputs.youngPersonId = body.youngPersonId;
  await ensureTaskRelationsInTenant(actor.tenantId, updateRelationInputs);
  if (body.references !== undefined) {
    await assertEntityReferencesInTenant(actor.tenantId, body.references);
  }

  const submissionPayload = buildSubmissionPayload({
    rawPayload: body.submissionPayload,
    attachmentFileIds: body.attachmentFileIds,
    signatureFileId: body.signatureFileId,
  });

  const referencedFileIds = [
    ...collectFileIdsFromPayload(submissionPayload),
    ...collectFileIdsFromReferences(body.references),
  ];
  if (body.signatureFileId?.trim()) referencedFileIds.push(body.signatureFileId);
  await assertUploadedFilesBelongToTenant(actor.tenantId, referencedFileIds);

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
  if (body.category !== undefined) updateData.category = body.category;
  if (body.priority !== undefined) updateData.priority = body.priority;
  if (body.dueDate !== undefined) updateData.dueDate = body.dueDate;
  if (body.assigneeId !== undefined) updateData.assigneeId = body.assigneeId;
  if (body.homeId !== undefined) updateData.homeId = body.homeId;
  if (body.vehicleId !== undefined) updateData.vehicleId = body.vehicleId;
  if (body.youngPersonId !== undefined) updateData.youngPersonId = body.youngPersonId;
  if (body.rejectionReason !== undefined) updateData.rejectionReason = body.rejectionReason;
  if (body.formTemplateKey !== undefined) updateData.formTemplateKey = body.formTemplateKey;
  if (body.formName !== undefined) updateData.formName = body.formName;
  if (body.formGroup !== undefined) updateData.formGroup = body.formGroup;
  if (
    body.submissionPayload !== undefined ||
    body.attachmentFileIds !== undefined ||
    body.signatureFileId !== undefined
  ) {
    updateData.submissionPayload = toNullableJsonInput(submissionPayload);
    updateData.submittedById = submissionPayload ? actor.userId : null;
    if (body.submittedAt !== undefined) {
      updateData.submittedAt = body.submittedAt;
    } else if (submissionPayload) {
      updateData.submittedAt = new Date();
    }
  } else if (body.submittedAt !== undefined) {
    updateData.submittedAt = body.submittedAt;
  }
  if (body.signatureFileId !== undefined) updateData.signatureFileId = body.signatureFileId;
  updateData.updatedById = actor.userId;

  const task = await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: taskId },
      data: updateData,
    });

    if (body.references !== undefined) {
      await tx.taskReference.deleteMany({ where: { tenantId: actor.tenantId, taskId } });
      if (body.references && body.references.length > 0) {
        await tx.taskReference.createMany({
          data: body.references.map((reference) => ({
            tenantId: actor.tenantId,
            taskId,
            type: reference.type,
            entityType: reference.entityType ?? null,
            entityId: reference.entityId ?? null,
            fileId: reference.fileId ?? null,
            url: reference.url ?? null,
            label: reference.label ?? null,
            metadata: (reference.metadata ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
          })),
        });
      }
    }

    return tx.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        references: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
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
