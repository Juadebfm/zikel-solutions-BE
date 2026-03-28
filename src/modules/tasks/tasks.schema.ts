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
]);
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
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().max(100).optional(),
  status: TaskStatusSchema.optional(),
  approvalStatus: TaskApprovalStatusSchema.optional(),
  category: TaskCategorySchema.optional(),
  priority: TaskPrioritySchema.optional(),
  assigneeId: z.string().min(1).optional(),
  homeId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  youngPersonId: z.string().min(1).optional(),
  mine: BoolishSchema.optional(),
  sortBy: z
    .enum(['title', 'status', 'approvalStatus', 'category', 'priority', 'dueDate', 'createdAt', 'updatedAt'])
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const CreateTaskBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: TaskStatusSchema.optional(),
  approvalStatus: TaskApprovalStatusSchema.optional(),
  category: TaskCategorySchema.default('task_log'),
  priority: TaskPrioritySchema.default('medium'),
  dueDate: NullableDateTimeSchema,
  assigneeId: z.string().min(1).optional(),
  homeId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  youngPersonId: z.string().min(1).optional(),
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
    category: TaskCategorySchema.optional(),
    priority: TaskPrioritySchema.optional(),
    dueDate: NullableDateTimeSchema,
    assigneeId: z.string().min(1).nullable().optional(),
    homeId: z.string().min(1).nullable().optional(),
    vehicleId: z.string().min(1).nullable().optional(),
    youngPersonId: z.string().min(1).nullable().optional(),
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
    pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 20 },
    search: { type: 'string', maxLength: 100 },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    category: {
      type: 'string',
      enum: ['task_log', 'document', 'system_link', 'checklist', 'incident', 'other'],
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    assigneeId: { type: 'string' },
    homeId: { type: 'string' },
    vehicleId: { type: 'string' },
    youngPersonId: { type: 'string' },
    mine: { type: 'boolean' },
    sortBy: {
      type: 'string',
      enum: ['title', 'status', 'approvalStatus', 'category', 'priority', 'dueDate', 'createdAt', 'updatedAt'],
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
      enum: ['task_log', 'document', 'system_link', 'checklist', 'incident', 'other'],
      default: 'task_log',
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    assigneeId: { type: 'string' },
    homeId: { type: 'string' },
    vehicleId: { type: 'string' },
    youngPersonId: { type: 'string' },
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
      enum: ['task_log', 'document', 'system_link', 'checklist', 'incident', 'other'],
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    assigneeId: { type: ['string', 'null'] },
    homeId: { type: ['string', 'null'] },
    vehicleId: { type: ['string', 'null'] },
    youngPersonId: { type: ['string', 'null'] },
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

export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;
export type UpdateTaskBody = z.infer<typeof UpdateTaskBodySchema>;
