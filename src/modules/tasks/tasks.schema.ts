import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

const NullableDateTimeSchema = z
  .union([z.string().datetime(), z.date(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return value instanceof Date ? value : new Date(value);
  });

const OptionalNullableDateTimeSchema = z
  .union([z.string().datetime(), z.date(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return value instanceof Date ? value : new Date(value);
  });

const QueryDateSchema = z
  .union([z.string().datetime(), z.string().date(), z.date()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value instanceof Date ? value : new Date(value);
  });

export const TASK_EXPLORER_STATUS_VALUES = [
  'draft',
  'submitted',
  'sent_for_approval',
  'approved',
  'rejected',
  'sent_for_deletion',
  'deleted',
  'deleted_draft',
  'hidden',
] as const;

export const TASK_EXPLORER_CATEGORY_VALUES = [
  'reg44',
  'inspection',
  'maintenance',
  'checkup',
  'meeting',
  'documentation',
  'incident',
  'report',
  'compliance',
  'general',
  'daily_log',
] as const;

export const TASK_EXPLORER_TYPE_VALUES = [
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
] as const;

export const TaskExplorerStatusSchema = z.enum(TASK_EXPLORER_STATUS_VALUES);
export const TaskExplorerCategorySchema = z.enum(TASK_EXPLORER_CATEGORY_VALUES);
export const TaskExplorerTypeSchema = z.enum(TASK_EXPLORER_TYPE_VALUES);

export const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export const TaskApprovalStatusSchema = z.enum([
  'not_required',
  'pending_approval',
  'approved',
  'rejected',
  'processing',
]);
export const TaskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export const TaskCategorySchema = z.enum([
  'task_log',
  'document',
  'system_link',
  'checklist',
  'incident',
  'other',
  'daily_log',
]);
export const TaskCategoryInputSchema = z.union([TaskCategorySchema, TaskExplorerCategorySchema]);
export const TaskReferenceTypeSchema = z.enum([
  'entity',
  'upload',
  'internal_route',
  'external_url',
  'document_url',
]);
export const TaskReferenceEntityTypeSchema = z.enum([
  'tenant',
  'care_group',
  'home',
  'young_person',
  'vehicle',
  'employee',
  'task',
]);

const TaskReferenceInputSchema = z.object({
  type: TaskReferenceTypeSchema,
  entityType: TaskReferenceEntityTypeSchema.optional(),
  entityId: z.string().min(1).optional(),
  fileId: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  label: z.string().max(200).optional(),
  metadata: z.unknown().optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'entity') {
    if (!value.entityType || !value.entityId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'entity references require both entityType and entityId.',
      });
    }
  }
  if (value.type === 'upload' && !value.fileId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'upload references require fileId.',
    });
  }
  if (
    (value.type === 'internal_route' || value.type === 'external_url' || value.type === 'document_url')
    && !value.url
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.type} references require url.`,
    });
  }
});

export const ListTasksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  status: z.string().max(300).optional(),
  approvalStatus: z.string().max(200).optional(),
  category: z.string().max(300).optional(),
  type: z.string().max(200).optional(),
  entityId: z.string().min(1).optional(),
  priority: TaskPrioritySchema.optional(),
  assigneeId: z.string().min(1).optional(),
  createdById: z.string().min(1).optional(),
  homeId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  youngPersonId: z.string().min(1).optional(),
  scope: z.enum(['my_tasks', 'assigned_to_me', 'approvals', 'all']).default('all'),
  period: z
    .enum(['today', 'yesterday', 'last_7_days', 'this_week', 'this_month', 'this_year', 'last_month', 'all'])
    .default('all'),
  dateFrom: QueryDateSchema,
  dateTo: QueryDateSchema,
  formGroup: z.string().max(120).optional(),
  mine: BoolishSchema.optional(),
  sortBy: z
    .enum([
      'taskRef',
      'title',
      'status',
      'approvalStatus',
      'category',
      'type',
      'priority',
      'dueAt',
      'submittedAt',
      'createdAt',
      'updatedAt',
    ])
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
}).superRefine((value, ctx) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dateFrom'],
      message: '`dateFrom` cannot be after `dateTo`.',
    });
  }
});

export const CreateTaskBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: TaskStatusSchema.optional(),
  approvalStatus: TaskApprovalStatusSchema.optional(),
  category: TaskCategoryInputSchema.default('task_log'),
  priority: TaskPrioritySchema.default('medium'),
  dueDate: NullableDateTimeSchema,
  dueAt: NullableDateTimeSchema,
  assigneeId: z.string().min(1).optional(),
  createdById: z.string().min(1).optional(),
  homeId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  youngPersonId: z.string().min(1).optional(),
  relatedEntityId: z.string().min(1).optional(),
  type: TaskExplorerTypeSchema.optional(),
  approverIds: z.array(z.string().min(1)).max(25).optional(),
  formTemplateKey: z.string().max(120).optional(),
  formName: z.string().max(200).optional(),
  formGroup: z.string().max(120).optional(),
  submissionPayload: z.unknown().optional(),
  references: z.array(TaskReferenceInputSchema).max(25).optional(),
  submittedAt: OptionalNullableDateTimeSchema,
  attachmentFileIds: z.array(z.string().min(1)).max(25).optional(),
  signatureFileId: z.string().min(1).optional(),
});

export const UpdateTaskBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: TaskStatusSchema.optional(),
    approvalStatus: TaskApprovalStatusSchema.optional(),
    category: TaskCategoryInputSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    dueDate: NullableDateTimeSchema,
    dueAt: NullableDateTimeSchema,
    assigneeId: z.string().min(1).nullable().optional(),
    createdById: z.string().min(1).nullable().optional(),
    homeId: z.string().min(1).nullable().optional(),
    vehicleId: z.string().min(1).nullable().optional(),
    youngPersonId: z.string().min(1).nullable().optional(),
    relatedEntityId: z.string().min(1).nullable().optional(),
    type: TaskExplorerTypeSchema.nullable().optional(),
    approverIds: z.array(z.string().min(1)).max(25).nullable().optional(),
    rejectionReason: z.string().max(2000).nullable().optional(),
    formTemplateKey: z.string().max(120).nullable().optional(),
    formName: z.string().max(200).nullable().optional(),
    formGroup: z.string().max(120).nullable().optional(),
    submissionPayload: z.unknown().nullable().optional(),
    references: z.array(TaskReferenceInputSchema).max(25).nullable().optional(),
    submittedAt: OptionalNullableDateTimeSchema,
    attachmentFileIds: z.array(z.string().min(1)).max(25).nullable().optional(),
    signatureFileId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listTasksQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 200 },
    status: { type: 'string', maxLength: 300 },
    approvalStatus: { type: 'string', maxLength: 200 },
    category: { type: 'string', maxLength: 300 },
    type: { type: 'string', maxLength: 200 },
    entityId: { type: 'string' },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    assigneeId: { type: 'string' },
    createdById: { type: 'string' },
    homeId: { type: 'string' },
    vehicleId: { type: 'string' },
    youngPersonId: { type: 'string' },
    scope: { type: 'string', enum: ['my_tasks', 'assigned_to_me', 'approvals', 'all'], default: 'all' },
    period: {
      type: 'string',
      enum: ['today', 'yesterday', 'last_7_days', 'this_week', 'this_month', 'this_year', 'last_month', 'all'],
      default: 'all',
    },
    dateFrom: { type: 'string', format: 'date-time' },
    dateTo: { type: 'string', format: 'date-time' },
    formGroup: { type: 'string', maxLength: 120 },
    mine: { type: 'boolean' },
    sortBy: {
      type: 'string',
      enum: [
        'taskRef',
        'title',
        'status',
        'approvalStatus',
        'category',
        'type',
        'priority',
        'dueAt',
        'submittedAt',
        'createdAt',
        'updatedAt',
      ],
    },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
  },
} as const;

export const createTaskBodyJson = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 5000 },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    category: {
      type: 'string',
      enum: [
        'task_log',
        'document',
        'system_link',
        'checklist',
        'incident',
        'other',
        'daily_log',
        'reg44',
        'inspection',
        'maintenance',
        'checkup',
        'meeting',
        'documentation',
        'report',
        'compliance',
        'general',
      ],
      default: 'task_log',
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    dueAt: { type: ['string', 'null'], format: 'date-time' },
    assigneeId: { type: 'string' },
    createdById: { type: 'string' },
    homeId: { type: 'string' },
    vehicleId: { type: 'string' },
    youngPersonId: { type: 'string' },
    relatedEntityId: { type: 'string' },
    type: {
      type: 'string',
      enum: ['home', 'young_person', 'vehicle', 'employee', 'document', 'event', 'upload', 'care_group', 'tenant', 'task', 'other'],
    },
    approverIds: {
      type: 'array',
      maxItems: 25,
      items: { type: 'string', minLength: 1 },
    },
    formTemplateKey: { type: 'string', maxLength: 120 },
    formName: { type: 'string', maxLength: 200 },
    formGroup: { type: 'string', maxLength: 120 },
    submissionPayload: {},
    references: {
      type: 'array',
      maxItems: 25,
      items: {
        type: 'object',
        required: ['type'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['entity', 'upload', 'internal_route', 'external_url', 'document_url'],
          },
          entityType: {
            type: 'string',
            enum: ['tenant', 'care_group', 'home', 'young_person', 'vehicle', 'employee', 'task'],
          },
          entityId: { type: 'string', minLength: 1 },
          fileId: { type: 'string', minLength: 1 },
          url: { type: 'string', minLength: 1 },
          label: { type: 'string', maxLength: 200 },
          metadata: {},
        },
      },
    },
    submittedAt: { type: ['string', 'null'], format: 'date-time' },
    attachmentFileIds: {
      type: 'array',
      maxItems: 25,
      items: { type: 'string', minLength: 1 },
    },
    signatureFileId: { type: 'string', minLength: 1 },
  },
} as const;

export const updateTaskBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 5000 },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    category: {
      type: 'string',
      enum: [
        'task_log',
        'document',
        'system_link',
        'checklist',
        'incident',
        'other',
        'daily_log',
        'reg44',
        'inspection',
        'maintenance',
        'checkup',
        'meeting',
        'documentation',
        'report',
        'compliance',
        'general',
      ],
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    dueAt: { type: ['string', 'null'], format: 'date-time' },
    assigneeId: { type: ['string', 'null'] },
    createdById: { type: ['string', 'null'] },
    homeId: { type: ['string', 'null'] },
    vehicleId: { type: ['string', 'null'] },
    youngPersonId: { type: ['string', 'null'] },
    relatedEntityId: { type: ['string', 'null'] },
    type: {
      type: ['string', 'null'],
      enum: [
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
        null,
      ],
    },
    approverIds: {
      type: ['array', 'null'],
      maxItems: 25,
      items: { type: 'string', minLength: 1 },
    },
    rejectionReason: { type: ['string', 'null'], maxLength: 2000 },
    formTemplateKey: { type: ['string', 'null'], maxLength: 120 },
    formName: { type: ['string', 'null'], maxLength: 200 },
    formGroup: { type: ['string', 'null'], maxLength: 120 },
    submissionPayload: {},
    references: {
      type: ['array', 'null'],
      maxItems: 25,
      items: {
        type: 'object',
        required: ['type'],
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['entity', 'upload', 'internal_route', 'external_url', 'document_url'],
          },
          entityType: {
            type: 'string',
            enum: ['tenant', 'care_group', 'home', 'young_person', 'vehicle', 'employee', 'task'],
          },
          entityId: { type: 'string', minLength: 1 },
          fileId: { type: 'string', minLength: 1 },
          url: { type: 'string', minLength: 1 },
          label: { type: 'string', maxLength: 200 },
          metadata: {},
        },
      },
    },
    submittedAt: { type: ['string', 'null'], format: 'date-time' },
    attachmentFileIds: {
      type: ['array', 'null'],
      maxItems: 25,
      items: { type: 'string', minLength: 1 },
    },
    signatureFileId: { type: ['string', 'null'], minLength: 1 },
  },
  minProperties: 1,
} as const;

export const TaskActionBodySchema = z
  .object({
    action: z.enum(['submit', 'approve', 'reject', 'reassign', 'request_deletion', 'comment']),
    comment: z.string().max(2000).optional(),
    text: z.string().max(2000).optional(),
    reason: z.string().max(2000).optional(),
    assigneeId: z.string().min(1).optional(),
    signatureFileId: z.string().min(1).optional(),
    approverIds: z.array(z.string().min(1)).max(25).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'reassign' && !value.assigneeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assigneeId'],
        message: '`assigneeId` is required when action is reassign.',
      });
    }

    if (value.action === 'comment' && !(value.text || value.comment)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: '`text` or `comment` is required when action is comment.',
      });
    }
  });

export const taskActionBodyJson = {
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['submit', 'approve', 'reject', 'reassign', 'request_deletion', 'comment'],
    },
    comment: { type: 'string', maxLength: 2000 },
    text: { type: 'string', maxLength: 2000 },
    reason: { type: 'string', maxLength: 2000 },
    assigneeId: { type: 'string', minLength: 1 },
    signatureFileId: { type: 'string', minLength: 1 },
    approverIds: {
      type: 'array',
      maxItems: 25,
      items: { type: 'string', minLength: 1 },
    },
  },
} as const;

export const BatchArchiveBodySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(100),
});

export const PostponeTaskBodySchema = z.object({
  dueDate: z.union([z.string().datetime(), z.date()]).transform((v) =>
    v instanceof Date ? v : new Date(v),
  ),
  reason: z.string().max(2000).optional(),
});

export const BatchPostponeBodySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(100),
  dueDate: z.union([z.string().datetime(), z.date()]).transform((v) =>
    v instanceof Date ? v : new Date(v),
  ),
  reason: z.string().max(2000).optional(),
});

export const BatchReassignBodySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(100),
  assigneeId: z.string().min(1),
  reason: z.string().max(2000).optional(),
});

export const batchArchiveBodyJson = {
  type: 'object',
  required: ['taskIds'],
  additionalProperties: false,
  properties: {
    taskIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: { type: 'string', minLength: 1 },
    },
  },
} as const;

export const postponeTaskBodyJson = {
  type: 'object',
  required: ['dueDate'],
  additionalProperties: false,
  properties: {
    dueDate: { type: 'string', format: 'date-time' },
    reason: { type: 'string', maxLength: 2000 },
  },
} as const;

export const batchPostponeBodyJson = {
  type: 'object',
  required: ['taskIds', 'dueDate'],
  additionalProperties: false,
  properties: {
    taskIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: { type: 'string', minLength: 1 },
    },
    dueDate: { type: 'string', format: 'date-time' },
    reason: { type: 'string', maxLength: 2000 },
  },
} as const;

export const batchReassignBodyJson = {
  type: 'object',
  required: ['taskIds', 'assigneeId'],
  additionalProperties: false,
  properties: {
    taskIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: { type: 'string', minLength: 1 },
    },
    assigneeId: { type: 'string', minLength: 1 },
    reason: { type: 'string', maxLength: 2000 },
  },
} as const;

export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;
export type UpdateTaskBody = z.infer<typeof UpdateTaskBodySchema>;
export type TaskActionBody = z.infer<typeof TaskActionBodySchema>;
export type BatchArchiveBody = z.infer<typeof BatchArchiveBodySchema>;
export type PostponeTaskBody = z.infer<typeof PostponeTaskBodySchema>;
export type BatchPostponeBody = z.infer<typeof BatchPostponeBodySchema>;
export type BatchReassignBody = z.infer<typeof BatchReassignBodySchema>;
