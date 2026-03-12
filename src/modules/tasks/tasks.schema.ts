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

export const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export const TaskApprovalStatusSchema = z.enum([
  'not_required',
  'pending_approval',
  'approved',
  'rejected',
  'processing',
]);
export const TaskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const ListTasksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  status: TaskStatusSchema.optional(),
  approvalStatus: TaskApprovalStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  assigneeId: z.string().min(1).optional(),
  youngPersonId: z.string().min(1).optional(),
  mine: BoolishSchema.optional(),
  sortBy: z
    .enum(['title', 'status', 'approvalStatus', 'priority', 'dueDate', 'createdAt', 'updatedAt'])
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const CreateTaskBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: TaskStatusSchema.optional(),
  approvalStatus: TaskApprovalStatusSchema.optional(),
  priority: TaskPrioritySchema.default('medium'),
  dueDate: NullableDateTimeSchema,
  assigneeId: z.string().min(1).optional(),
  youngPersonId: z.string().min(1).optional(),
});

export const UpdateTaskBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: TaskStatusSchema.optional(),
    approvalStatus: TaskApprovalStatusSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    dueDate: NullableDateTimeSchema,
    assigneeId: z.string().min(1).nullable().optional(),
    youngPersonId: z.string().min(1).nullable().optional(),
    rejectionReason: z.string().max(2000).nullable().optional(),
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
    search: { type: 'string', maxLength: 100 },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    assigneeId: { type: 'string' },
    youngPersonId: { type: 'string' },
    mine: { type: 'boolean' },
    sortBy: {
      type: 'string',
      enum: ['title', 'status', 'approvalStatus', 'priority', 'dueDate', 'createdAt', 'updatedAt'],
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
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    assigneeId: { type: 'string' },
    youngPersonId: { type: 'string' },
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
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    assigneeId: { type: ['string', 'null'] },
    youngPersonId: { type: ['string', 'null'] },
    rejectionReason: { type: ['string', 'null'], maxLength: 2000 },
  },
  minProperties: 1,
} as const;

export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;
export type UpdateTaskBody = z.infer<typeof UpdateTaskBodySchema>;
