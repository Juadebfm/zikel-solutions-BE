/**
 * Summary module — JSON schemas for route validation + OpenAPI docs.
 */
import { z } from 'zod';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const QueryDateSchema = z
  .union([z.string().datetime(), z.string().date(), z.date()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value instanceof Date ? value : new Date(value);
  });

export const SummaryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().optional(),
  formGroup: z.string().max(120).optional(),
  taskDateFrom: QueryDateSchema,
  taskDateTo: QueryDateSchema,
}).superRefine((value, ctx) => {
  if (value.taskDateFrom && value.taskDateTo && value.taskDateFrom > value.taskDateTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['taskDateFrom'],
      message: '`taskDateFrom` cannot be after `taskDateTo`.',
    });
  }
});

export const ApproveTaskBodySchema = z.object({
  comment: z.string().max(500).optional(),
});

export const BatchApproveBodySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, 'At least one task ID required.'),
  action: z.enum(['approve', 'reject']),
  rejectionReason: z.string().max(500).optional(),
});

// ─── JSON Schemas ─────────────────────────────────────────────────────────────

export const approveTaskBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    comment: { type: 'string', maxLength: 500, description: 'Optional approval comment' },
  },
} as const;

export const batchApproveBodyJson = {
  type: 'object',
  required: ['taskIds', 'action'],
  additionalProperties: false,
  properties: {
    taskIds: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      description: 'Array of task IDs to process',
    },
    action: { type: 'string', enum: ['approve', 'reject'] },
    rejectionReason: { type: 'string', maxLength: 500 },
  },
} as const;

export const tasksToApproveQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    sortBy: { type: 'string' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
    search: { type: 'string' },
    formGroup: { type: 'string', maxLength: 120 },
    taskDateFrom: {
      type: 'string',
      format: 'date-time',
      description: 'Filter tasks with due date on/after this timestamp.',
    },
    taskDateTo: {
      type: 'string',
      format: 'date-time',
      description: 'Filter tasks with due date on/before this timestamp.',
    },
  },
} as const;

// ─── Response shape schemas (for OpenAPI inline definitions) ──────────────────

