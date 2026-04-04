import {
  AuditAction,
  TaskCategory,
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
import { emitNotification } from '../../lib/notification-emitter.js';
import { triggerRiskEvaluationForTaskMutation } from '../safeguarding/risk-alerts.service.js';
import type {
  BatchArchiveBody,
  BatchPostponeBody,
  BatchReassignBody,
  CreateTaskBody,
  ListTasksQuery,
  PostponeTaskBody,
  TaskActionBody,
  UpdateTaskBody,
} from './tasks.schema.js';

type TaskActorContext = {
  userId: string;
  displayName: string;
  userRole: UserRole;
  tenantId: string;
  tenantRole: TenantRole | null;
  employeeId: string | null;
};

const SORTABLE_FIELDS = new Set([
  'taskRef',
  'title',
  'status',
  'approvalStatus',
  'category',
  'type',
  'priority',
  'submittedAt',
  'dueAt',
  'dueDate',
  'createdAt',
  'updatedAt',
]);

const WORKFLOW_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const APPROVAL_STATUS_LABELS: Record<TaskApprovalStatus, string> = {
  not_required: 'Not Required',
  pending_approval: 'Awaiting Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  processing: 'Processing',
};
const SUMMARY_ACTIVE_WORKFLOW_STATUSES: TaskStatus[] = [TaskStatus.pending, TaskStatus.in_progress];
const SUMMARY_EXCLUDED_APPROVAL_BUCKET_STATUSES: TaskApprovalStatus[] = [
  TaskApprovalStatus.pending_approval,
  TaskApprovalStatus.rejected,
];

const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  task_log: 'Task Log',
  document: 'Document',
  system_link: 'System Link',
  checklist: 'Checklist',
  incident: 'Incident',
  other: 'General',
  daily_log: 'Daily Log',
  reward: 'Reward',
};

const EXPLORER_CATEGORY_MAP: Record<
  string,
  { value: string; label: string; taskCategory: TaskCategory; types: string[] | null }
> = {
  reg44: { value: 'reg44', label: 'Reg 44 Visit', taskCategory: TaskCategory.document, types: ['home'] },
  inspection: {
    value: 'inspection',
    label: 'Inspection',
    taskCategory: TaskCategory.checklist,
    types: ['home', 'vehicle'],
  },
  maintenance: {
    value: 'maintenance',
    label: 'Maintenance',
    taskCategory: TaskCategory.checklist,
    types: ['home', 'vehicle'],
  },
  checkup: {
    value: 'checkup',
    label: 'Checkup',
    taskCategory: TaskCategory.task_log,
    types: ['young_person', 'employee'],
  },
  meeting: { value: 'meeting', label: 'Meeting', taskCategory: TaskCategory.task_log, types: null },
  documentation: {
    value: 'documentation',
    label: 'Documentation',
    taskCategory: TaskCategory.document,
    types: null,
  },
  incident: {
    value: 'incident',
    label: 'Incident Report',
    taskCategory: TaskCategory.incident,
    types: ['home', 'young_person'],
  },
  report: { value: 'report', label: 'Report', taskCategory: TaskCategory.document, types: null },
  compliance: {
    value: 'compliance',
    label: 'Compliance',
    taskCategory: TaskCategory.document,
    types: ['home'],
  },
  reward: {
    value: 'reward',
    label: 'Reward',
    taskCategory: TaskCategory.reward,
    types: ['young_person', 'home'],
  },
  general: { value: 'general', label: 'General Task', taskCategory: TaskCategory.other, types: null },
  daily_log: { value: 'daily_log', label: 'Daily Log', taskCategory: TaskCategory.daily_log, types: ['home', 'young_person', 'vehicle'] },
};

const EXPLORER_STATUS_VALUES = new Set([
  'draft',
  'submitted',
  'sent_for_approval',
  'approved',
  'rejected',
  'sent_for_deletion',
  'deleted',
  'deleted_draft',
  'hidden',
]);

const EXPLORER_APPROVAL_STATUS_VALUES = new Set([
  'not_required',
  'pending_approval',
  'approved',
  'rejected',
  'processing',
]);

const EXPLORER_TYPE_VALUES = new Set([
  'home',
  'young_person',
  'vehicle',
  'employee',
  'document',
  'event',
  'upload',
  'care_group',
  'tenant',
  'task',
  'other',
]);

const TASK_CATEGORY_VALUES = new Set<TaskCategory>([
  TaskCategory.task_log,
  TaskCategory.document,
  TaskCategory.system_link,
  TaskCategory.checklist,
  TaskCategory.incident,
  TaskCategory.other,
  TaskCategory.daily_log,
  TaskCategory.reward,
]);

