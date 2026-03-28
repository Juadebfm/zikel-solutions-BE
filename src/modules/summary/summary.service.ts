import {
  AuditAction,
  TaskCategory,
  TaskReferenceEntityType,
  TenantRole,
  TaskApprovalStatus,
  TaskStatus,
  UserRole,
  type TaskPriority,
  type TaskReference,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { assertUploadedFilesBelongToTenant } from '../uploads/uploads.service.js';
import type { ApproveTaskBody, BatchApproveBody, ReviewTaskBody, SummaryListQuery } from './summary.schema.js';

type UserContext = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
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
const CATEGORY_LABELS: Record<TaskCategory, string> = {
  task_log: 'Task Log',
  document: 'Document',
  system_link: 'System Link',
  checklist: 'Checklist',
  incident: 'Incident',
  other: 'Other',
};
const SHARED_TASK_LABELS = {
  listTitle: 'Tasks',
  taskRef: 'Task Reference',
  title: 'Title',
  category: 'Category',
  workflowStatus: 'Workflow Status',
  approvalStatus: 'Approval Status',
  priority: 'Priority',
  dueAt: 'Due Date',
  assignee: 'Assignee',
  createdBy: 'Created By',
  relatedEntity: 'Related Entity',
} as const;
const ACKNOWLEDGEMENT_DETAIL_LABELS = {
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

type SharedRelatedEntityType =
  | 'young_person'
  | 'home'
  | 'vehicle'
  | 'document'
  | 'upload'
  | 'care_group'
  | 'tenant'
  | 'employee'
  | 'task'
  | 'other';

type SharedRelatedEntity = {
  type: SharedRelatedEntityType;
  id: string | null;
  name: string;
  homeId: string | null;
  careGroupId: string | null;
} | null;

function toDisplayName(firstName?: string | null, lastName?: string | null) {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim();
}

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
        firstName: true,
        lastName: true,
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
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: `${user.firstName} ${user.lastName}`.trim(),
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
  const { start } = getTodayBounds();
  const pendingRows = await prisma.task.findMany({
    where: {
      tenantId: user.tenantId,
      deletedAt: null,
      approvalStatus: TaskApprovalStatus.pending_approval,
      dueDate: { lt: start },
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

type MappedReference = {
  id: string;
  type: TaskReference['type'];
  entityType: TaskReference['entityType'];
  entityId: string | null;
  fileId: string | null;
  url: string | null;
  label: string | null;
  metadata: Prisma.JsonValue;
};

function mapReference(reference: TaskReference): MappedReference {
  return {
    id: reference.id,
    type: reference.type,
    entityType: reference.entityType,
    entityId: reference.entityId,
    fileId: reference.fileId,
    url: reference.url,
    label: reference.label,
    metadata: reference.metadata,
  };
}

function extractPayloadReferences(taskId: string, payload: Prisma.JsonValue | null): MappedReference[] {
  const payloadObj = asRecord(payload);
  const rawLinks = Array.isArray(payloadObj?.referenceLinks) ? payloadObj.referenceLinks : [];
  const references: MappedReference[] = [];
  rawLinks.forEach((raw, index) => {
    const link = asRecord(raw);
    if (!link) return;
    const typeRaw = typeof link.type === 'string' ? link.type.trim().toLowerCase() : '';
    const url = typeof link.url === 'string' ? link.url : null;
    const label = typeof link.label === 'string' ? link.label : null;
    let type: MappedReference['type'] = 'external_url';
    if (typeRaw === 'document') type = 'document_url';
    else if (typeRaw === 'task') type = 'internal_route';
    else if (typeRaw === 'upload') type = 'upload';

    references.push({
      id: typeof link.id === 'string' ? link.id : `${taskId}-payload-ref-${index + 1}`,
      type,
      entityType: null,
      entityId: null,
      fileId: typeof link.fileId === 'string' ? link.fileId : null,
      url,
      label,
      metadata: link as Prisma.JsonValue,
    });
  });
  return references;
}

function toRelatedEntityTypeFromReference(
  reference: MappedReference,
): SharedRelatedEntityType | null {
  if (reference.type === 'document_url') return 'document';
  if (reference.type === 'upload') return 'upload';
  if (reference.entityType === TaskReferenceEntityType.young_person) return 'young_person';
  if (reference.entityType === TaskReferenceEntityType.home) return 'home';
  if (reference.entityType === TaskReferenceEntityType.vehicle) return 'vehicle';
  if (reference.entityType === TaskReferenceEntityType.care_group) return 'care_group';
  if (reference.entityType === TaskReferenceEntityType.tenant) return 'tenant';
  if (reference.entityType === TaskReferenceEntityType.employee) return 'employee';
  if (reference.entityType === TaskReferenceEntityType.task) return 'task';
  return null;
}

function buildLinksFromReferences(references: MappedReference[]) {
  const taskUrlRef = references.find((reference) => reference.type === 'internal_route');
  const documentUrlRef = references.find((reference) => reference.type === 'document_url');
  const fallbackExternalDocumentRef = references.find((reference) => reference.type === 'external_url');

  return {
    taskUrl: taskUrlRef?.url ?? null,
    documentUrl: documentUrlRef?.url ?? fallbackExternalDocumentRef?.url ?? null,
  };
}

function resolveRelatedEntity(args: {
  youngPersonId: string | null;
  youngPersonName: string | null;
  youngPersonHomeId: string | null;
  homeId: string | null;
  homeName: string | null;
  homeCareGroupId: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  vehicleHomeId: string | null;
  references: MappedReference[];
}): SharedRelatedEntity {
  if (args.youngPersonId && args.youngPersonName) {
    return {
      type: 'young_person',
      id: args.youngPersonId,
      name: args.youngPersonName,
      homeId: args.youngPersonHomeId,
      careGroupId: args.homeCareGroupId,
    };
  }

  if (args.homeId && args.homeName) {
    return {
      type: 'home',
      id: args.homeId,
      name: args.homeName,
      homeId: args.homeId,
      careGroupId: args.homeCareGroupId,
    };
  }

  if (args.vehicleId && args.vehicleLabel) {
    return {
      type: 'vehicle',
      id: args.vehicleId,
      name: args.vehicleLabel,
      homeId: args.vehicleHomeId ?? args.homeId,
      careGroupId: args.homeCareGroupId,
    };
  }

  const referenceEntity = args.references.find((reference) => toRelatedEntityTypeFromReference(reference));
  if (referenceEntity) {
    return {
      type: toRelatedEntityTypeFromReference(referenceEntity) ?? 'other',
      id: referenceEntity.entityId,
      name: referenceEntity.label ?? referenceEntity.url ?? 'Reference',
      homeId: null,
      careGroupId: null,
    };
  }

  return null;
}

function mergeAcknowledgementEvidence(args: {
  submissionPayload: Prisma.JsonValue | null;
  evidence: Record<string, unknown>;
}): Prisma.InputJsonValue {
  const payloadObj = asRecord(args.submissionPayload);
  if (payloadObj) {
    const existingAck = asRecord(payloadObj.acknowledgement);
    return {
      ...payloadObj,
      acknowledgement: {
        ...(existingAck ?? {}),
        ...args.evidence,
      },
    } as Prisma.InputJsonValue;
  }

  return {
    acknowledgement: args.evidence,
    originalSubmissionPayload: args.submissionPayload,
  } as Prisma.InputJsonValue;
}

async function assertValidSignatureFile(tenantId: string, signatureFileId?: string) {
  if (!signatureFileId) return;
  await assertUploadedFilesBelongToTenant(tenantId, [signatureFileId]);
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
  category: TaskCategory;
  formName: string | null;
  formGroup: string | null;
  submissionPayload: Prisma.JsonValue | null;
  homeId: string | null;
  vehicleId: string | null;
  approvalStatus: TaskApprovalStatus;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  submittedAt: Date | null;
  submittedById: string | null;
  updatedById: string | null;
  createdById: string | null;
  youngPerson: {
    id: string;
    firstName: string;
    lastName: string;
    homeId: string;
    home: { id: string; name: string; careGroupId: string | null } | null;
  } | null;
  assignee: {
    id: string;
    user: { id: string; firstName: string; lastName: string };
    home: { id: string; name: string; careGroupId: string | null } | null;
  } | null;
  home?: { id: string; name: string; careGroupId: string | null } | null;
  vehicle?: {
    id: string;
    homeId: string | null;
    registration: string;
    make: string | null;
    model: string | null;
  } | null;
  references?: TaskReference[];
};

function toTasksToApproveItem(
  row: TaskToApproveRow,
  userNameMap: Map<string, string>,
  reviewMap: Map<string, Date>,
  currentUserDisplayName: string,
) {
  const reviewedAt = reviewMap.get(row.id) ?? null;
  const category = row.category ?? TaskCategory.task_log;
  const vehicleLabel = row.vehicle
    ? [row.vehicle.make, row.vehicle.model, row.vehicle.registration].filter(Boolean).join(' ')
    : null;
  const rowReferences = row.references ?? [];
  const references = rowReferences.length > 0
    ? rowReferences.map(mapReference)
    : extractPayloadReferences(row.id, row.submissionPayload);
  const links = buildLinksFromReferences(references);
  const relatedTo = row.youngPerson
    ? `${row.youngPerson.firstName} ${row.youngPerson.lastName}`.trim()
    : null;
  const createdByName = row.createdById ? userNameMap.get(row.createdById) ?? null : null;
  const assigneeName = row.assignee ? toDisplayName(row.assignee.user.firstName, row.assignee.user.lastName) : null;
  const relatedEntity = resolveRelatedEntity({
    youngPersonId: row.youngPerson?.id ?? null,
    youngPersonName: relatedTo,
    youngPersonHomeId: row.youngPerson?.homeId ?? null,
    homeId: row.homeId,
    homeName: row.home?.name ?? null,
    homeCareGroupId: row.home?.careGroupId ?? row.youngPerson?.home?.careGroupId ?? row.assignee?.home?.careGroupId ?? null,
    vehicleId: row.vehicleId,
    vehicleLabel,
    vehicleHomeId: row.vehicle?.homeId ?? null,
    references,
  });

  return {
    id: row.id,
    taskRef: toTaskRef(row),
    title: row.title,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    status: row.status,
    priority: row.priority,
    approvalStatus: row.approvalStatus,
    dueAt: row.dueDate,
    assignee: row.assignee && assigneeName ? { id: row.assignee.id, name: assigneeName } : null,
    createdBy: row.createdById && createdByName ? { id: row.createdById, name: createdByName } : null,
    relatedEntity,
    links,
    review: {
      reviewedByCurrentUser: reviewedAt !== null,
      reviewedAt,
      reviewedByCurrentUserName: reviewedAt ? currentUserDisplayName : null,
    },
    timestamps: {
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    references,
  };
}

function toTodoItem(
  task: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    createdById: string | null;
    title: string;
    category: TaskCategory;
    status: TaskStatus;
    approvalStatus: TaskApprovalStatus;
    priority: string;
    dueDate: Date | null;
    submissionPayload: Prisma.JsonValue | null;
    homeId: string | null;
    vehicleId: string | null;
    home?: { id: string; name: string; careGroupId: string | null } | null;
    vehicle?: {
      id: string;
      homeId: string | null;
      registration: string;
      make: string | null;
      model: string | null;
    } | null;
    youngPerson: { id: string; homeId: string; firstName: string; lastName: string } | null;
    assignee: { id: string; user: { id: string; firstName: string; lastName: string } } | null;
    references?: TaskReference[];
  },
  userNameMap: Map<string, string>,
) {
  const vehicleLabel = task.vehicle
    ? [task.vehicle.make, task.vehicle.model, task.vehicle.registration].filter(Boolean).join(' ')
    : null;
  const taskReferences = task.references ?? [];
  const references = taskReferences.length > 0
    ? taskReferences.map(mapReference)
    : extractPayloadReferences(task.id, task.submissionPayload);
  const category = task.category ?? TaskCategory.task_log;
  const relation = task.youngPerson
    ? `${task.youngPerson.firstName} ${task.youngPerson.lastName}`
    : null;
  const links = buildLinksFromReferences(references);
  const assigneeName = task.assignee ? toDisplayName(task.assignee.user.firstName, task.assignee.user.lastName) : null;
  const createdByName = task.createdById ? userNameMap.get(task.createdById) ?? null : null;
  const relatedEntity = resolveRelatedEntity({
    youngPersonId: task.youngPerson?.id ?? null,
    youngPersonName: relation,
    youngPersonHomeId: task.youngPerson?.homeId ?? null,
    homeId: task.homeId,
    homeName: task.home?.name ?? null,
    homeCareGroupId: task.home?.careGroupId ?? null,
    vehicleId: task.vehicleId,
    vehicleLabel,
    vehicleHomeId: task.vehicle?.homeId ?? null,
    references,
  });

  return {
    id: task.id,
    taskRef: toTaskRef(task),
    title: task.title,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    dueAt: task.dueDate,
    assignee: task.assignee && assigneeName ? { id: task.assignee.id, name: assigneeName } : null,
    createdBy: task.createdById && createdByName ? { id: task.createdById, name: createdByName } : null,
    relatedEntity,
    links,
    review: {
      reviewedByCurrentUser: false,
      reviewedAt: null,
      reviewedByCurrentUserName: null,
    },
    timestamps: {
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
    status: task.status,
    approvalStatus: task.approvalStatus,
    priority: task.priority,
    references,
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
        home: {
          select: { id: true, name: true, careGroupId: true },
        },
        vehicle: {
          select: { id: true, homeId: true, registration: true, make: true, model: true },
        },
        youngPerson: {
          select: { id: true, homeId: true, firstName: true, lastName: true },
        },
        assignee: {
          select: {
            id: true,
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        references: {
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
  ]);
  const userIds = [
    ...new Set(rows.flatMap((row) => [row.createdById]).filter((id): id is string => Boolean(id))),
  ];
  const userNameMap = await getUserNameMap(userIds);

  return {
    data: rows.map((row) => toTodoItem(row, userNameMap)),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
    labels: SHARED_TASK_LABELS,
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
        home: {
          select: { id: true, name: true, careGroupId: true },
        },
        vehicle: {
          select: { id: true, homeId: true, registration: true, make: true, model: true },
        },
        youngPerson: {
          select: { id: true, homeId: true, firstName: true, lastName: true },
        },
        assignee: {
          select: {
            id: true,
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
        references: {
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
  ]);
  const userIds = [
    ...new Set(rows.flatMap((row) => [row.createdById]).filter((id): id is string => Boolean(id))),
  ];
  const userNameMap = await getUserNameMap(userIds);

  return {
    data: rows.map((row) => toTodoItem(row, userNameMap)),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
    labels: SHARED_TASK_LABELS,
  };
}

export async function listTasksToApprove(userId: string, query: SummaryListQuery) {
  const user = await getUserContext(userId);
  if (!canApprove(user)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  const { start } = getTodayBounds();
  const skip = (query.page - 1) * query.pageSize;
  const filters: Prisma.TaskWhereInput[] = [
    { tenantId: user.tenantId, deletedAt: null, approvalStatus: TaskApprovalStatus.pending_approval },
  ];

  // Default gate feed: only actionable blocking items (unreviewed and overdue).
  if (query.scope === 'gate') {
    filters.push(
      { dueDate: { lt: start } },
      { reviewEvents: { none: { userId: user.id } } },
    );
  } else if (query.scope === 'popup') {
    filters.push(
      {
        OR: [
          { dueDate: { gte: start } },
          { dueDate: null },
        ],
      },
      { reviewEvents: { none: { userId: user.id } } },
    );
  }

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
        home: {
          select: { id: true, name: true, careGroupId: true },
        },
        vehicle: {
          select: { id: true, homeId: true, registration: true, make: true, model: true },
        },
        youngPerson: {
          select: {
            id: true,
            homeId: true,
            firstName: true,
            lastName: true,
            home: { select: { id: true, name: true, careGroupId: true } },
          },
        },
        assignee: {
          select: {
            id: true,
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
            home: { select: { id: true, name: true, careGroupId: true } },
          },
        },
        references: {
          orderBy: { createdAt: 'asc' },
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
    data: rows.map((row) => toTasksToApproveItem(
      row as TaskToApproveRow,
      userNameMap,
      reviewMap,
      user.displayName,
    )),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
    labels: SHARED_TASK_LABELS,
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
      home: {
        select: { name: true },
      },
      vehicle: {
        select: { registration: true, make: true, model: true },
      },
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
      references: {
        orderBy: { createdAt: 'asc' },
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
  const homeOrSchool = row.home?.name ?? row.youngPerson?.home?.name ?? row.assignee?.home?.name ?? null;
  const vehicleLabel = row.vehicle
    ? [row.vehicle.make, row.vehicle.model, row.vehicle.registration].filter(Boolean).join(' ')
    : null;
  const reviewedAt = reviewRow?.reviewedAt ?? null;
  const category = row.category ?? TaskCategory.task_log;
  const rowReferences = row.references ?? [];
  const references = rowReferences.length > 0
    ? rowReferences.map(mapReference)
    : extractPayloadReferences(row.id, row.submissionPayload);

  return {
    id: row.id,
    taskRef: toTaskRef(row),
    title: row.title,
    formName: row.formName ?? null,
    formGroup: row.formGroup ?? row.formName ?? null,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    status: row.status,
    priority: row.priority,
    approvalStatus: row.approvalStatus,
    approvalStatusLabel: APPROVAL_STATUS_LABELS[row.approvalStatus],
    meta: {
      taskId: row.id,
      taskRef: toTaskRef(row),
      homeId: row.homeId,
      homeOrSchool,
      vehicleId: row.vehicleId,
      vehicleLabel,
      relatedTo,
      taskDate: row.dueDate,
      submittedOn: row.submittedAt ?? row.createdAt,
      submittedBy,
      updatedOn: row.updatedAt,
      updatedBy,
      approvers,
    },
    references,
    labels: ACKNOWLEDGEMENT_DETAIL_LABELS,
    // Keep per-form field labels/value structure as submitted (dynamic, no hardcoded rewrite).
    renderPayload: row.submissionPayload ?? { sections: [] },
    reviewedByCurrentUser: reviewedAt !== null,
    reviewedAt,
    reviewedByCurrentUserName: reviewedAt ? user.displayName : null,
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
    reviewedByCurrentUserName: user.displayName,
    action: review.action,
  };
}

export async function approveTask(userId: string, taskId: string, body: ApproveTaskBody) {
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

  await assertValidSignatureFile(user.tenantId, body.signatureFileId);
  await ensureActorReviewedAllPendingApprovals(user);
  const approvedAt = new Date();

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      approvalStatus: TaskApprovalStatus.approved,
      approvedAt,
      approvedById: user.employee?.id ?? null,
      signatureFileId: body.signatureFileId ?? null,
      rejectionReason: null,
      submissionPayload: mergeAcknowledgementEvidence({
        submissionPayload: existing.submissionPayload,
        evidence: {
          action: 'approve',
          mode: 'single',
          approvedAt: approvedAt.toISOString(),
          approvedByUserId: user.id,
          signatureFileId: body.signatureFileId ?? null,
          comment: body.comment ?? null,
        },
      }),
    },
    include: {
      references: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.record_updated,
      entityType: 'task_approval',
      entityId: taskId,
      metadata: {
        action: 'approve',
        comment: body.comment ?? null,
        signatureFileId: body.signatureFileId ?? null,
      },
    },
  });

  return updated;
}

export async function processTaskBatch(userId: string, body: BatchApproveBody) {
  const user = await getUserContext(userId);
  if (!canApprove(user)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
  }

  if (body.action === 'reject' && body.signatureFileId) {
    throw httpError(
      422,
      'VALIDATION_ERROR',
      'signatureFileId is only supported when action is approve.',
    );
  }

  await assertValidSignatureFile(user.tenantId, body.signatureFileId);

  if (body.action === 'approve') {
    await ensureActorReviewedAllPendingApprovals(user);
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: body.taskIds }, tenantId: user.tenantId, deletedAt: null },
    select: { id: true, approvalStatus: true, submissionPayload: true },
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
            ? (() => {
                const approvedAt = new Date();
                return {
                  approvalStatus: TaskApprovalStatus.approved,
                  approvedAt,
                  approvedById: user.employee?.id ?? null,
                  signatureFileId: body.signatureFileId ?? null,
                  rejectionReason: null,
                  submissionPayload: mergeAcknowledgementEvidence({
                    submissionPayload: task.submissionPayload,
                    evidence: {
                      action: 'approve',
                      mode: 'batch',
                      approvedAt: approvedAt.toISOString(),
                      approvedByUserId: user.id,
                      signatureFileId: body.signatureFileId ?? null,
                      comment: null,
                    },
                  }),
                };
              })()
            : {
                approvalStatus: TaskApprovalStatus.rejected,
                approvedAt: new Date(),
                approvedById: user.employee?.id ?? null,
                signatureFileId: null,
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
          signatureFileId: body.signatureFileId ?? null,
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