export const todoItemJson = {
  type: 'object',
  required: ['id', 'taskRef', 'title', 'status', 'approvalStatus', 'priority'],
  properties: {
    id: { type: 'string' },
    taskRef: { type: 'string', example: 'TSK-20260321-HM5T7F' },
    title: { type: 'string' },
    relation: { type: 'string', nullable: true, description: 'Related young person name or home' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    assignee: { type: 'string', nullable: true },
    dueDate: { type: 'string', format: 'date-time', nullable: true },
  },
} as const;

export const tasksToApproveItemJson = {
  type: 'object',
  required: [
    'id',
    'taskRef',
    'title',
    'formGroup',
    'approvalStatus',
    'approvalStatusLabel',
    'taskDate',
    'submittedOn',
    'updatedOn',
    'approvers',
  ],
  properties: {
    id: { type: 'string' },
    taskRef: { type: 'string', example: 'TSK-20260321-HM5T7F' },
    title: { type: 'string' },
    formGroup: { type: 'string', nullable: true },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    approvalStatusLabel: { type: 'string', example: 'Awaiting Approval' },
    homeOrSchool: { type: 'string', nullable: true },
    relatedTo: { type: 'string', nullable: true },
    taskDate: { type: 'string', format: 'date-time', nullable: true },
    submittedOn: { type: 'string', format: 'date-time' },
    submittedBy: { type: 'string', nullable: true },
    updatedOn: { type: 'string', format: 'date-time' },
    updatedBy: { type: 'string', nullable: true },
    approvers: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const pendingApprovalLabelsJson = {
  type: 'object',
  required: [
    'pendingApprovalTitle',
    'configuredInformation',
    'formName',
    'logStatuses',
    'status',
    'homeOrSchool',
    'relatesTo',
    'taskDate',
    'originallyRecordedOn',
    'originallyRecordedBy',
    'lastUpdatedOn',
    'lastUpdatedBy',
    'pendingApprovalStatus',
    'resetGrid',
  ],
  properties: {
    pendingApprovalTitle: { type: 'string', example: 'Items Awaiting Approval' },
    configuredInformation: { type: 'string', example: 'Current Filters' },
    formName: { type: 'string', example: 'Form' },
    logStatuses: { type: 'string', example: 'Submission Status' },
    status: { type: 'string', example: 'Approval Status' },
    homeOrSchool: { type: 'string', example: 'Home / School' },
    relatesTo: { type: 'string', example: 'Related To' },
    taskDate: { type: 'string', example: 'Due Date' },
    originallyRecordedOn: { type: 'string', example: 'Submitted On' },
    originallyRecordedBy: { type: 'string', example: 'Submitted By' },
    lastUpdatedOn: { type: 'string', example: 'Updated On' },
    lastUpdatedBy: { type: 'string', example: 'Updated By' },
    pendingApprovalStatus: { type: 'string', example: 'Awaiting Approval' },
    resetGrid: { type: 'string', example: 'Reset table' },
  },
} as const;

export const taskToApproveDetailJson = {
  type: 'object',
  required: [
    'id',
    'taskRef',
    'title',
    'formName',
    'formGroup',
    'approvalStatus',
    'approvalStatusLabel',
    'meta',
    'labels',
    'renderPayload',
  ],
  properties: {
    id: { type: 'string' },
    taskRef: { type: 'string' },
    title: { type: 'string' },
    formName: { type: 'string', nullable: true },
    formGroup: { type: 'string', nullable: true },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    approvalStatusLabel: { type: 'string' },
    meta: {
      type: 'object',
      required: ['taskId', 'taskRef', 'submittedOn', 'updatedOn', 'approvers'],
      properties: {
        taskId: { type: 'string' },
        taskRef: { type: 'string' },
        homeOrSchool: { type: 'string', nullable: true },
        relatedTo: { type: 'string', nullable: true },
        taskDate: { type: 'string', format: 'date-time', nullable: true },
        submittedOn: { type: 'string', format: 'date-time' },
        submittedBy: { type: 'string', nullable: true },
        updatedOn: { type: 'string', format: 'date-time' },
        updatedBy: { type: 'string', nullable: true },
        approvers: { type: 'array', items: { type: 'string' } },
      },
    },
    labels: pendingApprovalLabelsJson,
    renderPayload: {
      description: 'Dynamic submitted form payload for rendering the form detail page.',
    },
  },
} as const;

export const provisionHomeJson = {
  type: 'object',
  required: ['homeId', 'homeName', 'events', 'shifts'],
  properties: {
    homeId: { type: 'string', example: 'cm8xk1m2v0000z0n1f2g3h4i5' },
    homeName: { type: 'string', example: 'Sunrise House' },
    events: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'time'],
        properties: {
          id: { type: 'string', example: 'cm8xk2p7a0001z0n1m4n5o6p7' },
          title: { type: 'string', example: 'Morning Provision Planning' },
          time: { type: 'string', format: 'date-time', example: '2026-03-11T09:00:00.000Z' },
          description: {
            type: 'string',
            nullable: true,
            example: 'Daily support planning, risk checks, and priorities review.',
          },
        },
      },
    },
    shifts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['employeeId', 'employeeName', 'startTime', 'endTime'],
        properties: {
          employeeId: { type: 'string', example: 'cm8xk34hf0002z0n1t8u9v0w1' },
          employeeName: { type: 'string', example: 'Noah North' },
          startTime: { type: 'string', format: 'date-time', example: '2026-03-11T07:00:00.000Z' },
          endTime: { type: 'string', format: 'date-time', example: '2026-03-11T15:00:00.000Z' },
        },
      },
    },
  },
} as const;

export const provisionsResponseExample = [
  {
    homeId: 'cm8xk1m2v0000z0n1f2g3h4i5',
    homeName: 'Sunrise House',
    events: [
      {
        id: 'cm8xk2p7a0001z0n1m4n5o6p7',
        title: 'Morning Provision Planning',
        time: '2026-03-11T09:00:00.000Z',
        description: 'Daily support planning, risk checks, and priorities review.',
      },
    ],
    shifts: [
      {
        employeeId: 'cm8xk34hf0002z0n1t8u9v0w1',
        employeeName: 'Noah North',
        startTime: '2026-03-11T07:00:00.000Z',
        endTime: '2026-03-11T15:00:00.000Z',
      },
      {
        employeeId: 'cm8xk34hf0003z0n1a2b3c4d5',
        employeeName: 'Martha Manager',
        startTime: '2026-03-11T09:00:00.000Z',
        endTime: '2026-03-11T17:00:00.000Z',
      },
    ],
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SummaryListQuery = z.infer<typeof SummaryListQuerySchema>;
export type ApproveTaskBody = z.infer<typeof ApproveTaskBodySchema>;
export type BatchApproveBody = z.infer<typeof BatchApproveBodySchema>;