const EXPLORER_CATEGORY_VALUES = new Set([
  ...Object.keys(EXPLORER_CATEGORY_MAP),
  ...TASK_CATEGORY_VALUES,
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

function buildSummaryPersonalTaskScope(actor: TaskActorContext): Prisma.TaskWhereInput {
  if (actor.employeeId) {
    return {
      AND: [
        { tenantId: actor.tenantId, deletedAt: null },
        { OR: [{ assigneeId: actor.employeeId }, { createdById: actor.userId }] },
      ],
    };
  }

  return {
    tenantId: actor.tenantId,
    createdById: actor.userId,
    deletedAt: null,
  };
}

function buildSummaryScopeTaskFilter(
  actor: TaskActorContext,
  summaryScope: NonNullable<ListTasksQuery['summaryScope']>,
): Prisma.TaskWhereInput {
  const { start, end } = getTodayBounds();
  const personalScope = buildSummaryPersonalTaskScope(actor);
  const withPersonal = (extra: Prisma.TaskWhereInput): Prisma.TaskWhereInput => ({
    AND: [personalScope, extra],
  });
  const normalWorkflowApprovalScope: Prisma.TaskWhereInput = {
    approvalStatus: { notIn: SUMMARY_EXCLUDED_APPROVAL_BUCKET_STATUSES },
  };

  switch (summaryScope) {
    case 'overdue':
      return withPersonal({
        ...normalWorkflowApprovalScope,
        status: { in: SUMMARY_ACTIVE_WORKFLOW_STATUSES },
        dueDate: { lt: start },
      });
    case 'due_today':
      return withPersonal({
        ...normalWorkflowApprovalScope,
        status: { in: SUMMARY_ACTIVE_WORKFLOW_STATUSES },
        dueDate: { gte: start, lte: end },
      });
    case 'pending_approval':
      return isPrivilegedActor(actor)
        ? {
            tenantId: actor.tenantId,
            deletedAt: null,
            approvalStatus: TaskApprovalStatus.pending_approval,
          }
        : withPersonal({ approvalStatus: TaskApprovalStatus.pending_approval });
    case 'rejected':
      return withPersonal({ approvalStatus: TaskApprovalStatus.rejected });
    case 'draft':
      return withPersonal({
        ...normalWorkflowApprovalScope,
        status: TaskStatus.pending,
        dueDate: null,
      });
    case 'future':
      return withPersonal({
        ...normalWorkflowApprovalScope,
        status: { in: SUMMARY_ACTIVE_WORKFLOW_STATUSES },
        dueDate: { gt: end },
      });
    case 'rewards': {
      const rewardsScope: Prisma.TaskWhereInput = isPrivilegedActor(actor)
        ? { tenantId: actor.tenantId, deletedAt: null }
        : personalScope;
      return {
        AND: [
          rewardsScope,
          {
            deletedAt: null,
            category: TaskCategory.reward,
            submittedAt: { not: null },
            approvalStatus: TaskApprovalStatus.not_required,
          },
        ],
      };
    }
    case 'comments':
      throw httpError(
        422,
        'UNSUPPORTED_SUMMARY_SCOPE',
        'summaryScope=comments is not task-backed. Use announcements endpoint for unread comments.',
      );
    default:
      return { tenantId: actor.tenantId, deletedAt: null };
  }
}

type TaskWithReferences = Task & { references?: TaskReference[] };

type TaskWithExplorerRelations = Task & {
  references?: TaskReference[];
  home?: { id: string; name: string; careGroupId: string | null } | null;
  vehicle?: { id: string; registration: string; make: string | null; model: string | null; homeId: string | null } | null;
  youngPerson?: { id: string; firstName: string; lastName: string; homeId: string } | null;
  assignee?: {
    id: string;
    user: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null;
  } | null;
};

type UserIdentity = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

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

function toTaskRef(task: { id: string; createdAt: Date }) {
  const year = task.createdAt.getUTCFullYear();
  const month = String(task.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(task.createdAt.getUTCDate()).padStart(2, '0');
  const alphanumericId = task.id.replace(/[^a-zA-Z0-9]/g, '');
  const suffix = alphanumericId.slice(-6).toUpperCase().padStart(6, '0');
  return `TSK-${year}${month}${day}-${suffix}`;
}

function toDisplayName(firstName?: string | null, lastName?: string | null) {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim();
}

function normalizeFilterToken(raw: string) {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function parseDelimitedValues(
  raw: string | undefined,
  valid: Set<string>,
  aliases: Record<string, string> = {},
) {
  if (!raw) return { values: [] as string[], invalid: [] as string[] };

  const values: string[] = [];
  const invalid: string[] = [];

  for (const item of raw.split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;

    const normalized = normalizeFilterToken(trimmed);
    const resolved = aliases[normalized] ?? normalized;

    if (!valid.has(resolved)) {
      if (!invalid.includes(trimmed)) invalid.push(trimmed);
      continue;
    }

    if (!values.includes(resolved)) values.push(resolved);
  }

  return { values, invalid };
}

function normalizeTaskCategoryInput(raw: CreateTaskBody['category'] | UpdateTaskBody['category']) {
  if (!raw) return undefined;
  if (raw in EXPLORER_CATEGORY_MAP) {
    return EXPLORER_CATEGORY_MAP[raw as keyof typeof EXPLORER_CATEGORY_MAP].taskCategory;
  }
  return raw as TaskCategory;
}

function getTodayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function periodToRange(period: ListTasksQuery['period']) {
  const now = new Date();
  const { start, end } = getTodayBounds();

  switch (period) {
    case 'today':
      return { from: start, to: end };
    case 'yesterday': {
      const from = new Date(start);
      from.setDate(from.getDate() - 1);
      const to = new Date(end);
      to.setDate(to.getDate() - 1);
      return { from, to };
    }
    case 'last_7_days': {
      const from = new Date(start);
      from.setDate(from.getDate() - 6);
      return { from, to: end };
    }
    case 'this_week': {
      const from = new Date(start);
      const day = from.getDay() || 7;
      from.setDate(from.getDate() - (day - 1));
      const to = new Date(from);
      to.setDate(to.getDate() + 6);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
    case 'this_month': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      return { from, to };
    }
    case 'last_month': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      return { from, to };
    }
    case 'this_year': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      const to = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
      return { from, to };
    }
    case 'future':
      return { from: now, to: null };
    case 'all':
    default:
      return { from: null, to: null };
  }
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
    const normalizedSortBy = query.sortBy === 'dueAt'
      ? 'dueDate'
      : query.sortBy === 'submittedAt'
        ? 'submittedAt'
        : query.sortBy === 'taskRef'
          ? 'createdAt'
          : query.sortBy === 'type'
            ? 'category'
            : query.sortBy;
    return [{ [normalizedSortBy]: query.sortOrder }] as Prisma.TaskOrderByWithRelationInput[];
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

function toRelatedTypeFromReference(reference: MappedReference): string | null {
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

function buildLinksFromReferences(taskId: string, references: MappedReference[]) {
  const taskUrlRef = references.find((reference) => reference.type === 'internal_route');
  const documentUrlRef = references.find((reference) => reference.type === 'document_url');
  const fallbackExternal = references.find((reference) => reference.type === 'external_url');

  return {
    taskUrl: taskUrlRef?.url ?? `/tasks/${taskId}`,
    documentUrl: documentUrlRef?.url ?? fallbackExternal?.url ?? null,
  };
}

function buildReferenceSummary(references: MappedReference[]) {
  const documents = references.filter((reference) => reference.type === 'document_url').length;
  const uploads = references.filter((reference) => reference.type === 'upload').length;
  const links = references.filter((reference) => ['internal_route', 'external_url'].includes(reference.type)).length;
  const entities = references.filter((reference) => reference.type === 'entity').length;
  return {
    documents,
    uploads,
    links,
    entities,
    total: references.length,
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
}) {
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

  const fromReference = args.references.find((reference) => toRelatedTypeFromReference(reference));
  if (fromReference) {
    return {
      type: toRelatedTypeFromReference(fromReference) ?? 'other',
      id: fromReference.entityId,
      name: fromReference.label ?? fromReference.url ?? 'Reference',
      homeId: null,
      careGroupId: null,
    };
  }

  return null;
}

function extractApproverIds(payload: Prisma.JsonValue | null) {
  const payloadObj = asRecord(payload);
  const direct = Array.isArray(payloadObj?.approverIds) ? payloadObj.approverIds : [];
  return direct.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function extractApproverNames(payload: Prisma.JsonValue | null) {
  const payloadObj = asRecord(payload);
  const direct = Array.isArray(payloadObj?.approverNames) ? payloadObj.approverNames : [];
  return direct.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function extractRequestId(payload: Prisma.JsonValue | null) {
  const payloadObj = asRecord(payload);
  if (!payloadObj) return null;
  if (typeof payloadObj.requestId === 'string' || typeof payloadObj.requestId === 'number') {
    return String(payloadObj.requestId);
  }
  const requestObj = asRecord(payloadObj.request);
  if (!requestObj) return null;
  if (typeof requestObj.id === 'string' || typeof requestObj.id === 'number') {
    return String(requestObj.id);
  }
  return null;
}

function extractPreviewFields(payload: Prisma.JsonValue | null) {
  const payloadObj = asRecord(payload);
  if (!payloadObj || !Array.isArray(payloadObj.previewFields)) return [];
  return payloadObj.previewFields
    .map((entry) => {
      const row = asRecord(entry);
      if (!row) return null;
      const label = typeof row.label === 'string' ? row.label.trim() : '';
      const value = typeof row.value === 'string' || typeof row.value === 'number' ? String(row.value).trim() : '';
      if (!label || !value) return null;
      return { label, value };
    })
    .filter((entry): entry is { label: string; value: string } => entry !== null)
    .slice(0, 6);
}

function toExplorerCategory(task: Pick<Task, 'category'>) {
  switch (task.category) {
    case TaskCategory.checklist:
      return EXPLORER_CATEGORY_MAP.inspection;
    case TaskCategory.document:
      return EXPLORER_CATEGORY_MAP.documentation;
    case TaskCategory.incident:
      return EXPLORER_CATEGORY_MAP.incident;
    case TaskCategory.system_link:
      return EXPLORER_CATEGORY_MAP.report;
    case TaskCategory.task_log:
      return EXPLORER_CATEGORY_MAP.general;
    case TaskCategory.daily_log:
      return EXPLORER_CATEGORY_MAP.daily_log;
    case TaskCategory.reward:
      return EXPLORER_CATEGORY_MAP.reward;
    case TaskCategory.other:
    default:
      return EXPLORER_CATEGORY_MAP.general;
  }
}

function toTypeLabel(type: string) {
  const labelByType: Record<string, string> = {
    home: 'Home',
    young_person: 'Young Person',
    vehicle: 'Vehicle',
    employee: 'Employee',
    document: 'Document',
    event: 'Event',
    upload: 'Upload',
    care_group: 'Care Group',
    tenant: 'Tenant',
    task: 'Task',
    other: 'Other',
  };
  return labelByType[type] ?? 'Other';
}

function toLifecycleStatus(task: Pick<Task, 'status' | 'approvalStatus' | 'submittedAt' | 'deletedAt'>) {
  if (task.deletedAt) {
    return task.submittedAt ? 'deleted' : 'deleted_draft';
  }
  if (task.status === TaskStatus.cancelled && task.approvalStatus === TaskApprovalStatus.processing) {
    return 'sent_for_deletion';
  }
  if (task.status === TaskStatus.cancelled) return 'hidden';
  if (task.approvalStatus === TaskApprovalStatus.pending_approval) return 'sent_for_approval';
  if (task.approvalStatus === TaskApprovalStatus.approved) return 'approved';
  if (task.approvalStatus === TaskApprovalStatus.rejected) return 'rejected';
  if (task.submittedAt) return 'submitted';
  return 'draft';
}

function toLifecycleStatusLabel(status: ReturnType<typeof toLifecycleStatus>) {
  const labels: Record<ReturnType<typeof toLifecycleStatus>, string> = {
    draft: 'Draft',
    submitted: 'Submitted',
    sent_for_approval: 'Sent for Approval',
    approved: 'Approved',
    rejected: 'Rejected',
    sent_for_deletion: 'Sent for Deletion',
    deleted: 'Deleted',
    deleted_draft: 'Deleted Draft',
    hidden: 'Hidden',
  };
  return labels[status];
}

function lifecycleWhereClause(status: string): Prisma.TaskWhereInput {
  switch (status) {
    case 'draft':
      return { deletedAt: null, submittedAt: null, approvalStatus: { in: [TaskApprovalStatus.not_required, TaskApprovalStatus.processing] } };
    case 'submitted':
      return { deletedAt: null, submittedAt: { not: null }, approvalStatus: TaskApprovalStatus.not_required };
    case 'sent_for_approval':
      return { deletedAt: null, approvalStatus: TaskApprovalStatus.pending_approval };
    case 'approved':
      return { deletedAt: null, approvalStatus: TaskApprovalStatus.approved };
    case 'rejected':
      return { deletedAt: null, approvalStatus: TaskApprovalStatus.rejected };
    case 'sent_for_deletion':
      return { deletedAt: null, status: TaskStatus.cancelled, approvalStatus: TaskApprovalStatus.processing };
    case 'deleted':
      return { deletedAt: { not: null }, submittedAt: { not: null } };
    case 'deleted_draft':
      return { deletedAt: { not: null }, submittedAt: null };
    case 'hidden':
      return { deletedAt: null, status: TaskStatus.cancelled };
    default:
      return { deletedAt: null };
  }
}

async function getUserIdentityMap(userIds: string[]) {
  const deduped = [...new Set(userIds.filter(Boolean))];
  if (deduped.length === 0) return new Map<string, UserIdentity>();

  // Some isolated tests mock a minimal prisma client and do not define user.findMany.
  // Runtime Prisma always provides it, so in tests we safely fall back to an empty map.
  if (typeof (prisma.user as { findMany?: unknown } | undefined)?.findMany !== 'function') {
    return new Map<string, UserIdentity>();
  }

  const users = await prisma.user.findMany({
    where: { id: { in: deduped } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
    },
  });

  return new Map(users.map((user) => [
    user.id,
    {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      avatarUrl: user.avatarUrl ?? null,
    },
  ]));
}

function mergeApprovers(args: {
  approverIds: string[];
  approverNames: string[];
  userIdentityMap: Map<string, UserIdentity>;
}) {
  const byId = args.approverIds
    .map((id) => args.userIdentityMap.get(id))
    .filter((identity): identity is UserIdentity => Boolean(identity));

  if (byId.length > 0) return byId;

  return args.approverNames.map((name, index) => ({
    id: `approver-name-${index + 1}`,
    name,
    avatarUrl: null,
  }));
}

function toTaskExplorerItem(
  task: TaskWithExplorerRelations,
  userIdentityMap: Map<string, UserIdentity>,
) {
  const references = (task.references ?? []).length > 0
    ? (task.references ?? []).map(mapReference)
    : extractPayloadReferences(task.id, task.submissionPayload);
  const vehicleLabel = task.vehicle
    ? [task.vehicle.make, task.vehicle.model, task.vehicle.registration].filter(Boolean).join(' ')
    : null;
  const relatedEntity = resolveRelatedEntity({
    youngPersonId: task.youngPerson?.id ?? task.youngPersonId,
    youngPersonName: task.youngPerson ? toDisplayName(task.youngPerson.firstName, task.youngPerson.lastName) : null,
    youngPersonHomeId: task.youngPerson?.homeId ?? null,
    homeId: task.homeId,
    homeName: task.home?.name ?? null,
    homeCareGroupId: task.home?.careGroupId ?? null,
    vehicleId: task.vehicleId,
    vehicleLabel,
    vehicleHomeId: task.vehicle?.homeId ?? null,
    references,
  });
  const resolvedType = relatedEntity?.type ?? 'other';
  const explorerCategory = toExplorerCategory(task);
  const lifecycleStatus = toLifecycleStatus(task);
  const requestId = extractRequestId(task.submissionPayload);
  const previewFields = extractPreviewFields(task.submissionPayload);
  const approverIds = extractApproverIds(task.submissionPayload);
  const approverNames = extractApproverNames(task.submissionPayload);
  const approvers = mergeApprovers({ approverIds, approverNames, userIdentityMap });
  const assigneeName = task.assignee?.user
    ? toDisplayName(task.assignee.user.firstName, task.assignee.user.lastName)
    : null;
  const createdBy = task.createdById ? userIdentityMap.get(task.createdById) ?? null : null;

  return {
    id: task.id,
    taskRef: toTaskRef(task),
    requestId,
    title: task.title,
    description: task.description,
    category: explorerCategory.value,
    categoryLabel: explorerCategory.label,
    taskCategory: task.category,
    taskCategoryLabel: TASK_CATEGORY_LABELS[task.category],
    type: resolvedType,
    typeLabel: toTypeLabel(resolvedType),
    status: lifecycleStatus,
    statusLabel: toLifecycleStatusLabel(lifecycleStatus),
    workflowStatus: task.status,
    workflowStatusLabel: WORKFLOW_STATUS_LABELS[task.status],
    approvalStatus: task.approvalStatus,
    approvalStatusLabel: APPROVAL_STATUS_LABELS[task.approvalStatus],
    priority: task.priority,
    dueAt: task.dueDate,
    submittedAt: task.submittedAt,
    formGroup: task.formGroup,
    formTemplateKey: task.formTemplateKey,
    formName: task.formName,
    relatedEntity,
    assignee: task.assignee && assigneeName
      ? { id: task.assignee.id, name: assigneeName, avatarUrl: task.assignee.user?.avatarUrl ?? null }
      : null,
    createdBy,
    approvers,
    links: buildLinksFromReferences(task.id, references),
    referenceSummary: buildReferenceSummary(references),
    previewFields,
    references,
    timestamps: {
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
  };
}

async function resolveActorContext(actorUserId: string): Promise<TaskActorContext> {
  const tenant = await requireTenantContext(actorUserId);
  const [user, employee] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, role: true, firstName: true, lastName: true },
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
    displayName: toDisplayName(user.firstName, user.lastName),
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
  // Run all existence checks in parallel instead of sequentially.
  const [employee, youngPerson, home, vehicle] = await Promise.all([
    body.assigneeId != null
      ? prisma.employee.findFirst({
          where: { id: body.assigneeId, tenantId, isActive: true },
          select: { id: true },
        })
      : null,
    body.youngPersonId != null
      ? prisma.youngPerson.findFirst({
          where: { id: body.youngPersonId, tenantId },
          select: { id: true },
        })
      : null,
    body.homeId != null
      ? prisma.home.findFirst({
          where: { id: body.homeId, tenantId },
          select: { id: true },
        })
      : null,
    body.vehicleId != null
      ? prisma.vehicle.findFirst({
          where: { id: body.vehicleId, tenantId },
          select: { id: true, homeId: true },
        })
      : null,
  ]);

  if (body.assigneeId != null && !employee) {
    throw httpError(422, 'ASSIGNEE_NOT_FOUND', 'Assignee does not exist in active tenant.');
  }
  if (body.youngPersonId != null && !youngPerson) {
    throw httpError(422, 'YOUNG_PERSON_NOT_FOUND', 'Young person does not exist in active tenant.');
  }
  if (body.homeId != null && !home) {
    throw httpError(422, 'HOME_NOT_FOUND', 'Home does not exist in active tenant.');
  }
  if (body.vehicleId != null && !vehicle) {
    throw httpError(422, 'VEHICLE_NOT_FOUND', 'Vehicle does not exist in active tenant.');
  }

  if (vehicle && body.homeId && vehicle.homeId && vehicle.homeId !== body.homeId) {
    throw httpError(
      422,
      'VEHICLE_HOME_MISMATCH',
      'Vehicle is linked to a different home in active tenant.',
    );
  }
}

function resolveEntityLinksFromInput(args: {
  relatedEntityId?: string | null | undefined;
  type?: string | null | undefined;
  homeId?: string | null | undefined;
  vehicleId?: string | null | undefined;
  youngPersonId?: string | null | undefined;
}) {
  const next = {
    homeId: args.homeId ?? undefined,
    vehicleId: args.vehicleId ?? undefined,
    youngPersonId: args.youngPersonId ?? undefined,
  };
  if (!args.relatedEntityId || !args.type) return next;

  if (args.type === 'home' && !next.homeId) next.homeId = args.relatedEntityId;
  if (args.type === 'vehicle' && !next.vehicleId) next.vehicleId = args.relatedEntityId;
  if (args.type === 'young_person' && !next.youngPersonId) next.youngPersonId = args.relatedEntityId;
  return next;
}

function mergeApproverIdsIntoPayload(payload: unknown, approverIds?: string[] | null) {
  if (approverIds === undefined) return payload;
  const record = payload == null ? {} : asRecord(payload);
  if (!record) {
    throw httpError(422, 'VALIDATION_ERROR', 'submissionPayload must be an object when approverIds is provided.');
  }

  const next = { ...record } as Record<string, unknown>;
  if (approverIds === null) {
    delete next.approverIds;
  } else {
    next.approverIds = approverIds;
  }
  return next;
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
  const filters: Prisma.TaskWhereInput[] = [{ tenantId: actor.tenantId }];
  const privileged = isPrivilegedActor(actor);
  const lifecycleStatusFilter = parseDelimitedValues(query.status, EXPLORER_STATUS_VALUES);
  const categoryFilter = parseDelimitedValues(query.category, EXPLORER_CATEGORY_VALUES);
  const approvalStatusFilter = parseDelimitedValues(query.approvalStatus, EXPLORER_APPROVAL_STATUS_VALUES, {
    sent_for_approval: TaskApprovalStatus.pending_approval,
    awaiting_approval: TaskApprovalStatus.pending_approval,
  });
  const typeFilter = parseDelimitedValues(query.type, EXPLORER_TYPE_VALUES);

  if (lifecycleStatusFilter.invalid.length > 0) {
    throw httpError(
      422,
      'INVALID_STATUS_FILTER',
      `Invalid status filter value(s): ${lifecycleStatusFilter.invalid.join(', ')}.`,
    );
  }
  if (categoryFilter.invalid.length > 0) {
    throw httpError(
      422,
      'INVALID_CATEGORY_FILTER',
      `Invalid category filter value(s): ${categoryFilter.invalid.join(', ')}.`,
    );
  }
  if (approvalStatusFilter.invalid.length > 0) {
    throw httpError(
      422,
      'INVALID_APPROVAL_STATUS_FILTER',
      `Invalid approvalStatus filter value(s): ${approvalStatusFilter.invalid.join(', ')}.`,
    );
  }
  if (typeFilter.invalid.length > 0) {
    throw httpError(
      422,
      'INVALID_TYPE_FILTER',
      `Invalid type filter value(s): ${typeFilter.invalid.join(', ')}.`,
    );
  }

  const lifecycleStatuses = lifecycleStatusFilter.values;
  const explorerCategories = categoryFilter.values;
  const approvalStatuses = approvalStatusFilter.values as TaskApprovalStatus[];
  const typeFilters = typeFilter.values;

  if (query.summaryScope) {
    filters.push(buildSummaryScopeTaskFilter(actor, query.summaryScope));
  } else if (query.scope === 'my_tasks' || query.mine) {
    filters.push({ createdById: actor.userId });
  } else if (query.scope === 'assigned_to_me') {
    if (!actor.employeeId) {
      filters.push({ id: '__none__' });
    } else {
      filters.push({ assigneeId: actor.employeeId });
    }
  } else if (query.scope === 'approvals') {
    filters.push({ approvalStatus: TaskApprovalStatus.pending_approval });
    if (!privileged) {
      filters.push({ createdById: actor.userId });
    }
  } else if (!privileged) {
    const personalScope: Prisma.TaskWhereInput = actor.employeeId
      ? { OR: [{ createdById: actor.userId }, { assigneeId: actor.employeeId }] }
      : { createdById: actor.userId };
    filters.push(personalScope);
  }

  if (query.search) {
    filters.push({
      OR: [
        { id: { contains: query.search, mode: 'insensitive' } },
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { formName: { contains: query.search, mode: 'insensitive' } },
        { formGroup: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  if (lifecycleStatuses.length > 0) {
    filters.push({ OR: lifecycleStatuses.map((status) => lifecycleWhereClause(status)) });
  } else {
    filters.push({ deletedAt: null });
  }

  if (approvalStatuses.length > 0) filters.push({ approvalStatus: { in: approvalStatuses } });

  if (explorerCategories.length > 0) {
    const dbCategories = [...new Set(explorerCategories.map((key) => (
      key in EXPLORER_CATEGORY_MAP
        ? EXPLORER_CATEGORY_MAP[key as keyof typeof EXPLORER_CATEGORY_MAP].taskCategory
        : key as TaskCategory
    )))];
    filters.push({ category: { in: dbCategories } });
  }

  if (query.priority) filters.push({ priority: query.priority });
  if (query.assigneeId) filters.push({ assigneeId: query.assigneeId });
  if (query.createdById) filters.push({ createdById: query.createdById });
  if (query.homeId) filters.push({ homeId: query.homeId });
  if (query.vehicleId) filters.push({ vehicleId: query.vehicleId });
  if (query.youngPersonId) filters.push({ youngPersonId: query.youngPersonId });
  if (query.formGroup) filters.push({ formGroup: query.formGroup });
  if (query.entityId) {
    filters.push({
      OR: [
        { homeId: query.entityId },
        { vehicleId: query.entityId },
        { youngPersonId: query.entityId },
        { references: { some: { entityId: query.entityId } } },
      ],
    });
  }

  if (typeFilters.length > 0) {
    const typeClauses: Prisma.TaskWhereInput[] = [];
    if (typeFilters.includes('home')) typeClauses.push({ homeId: { not: null } });
    if (typeFilters.includes('young_person')) typeClauses.push({ youngPersonId: { not: null } });
    if (typeFilters.includes('vehicle')) typeClauses.push({ vehicleId: { not: null } });
    if (typeFilters.includes('employee')) {
      typeClauses.push({
        OR: [{ assigneeId: { not: null } }, { references: { some: { entityType: TaskReferenceEntityType.employee } } }],
      });
    }
    if (typeFilters.includes('document')) {
      typeClauses.push({
        OR: [
          { category: TaskCategory.document },
          { references: { some: { type: TaskReferenceType.document_url } } },
        ],
      });
    }
    if (typeFilters.includes('event')) typeClauses.push({ category: TaskCategory.incident });
    if (typeFilters.includes('upload')) typeClauses.push({ references: { some: { type: TaskReferenceType.upload } } });
    if (typeFilters.includes('care_group')) {
      typeClauses.push({ references: { some: { entityType: TaskReferenceEntityType.care_group } } });
    }
    if (typeFilters.includes('tenant')) {
      typeClauses.push({ references: { some: { entityType: TaskReferenceEntityType.tenant } } });
    }
    if (typeFilters.includes('task')) {
      typeClauses.push({ references: { some: { entityType: TaskReferenceEntityType.task } } });
    }
    if (typeClauses.length > 0) filters.push({ OR: typeClauses });
  }

  const periodRange = periodToRange(query.period);
  const dueFrom = query.dateFrom ?? periodRange.from;
  const dueTo = query.dateTo ?? periodRange.to;
  if (dueFrom || dueTo) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (dueFrom) dateFilter.gte = dueFrom;
    if (dueTo) dateFilter.lte = dueTo;
    filters.push({ dueDate: dateFilter });
  }

  const where: Prisma.TaskWhereInput = { AND: filters };
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: orderByFromQuery(query),
      skip,
      take: query.pageSize,
      include: {
        home: { select: { id: true, name: true, careGroupId: true } },
        vehicle: { select: { id: true, registration: true, make: true, model: true, homeId: true } },
        youngPerson: { select: { id: true, firstName: true, lastName: true, homeId: true } },
        assignee: {
          select: {
            id: true,
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
          },
        },
        references: {
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
  ]);

  const approverIds = rows.flatMap((row) => extractApproverIds(row.submissionPayload));
  const createdByIds = rows.map((row) => row.createdById).filter((id): id is string => Boolean(id));
  const userIdentityMap = await getUserIdentityMap([...createdByIds, ...approverIds]);
  const data = rows.map((row) => toTaskExplorerItem(row, userIdentityMap));

  logSensitiveReadAccess({
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
      type: query.type ?? null,
      priority: query.priority ?? null,
      assigneeId: query.assigneeId ?? null,
      createdById: query.createdById ?? null,
      homeId: query.homeId ?? null,
      vehicleId: query.vehicleId ?? null,
      youngPersonId: query.youngPersonId ?? null,
      mine: query.mine ?? null,
      scope: query.scope,
      summaryScope: query.summaryScope ?? null,
      period: query.period,
    },
  });

  return {
    data,
    meta: paginationMeta(total, query.page, query.pageSize),
    labels: {
      listTitle: 'Task Explorer',
      taskRef: 'Task ID',
      title: 'Title',
      category: 'Category',
      type: 'Type',
      workflowStatus: 'Workflow Status',
      approvalStatus: 'Approval Status',
      priority: 'Priority',
      dueAt: 'Due Date',
      assignee: 'Assignee',
      createdBy: 'Created By',
      relatedEntity: 'Related Entity',
    },
  };
}

export async function getTask(actorUserId: string, taskId: string) {
  const actor = await resolveActorContext(actorUserId);
  const task = await prisma.task.findFirst({
    where: { id: taskId, tenantId: actor.tenantId },
    include: {
      home: { select: { id: true, name: true, careGroupId: true } },
      vehicle: { select: { id: true, registration: true, make: true, model: true, homeId: true } },
      youngPerson: { select: { id: true, firstName: true, lastName: true, homeId: true } },
      assignee: {
        select: {
          id: true,
          user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      },
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

  const approverIds = extractApproverIds(task.submissionPayload);
  const createdByIds = [task.createdById].filter((id): id is string => Boolean(id));
  const userIdentityMap = await getUserIdentityMap([...createdByIds, ...approverIds]);
  const taskItem = toTaskExplorerItem(task, userIdentityMap);

  const payloadRecord = asRecord(task.submissionPayload);
  const payloadAttachmentIds = Array.isArray(payloadRecord?.attachmentFileIds)
    ? payloadRecord.attachmentFileIds.filter((value): value is string => typeof value === 'string')
    : [];
  const referencedFileIds = (task.references ?? [])
    .map((reference) => reference.fileId)
    .filter((value): value is string => Boolean(value));
  const allAttachmentIds = [...new Set([...payloadAttachmentIds, ...referencedFileIds, task.signatureFileId].filter(Boolean))] as string[];
  const attachmentFiles = allAttachmentIds.length === 0
    ? []
    : await prisma.uploadedFile.findMany({
        where: {
          tenantId: actor.tenantId,
          deletedAt: null,
          id: { in: allAttachmentIds },
        },
        select: {
          id: true,
          originalName: true,
          contentType: true,
          sizeBytes: true,
          purpose: true,
          status: true,
          uploadedAt: true,
        },
      });

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      tenantId: actor.tenantId,
      entityId: task.id,
      entityType: { in: ['task', 'task_approval', 'task_approval_review', 'task_approval_batch'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      action: true,
      userId: true,
      metadata: true,
      createdAt: true,
    },
  });
  const auditUserMap = await getUserIdentityMap(
    auditLogs.map((row) => row.userId).filter((id): id is string => Boolean(id)),
  );
  const activityLog = auditLogs.map((entry) => {
    const metadataRecord = asRecord(entry.metadata);
    return {
      id: entry.id,
      action: entry.action,
      by: entry.userId ? (auditUserMap.get(entry.userId) ?? null) : null,
      at: entry.createdAt,
      note:
        typeof metadataRecord?.comment === 'string'
          ? metadataRecord.comment
          : typeof metadataRecord?.reason === 'string'
            ? metadataRecord.reason
            : null,
      metadata: metadataRecord,
    };
  });

  const comments = activityLog
    .filter((item) => typeof item.note === 'string' && item.note.trim().length > 0)
    .map((item) => ({
      id: item.id,
      by: item.by,
      text: item.note,
      at: item.at,
    }));

  const auditTrail = activityLog
    .filter((item) => Array.isArray(item.metadata?.fields))
    .flatMap((item) => {
      const fields = Array.isArray(item.metadata?.fields) ? item.metadata.fields : [];
      return fields.map((field) => ({
        field: typeof field === 'string' ? field : 'unknown',
        from: null,
        to: null,
        by: item.by?.name ?? 'System',
        at: item.at,
      }));
    });

  const approvalChain = taskItem.approvers.map((approver) => ({
    userId: approver.id,
    name: approver.name,
    status: task.approvalStatus === TaskApprovalStatus.approved ? 'approved' : task.approvalStatus === TaskApprovalStatus.rejected ? 'rejected' : 'pending',
    respondedAt: task.approvedAt,
  }));

  logSensitiveReadAccess({
    actorUserId,
    tenantId: actor.tenantId,
    entityType: 'task',
    entityId: taskId,
    source: 'tasks.get',
    scope: 'detail',
    resultCount: 1,
  });

  return {
    ...taskItem,
    attachments: attachmentFiles.map((file) => ({
      id: file.id,
      name: file.originalName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      purpose: file.purpose,
      status: file.status,
      uploadedAt: file.uploadedAt,
    })),
    approvalChain,
    activityLog,
    comments,
    formData: task.submissionPayload,
    auditTrail,
  };
}

export async function createTask(actorUserId: string, body: CreateTaskBody) {
  const actor = await resolveActorContext(actorUserId);
  const privileged = isPrivilegedActor(actor);
  const entityLinks = resolveEntityLinksFromInput({
    relatedEntityId: body.relatedEntityId,
    type: body.type,
    homeId: body.homeId,
    vehicleId: body.vehicleId,
    youngPersonId: body.youngPersonId,
  });

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
  if (entityLinks.homeId !== undefined) createRelationInputs.homeId = entityLinks.homeId;
  if (entityLinks.vehicleId !== undefined) createRelationInputs.vehicleId = entityLinks.vehicleId;
  if (entityLinks.youngPersonId !== undefined) createRelationInputs.youngPersonId = entityLinks.youngPersonId;
  await ensureTaskRelationsInTenant(actor.tenantId, createRelationInputs);
  await assertEntityReferencesInTenant(actor.tenantId, body.references);

  const mergedPayload = mergeApproverIdsIntoPayload(body.submissionPayload, body.approverIds);
  const submissionPayload = buildSubmissionPayload({
    rawPayload: mergedPayload,
    attachmentFileIds: body.attachmentFileIds,
    signatureFileId: body.signatureFileId,
  });

  const referencedFileIds = [
    ...collectFileIdsFromPayload(submissionPayload),
    ...collectFileIdsFromReferences(body.references),
  ];
  if (body.signatureFileId?.trim()) referencedFileIds.push(body.signatureFileId);
  await assertUploadedFilesBelongToTenant(actor.tenantId, referencedFileIds);

  const submittedAt = body.submittedAt ?? null;
  const submittedById = submittedAt ? actor.userId : null;

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
      category: normalizeTaskCategoryInput(body.category) ?? TaskCategory.task_log,
      priority: body.priority,
      dueDate: body.dueAt ?? body.dueDate ?? null,
      assigneeId: body.assigneeId ?? null,
      homeId: entityLinks.homeId ?? null,
      vehicleId: entityLinks.vehicleId ?? null,
      youngPersonId: entityLinks.youngPersonId ?? null,
      signatureFileId: body.signatureFileId ?? null,
      createdById: privileged && body.createdById ? body.createdById : actor.userId,
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

  // Notify assignee if the task is assigned to someone other than the creator
  if (task.assigneeId) {
    const assigneeEmployee = await prisma.employee.findUnique({
      where: { id: task.assigneeId },
      select: { userId: true },
    });
    if (assigneeEmployee && assigneeEmployee.userId !== actor.userId) {
      void emitNotification({
        level: 'tenant',
        category: 'task_assigned',
        tenantId: actor.tenantId,
        title: 'New task assigned to you',
        body: `You have been assigned: "${task.title}".`,
        metadata: { taskId: task.id },
        recipientUserIds: [assigneeEmployee.userId],
        createdById: actor.userId,
      });
    }
  }

  void triggerRiskEvaluationForTaskMutation({
    tenantId: actor.tenantId,
    homeId: task.homeId,
    youngPersonId: task.youngPersonId,
    actorUserId: actor.userId,
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

  const entityLinks = resolveEntityLinksFromInput({
    relatedEntityId: body.relatedEntityId,
    type: body.type,
    homeId: body.homeId,
    vehicleId: body.vehicleId,
    youngPersonId: body.youngPersonId,
  });

  const updateRelationInputs: {
    assigneeId?: string | null;
    homeId?: string | null;
    vehicleId?: string | null;
    youngPersonId?: string | null;
  } = {};
  if (body.assigneeId !== undefined) updateRelationInputs.assigneeId = body.assigneeId;
  if (entityLinks.homeId !== undefined) updateRelationInputs.homeId = entityLinks.homeId;
  if (entityLinks.vehicleId !== undefined) updateRelationInputs.vehicleId = entityLinks.vehicleId;
  if (entityLinks.youngPersonId !== undefined) updateRelationInputs.youngPersonId = entityLinks.youngPersonId;
  await ensureTaskRelationsInTenant(actor.tenantId, updateRelationInputs);
  if (body.references !== undefined) {
    await assertEntityReferencesInTenant(actor.tenantId, body.references);
  }

  const payloadWithApprovers = mergeApproverIdsIntoPayload(body.submissionPayload, body.approverIds);
  const submissionPayload = buildSubmissionPayload({
    rawPayload: payloadWithApprovers,
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
  if (body.category !== undefined) updateData.category = normalizeTaskCategoryInput(body.category) ?? TaskCategory.task_log;
  if (body.priority !== undefined) updateData.priority = body.priority;
  if (body.dueDate !== undefined || body.dueAt !== undefined) updateData.dueDate = body.dueAt ?? body.dueDate ?? null;
  if (body.assigneeId !== undefined) updateData.assigneeId = body.assigneeId;
  if (entityLinks.homeId !== undefined) updateData.homeId = entityLinks.homeId;
  if (entityLinks.vehicleId !== undefined) updateData.vehicleId = entityLinks.vehicleId;
  if (entityLinks.youngPersonId !== undefined) updateData.youngPersonId = entityLinks.youngPersonId;
  if (body.createdById !== undefined && privileged) updateData.createdById = body.createdById;
  if (body.rejectionReason !== undefined) updateData.rejectionReason = body.rejectionReason;
  if (body.formTemplateKey !== undefined) updateData.formTemplateKey = body.formTemplateKey;
  if (body.formName !== undefined) updateData.formName = body.formName;
  if (body.formGroup !== undefined) updateData.formGroup = body.formGroup;
  if (
    body.submissionPayload !== undefined ||
    body.attachmentFileIds !== undefined ||
    body.signatureFileId !== undefined ||
    body.approverIds !== undefined
  ) {
    updateData.submissionPayload = toNullableJsonInput(submissionPayload);
    if (body.submittedAt !== undefined) {
      updateData.submittedAt = body.submittedAt;
      updateData.submittedById = body.submittedAt ? actor.userId : null;
    }
  } else if (body.submittedAt !== undefined) {
    updateData.submittedAt = body.submittedAt;
    updateData.submittedById = body.submittedAt ? actor.userId : null;
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

  void triggerRiskEvaluationForTaskMutation({
    tenantId: actor.tenantId,
    homeId: task.homeId,
    youngPersonId: task.youngPersonId,
    actorUserId: actor.userId,
  });

  return mapTask(task);
}

export async function runTaskAction(actorUserId: string, taskId: string, body: TaskActionBody) {
  const actor = await resolveActorContext(actorUserId);
  const existing = await prisma.task.findFirst({
    where: { id: taskId, tenantId: actor.tenantId, deletedAt: null },
    select: {
      id: true,
      status: true,
      approvalStatus: true,
      assigneeId: true,
      createdById: true,
      submissionPayload: true,
      homeId: true,
      youngPersonId: true,
    },
  });

  if (!existing) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  const privileged = isPrivilegedActor(actor);
  if (!privileged && !ownsTask(actor, existing)) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  if (body.signatureFileId) {
    await assertUploadedFilesBelongToTenant(actor.tenantId, [body.signatureFileId]);
  }

  const metadata: Record<string, unknown> = {
    action: body.action,
    comment: body.comment ?? body.text ?? null,
    reason: body.reason ?? null,
    assigneeId: body.assigneeId ?? null,
  };

  if (body.action === 'comment') {
    await prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: AuditAction.record_updated,
        entityType: 'task_action',
        entityId: taskId,
        metadata,
      },
    });
    return getTask(actorUserId, taskId);
  }

  const updateData: Prisma.TaskUncheckedUpdateInput = {
    updatedById: actor.userId,
  };

  if (body.action === 'submit') {
    const payloadObject = asRecord(existing.submissionPayload) ?? {};
    const approverIds = body.approverIds ?? extractApproverIds(existing.submissionPayload);
    const nextPayload = {
      ...payloadObject,
      approverIds,
    };
    updateData.submissionPayload = toNullableJsonInput(nextPayload);
    updateData.submittedAt = new Date();
    updateData.submittedById = actor.userId;
    updateData.status = TaskStatus.pending;
    updateData.approvalStatus = approverIds.length > 0
      ? TaskApprovalStatus.pending_approval
      : TaskApprovalStatus.not_required;
    updateData.rejectionReason = null;
  }

  if (body.action === 'approve') {
    if (!privileged) {
      throw httpError(403, 'FORBIDDEN', 'You do not have permission to approve tasks.');
    }
    updateData.approvalStatus = TaskApprovalStatus.approved;
    updateData.approvedAt = new Date();
    updateData.approvedById = actor.employeeId;
    updateData.rejectionReason = null;
    if (body.signatureFileId) updateData.signatureFileId = body.signatureFileId;
  }

  if (body.action === 'reject') {
    if (!privileged) {
      throw httpError(403, 'FORBIDDEN', 'You do not have permission to reject tasks.');
    }
    updateData.approvalStatus = TaskApprovalStatus.rejected;
    updateData.approvedAt = new Date();
    updateData.approvedById = actor.employeeId;
    updateData.rejectionReason = body.reason ?? body.comment ?? 'Rejected';
    updateData.signatureFileId = null;
  }

  if (body.action === 'reassign') {
    if (!body.assigneeId) {
      throw httpError(422, 'VALIDATION_ERROR', '`assigneeId` is required when action is reassign.');
    }
    await ensureTaskRelationsInTenant(actor.tenantId, { assigneeId: body.assigneeId });
    updateData.assigneeId = body.assigneeId;
  }

  if (body.action === 'request_deletion') {
    updateData.status = TaskStatus.cancelled;
    updateData.approvalStatus = TaskApprovalStatus.processing;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: updateData,
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_updated,
      entityType: 'task_action',
      entityId: taskId,
      metadata,
    },
  });

  // Emit notifications based on action type
  if (body.action === 'approve' || body.action === 'reject') {
    // Notify the task creator about the approval/rejection
    if (existing.createdById && existing.createdById !== actor.userId) {
      void emitNotification({
        level: 'tenant',
        category: body.action === 'approve' ? 'task_approved' : 'task_rejected',
        tenantId: actor.tenantId,
        title: body.action === 'approve' ? 'Task approved' : 'Task rejected',
        body: body.action === 'approve'
          ? 'Your task has been approved.'
          : `Your task has been rejected. Reason: ${body.reason ?? body.comment ?? 'No reason provided.'}`,
        metadata: { taskId },
        recipientUserIds: [existing.createdById],
        createdById: actor.userId,
      });
    }
  }

  if (body.action === 'reassign' && body.assigneeId) {
    const assigneeEmployee = await prisma.employee.findUnique({
      where: { id: body.assigneeId },
      select: { userId: true },
    });
    if (assigneeEmployee && assigneeEmployee.userId !== actor.userId) {
      void emitNotification({
        level: 'tenant',
        category: 'task_assigned',
        tenantId: actor.tenantId,
        title: 'Task reassigned to you',
        body: 'A task has been reassigned to you.',
        metadata: { taskId },
        recipientUserIds: [assigneeEmployee.userId],
        createdById: actor.userId,
      });
    }
  }

  void triggerRiskEvaluationForTaskMutation({
    tenantId: actor.tenantId,
    homeId: existing.homeId,
    youngPersonId: existing.youngPersonId,
    actorUserId: actor.userId,
  });

  return getTask(actorUserId, taskId);
}

function inferTemplateCategory(template: { key: string; group: string; name: string }) {
  const text = `${template.key} ${template.group} ${template.name}`.toLowerCase();
  if (text.includes('reg44') || text.includes('reg 44')) return 'reg44';
  if (text.includes('incident')) return 'incident';
  if (text.includes('vehicle')) return 'maintenance';
  if (text.includes('audit') || text.includes('inspection')) return 'inspection';
  if (text.includes('policy') || text.includes('document')) return 'documentation';
  if (text.includes('compliance')) return 'compliance';
  if (text.includes('report')) return 'report';
  if (text.includes('meeting')) return 'meeting';
  if (text.includes('check')) return 'checkup';
  return 'general';
}

export async function listTaskCategories() {
  return Object.values(EXPLORER_CATEGORY_MAP).map((entry) => ({
    value: entry.value,
    label: entry.label,
    types: entry.types,
  }));
}

export async function listTaskFormTemplates() {
  const rows = await prisma.formTemplate.findMany({
    where: { isActive: true },
    orderBy: [{ group: 'asc' }, { name: 'asc' }],
    select: {
      key: true,
      name: true,
      group: true,
    },
  });

  return rows.map((row) => ({
    slug: row.key,
    label: row.name,
    category: inferTemplateCategory(row),
    formGroup: row.group,
  }));
}

export async function deleteTask(actorUserId: string, taskId: string) {
  const actor = await resolveActorContext(actorUserId);
  const existing = await prisma.task.findFirst({
    where: { id: taskId, tenantId: actor.tenantId, deletedAt: null },
    select: {
      id: true,
      createdById: true,
      assigneeId: true,
      homeId: true,
      youngPersonId: true,
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

  void triggerRiskEvaluationForTaskMutation({
    tenantId: actor.tenantId,
    homeId: existing.homeId,
    youngPersonId: existing.youngPersonId,
    actorUserId: actor.userId,
  });

  return { message: 'Task archived.' };
}

export async function batchArchiveTasks(actorUserId: string, body: BatchArchiveBody) {
  const actor = await resolveActorContext(actorUserId);

  const tasks = await prisma.task.findMany({
    where: { id: { in: body.taskIds }, tenantId: actor.tenantId, deletedAt: null },
    select: { id: true, createdById: true, assigneeId: true },
  });
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const privileged = isPrivilegedActor(actor);

  const failed: Array<{ id: string; reason: string }> = [];
  const deletedAt = new Date();
  const validIds: string[] = [];

  for (const taskId of body.taskIds) {
    const task = taskMap.get(taskId);
    if (!task) {
      failed.push({ id: taskId, reason: 'Task not found.' });
    } else if (!privileged && !ownsTask(actor, task)) {
      failed.push({ id: taskId, reason: 'Permission denied.' });
    } else {
      validIds.push(taskId);
    }
  }

  let processed = 0;
  if (validIds.length > 0) {
    const result = await prisma.task.updateMany({
      where: { id: { in: validIds } },
      data: { deletedAt },
    });
    processed = result.count;
  }

  if (processed > 0) {
    await prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: AuditAction.record_deleted,
        entityType: 'task_archive_batch',
        metadata: {
          softDelete: true,
          processed,
          failed: failed.length,
          deletedAt: deletedAt.toISOString(),
        },
      },
    });

    void triggerRiskEvaluationForTaskMutation({
      tenantId: actor.tenantId,
      homeId: null,
      youngPersonId: null,
      actorUserId: actor.userId,
    });
  }

  return { processed, failed };
}

export async function postponeTask(actorUserId: string, taskId: string, body: PostponeTaskBody) {
  const actor = await resolveActorContext(actorUserId);
  const existing = await prisma.task.findFirst({
    where: { id: taskId, tenantId: actor.tenantId, deletedAt: null },
    select: { id: true, dueDate: true, createdById: true, assigneeId: true },
  });

  if (!existing) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  if (!isPrivilegedActor(actor) && !ownsTask(actor, existing)) {
    throw httpError(404, 'TASK_NOT_FOUND', 'Task not found.');
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { dueDate: body.dueDate, updatedById: actor.userId },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.record_updated,
      entityType: 'task_action',
      entityId: taskId,
      metadata: {
        action: 'postpone',
        previousDueDate: existing.dueDate?.toISOString() ?? null,
        newDueDate: body.dueDate.toISOString(),
        reason: body.reason ?? null,
      },
    },
  });

  void triggerRiskEvaluationForTaskMutation({
    tenantId: actor.tenantId,
    homeId: null,
    youngPersonId: null,
    actorUserId: actor.userId,
  });

  return getTask(actorUserId, taskId);
}

export async function batchPostponeTasks(actorUserId: string, body: BatchPostponeBody) {
  const actor = await resolveActorContext(actorUserId);

  const tasks = await prisma.task.findMany({
    where: { id: { in: body.taskIds }, tenantId: actor.tenantId, deletedAt: null },
    select: { id: true, dueDate: true, createdById: true, assigneeId: true },
  });
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const privileged = isPrivilegedActor(actor);

  const failed: Array<{ id: string; reason: string }> = [];
  const validIds: string[] = [];

  for (const taskId of body.taskIds) {
    const task = taskMap.get(taskId);
    if (!task) {
      failed.push({ id: taskId, reason: 'Task not found.' });
    } else if (!privileged && !ownsTask(actor, task)) {
      failed.push({ id: taskId, reason: 'Permission denied.' });
    } else {
      validIds.push(taskId);
    }
  }

  let processed = 0;
  if (validIds.length > 0) {
    const result = await prisma.task.updateMany({
      where: { id: { in: validIds } },
      data: { dueDate: body.dueDate, updatedById: actor.userId },
    });
    processed = result.count;
  }

  if (processed > 0) {
    await prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: AuditAction.record_updated,
        entityType: 'task_postpone_batch',
        metadata: {
          action: 'postpone',
          newDueDate: body.dueDate.toISOString(),
          reason: body.reason ?? null,
          processed,
          failed: failed.length,
        },
      },
    });

    void triggerRiskEvaluationForTaskMutation({
      tenantId: actor.tenantId,
      homeId: null,
      youngPersonId: null,
      actorUserId: actor.userId,
    });
  }

  return { processed, failed };
}

export async function batchReassignTasks(actorUserId: string, body: BatchReassignBody) {
  const actor = await resolveActorContext(actorUserId);

  await ensureTaskRelationsInTenant(actor.tenantId, { assigneeId: body.assigneeId });

  const tasks = await prisma.task.findMany({
    where: { id: { in: body.taskIds }, tenantId: actor.tenantId, deletedAt: null },
    select: { id: true, assigneeId: true, createdById: true },
  });
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const privileged = isPrivilegedActor(actor);

  const failed: Array<{ id: string; reason: string }> = [];
  const validIds: string[] = [];

  for (const taskId of body.taskIds) {
    const task = taskMap.get(taskId);
    if (!task) {
      failed.push({ id: taskId, reason: 'Task not found.' });
    } else if (!privileged && !ownsTask(actor, task)) {
      failed.push({ id: taskId, reason: 'Permission denied.' });
    } else {
      validIds.push(taskId);
    }
  }

  let processed = 0;
  if (validIds.length > 0) {
    const result = await prisma.task.updateMany({
      where: { id: { in: validIds } },
      data: { assigneeId: body.assigneeId, updatedById: actor.userId },
    });
    processed = result.count;
  }

  if (processed > 0) {
    await prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: AuditAction.record_updated,
        entityType: 'task_reassign_batch',
        metadata: {
          action: 'reassign',
          assigneeId: body.assigneeId,
          reason: body.reason ?? null,
          processed,
          failed: failed.length,
        },
      },
    });

    void triggerRiskEvaluationForTaskMutation({
      tenantId: actor.tenantId,
      homeId: null,
      youngPersonId: null,
      actorUserId: actor.userId,
    });
  }

  return { processed, failed };
}
