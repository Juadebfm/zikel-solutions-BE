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
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().optional(),
  formGroup: z.string().max(120).optional(),
  taskDateFrom: QueryDateSchema,
  taskDateTo: QueryDateSchema,
  scope: z.enum(['gate', 'popup', 'all']).default('all'),
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
  signatureFileId: z.string().min(1).optional(),
  gateScope: z.enum(['task', 'global']).default('task'),
});

export const BatchApproveBodySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, 'At least one task ID required.'),
  action: z.enum(['approve', 'reject']),
  rejectionReason: z.string().max(500).optional(),
  signatureFileId: z.string().min(1).optional(),
  gateScope: z.enum(['task', 'global']).default('global'),
});

export const ReviewTaskBodySchema = z.object({
  action: z.enum(['view_detail', 'open_document', 'open_task']).default('view_detail'),
});

// ─── JSON Schemas ─────────────────────────────────────────────────────────────

export const approveTaskBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    comment: { type: 'string', maxLength: 500, description: 'Optional approval comment' },
    signatureFileId: {
      type: 'string',
      minLength: 1,
      description: 'Optional uploaded signature file ID to attach as acknowledgement evidence.',
    },
    gateScope: {
      type: 'string',
      enum: ['task', 'global'],
      default: 'task',
      description:
        '`task` requires only the current item to be reviewed before approving. `global` enforces all overdue pending approvals reviewed first.',
    },
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
    signatureFileId: {
      type: 'string',
      minLength: 1,
      description: 'Optional uploaded signature file ID used when action=approve.',
    },
    gateScope: {
      type: 'string',
      enum: ['task', 'global'],
      default: 'global',
      description:
        '`global` blocks submit until all overdue pending approvals are reviewed. `task` enforces review only per selected task IDs.',
    },
  },
} as const;

export const reviewTaskBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['view_detail', 'open_document', 'open_task'],
      default: 'view_detail',
      description: 'How the actor reviewed the task prior to acknowledgement.',
    },
  },
} as const;

export const tasksToApproveQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 20 },
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
    scope: {
      type: 'string',
      enum: ['gate', 'popup', 'all'],
      default: 'all',
      description:
        '`gate` returns only unreviewed overdue items, `popup` returns unreviewed non-overdue items, `all` returns all pending approvals.',
    },
  },
} as const;

// ─── Response shape schemas (for OpenAPI inline definitions) ──────────────────

export const todoItemJson = {
  type: 'object',
  required: [
    'id',
    'taskRef',
    'title',
    'status',
    'approvalStatus',
    'category',
    'priority',
    'dueAt',
    'assignee',
    'createdBy',
    'relatedEntity',
    'links',
    'review',
    'timestamps',
    'references',
  ],
  properties: {
    id: { type: 'string' },
    taskRef: { type: 'string', example: 'TSK-20260321-HM5T7F' },
    requestId: { type: 'string', nullable: true, example: '9921' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    domain: { type: 'string', example: 'Compliance' },
    category: {
      type: 'string',
      enum: ['task_log', 'document', 'system_link', 'checklist', 'incident', 'other', 'daily_log', 'reward'],
    },
    categoryLabel: { type: 'string', example: 'Task Log' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    statusLabel: { type: 'string', example: 'Pending' },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    approvalStatusLabel: { type: 'string', example: 'Awaiting Approval' },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    submittedAt: { type: 'string', format: 'date-time', nullable: true },
    dueAt: { type: 'string', format: 'date-time', nullable: true },
    assignee: {},
    createdBy: {},
    approvers: { type: 'array', items: { type: 'string' } },
    relatedEntity: {},
    links: {},
    previewFields: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'value'],
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
    referenceSummary: {
      type: 'object',
      required: ['documents', 'uploads', 'links', 'entities', 'total'],
      properties: {
        documents: { type: 'integer' },
        uploads: { type: 'integer' },
        links: { type: 'integer' },
        entities: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
    review: {},
    timestamps: {},
    references: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type', 'entityType', 'entityId', 'fileId', 'url', 'label', 'metadata'],
        properties: {
          id: { type: 'string' },
          type: {
            type: 'string',
            enum: ['entity', 'upload', 'internal_route', 'external_url', 'document_url'],
          },
          entityType: {
            type: 'string',
            nullable: true,
            enum: ['tenant', 'care_group', 'home', 'young_person', 'vehicle', 'employee', 'task', null],
          },
          entityId: { type: 'string', nullable: true },
          fileId: { type: 'string', nullable: true },
          url: { type: 'string', nullable: true },
          label: { type: 'string', nullable: true },
          metadata: {},
        },
      },
    },
    attachments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'contentType', 'sizeBytes', 'purpose', 'status', 'uploadedAt'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          contentType: { type: 'string', nullable: true },
          sizeBytes: { type: 'integer' },
          purpose: { type: 'string' },
          status: { type: 'string' },
          uploadedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
    approvalChain: {
      type: 'array',
      items: {
        type: 'object',
        required: ['userId', 'name', 'status', 'respondedAt'],
        properties: {
          userId: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
          respondedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
    activityLog: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'action', 'by', 'at', 'note', 'metadata'],
        properties: {
          id: { type: 'string' },
          action: { type: 'string' },
          by: {},
          at: { type: 'string', format: 'date-time' },
          note: { type: 'string', nullable: true },
          metadata: {},
        },
      },
    },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'by', 'text', 'at'],
        properties: {
          id: { type: 'string' },
          by: {},
          text: { type: 'string' },
          at: { type: 'string', format: 'date-time' },
        },
      },
    },
    auditTrail: {
      type: 'array',
      items: {
        type: 'object',
        required: ['field', 'from', 'to', 'by', 'at'],
        properties: {
          field: { type: 'string' },
          from: { type: 'null' },
          to: { type: 'null' },
          by: { type: 'string' },
          at: { type: 'string', format: 'date-time' },
        },
      },
    },
    formData: {},
  },
} as const;

export const tasksToApproveItemJson = {
  type: 'object',
  required: [
    'id',
    'taskRef',
    'title',
    'category',
    'categoryLabel',
    'approvalStatus',
    'status',
    'priority',
    'dueAt',
    'assignee',
    'createdBy',
    'relatedEntity',
    'links',
    'context',
    'review',
    'timestamps',
    'references',
  ],
  properties: {
    id: { type: 'string' },
    taskRef: { type: 'string', example: 'TSK-20260321-HM5T7F' },
    requestId: { type: 'string', nullable: true, example: '9921' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    domain: { type: 'string', example: 'Staffing' },
    category: {
      type: 'string',
      enum: ['task_log', 'document', 'system_link', 'checklist', 'incident', 'other', 'daily_log', 'reward'],
    },
    categoryLabel: { type: 'string', example: 'Document' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    statusLabel: { type: 'string', example: 'Pending' },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    approvalStatusLabel: { type: 'string', example: 'Awaiting Approval' },
    submittedAt: { type: 'string', format: 'date-time', nullable: true },
    dueAt: { type: 'string', format: 'date-time', nullable: true },
    assignee: {},
    createdBy: {},
    requestedBy: {},
    approvers: { type: 'array', items: { type: 'string' } },
    relatedEntity: {},
    links: {},
    previewFields: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'value'],
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
    context: {
      type: 'object',
      required: [
        'formName',
        'formGroup',
        'homeOrSchool',
        'relatedTo',
        'taskDate',
        'submittedBy',
        'updatedBy',
        'summary',
      ],
      properties: {
        formName: { type: 'string', nullable: true, description: 'Originating form name.' },
        formGroup: { type: 'string', nullable: true, description: 'Form group/category label.' },
        homeOrSchool: { type: 'string', nullable: true, description: 'Resolved location context.' },
        relatedTo: { type: 'string', nullable: true, description: 'Primary related person/entity name.' },
        taskDate: { type: 'string', format: 'date-time', nullable: true, description: 'Due date used for approval queueing.' },
        submittedBy: { type: 'string', nullable: true, description: 'User that submitted/requested this item.' },
        updatedBy: { type: 'string', nullable: true, description: 'User that most recently updated this item.' },
        summary: { type: 'string', description: 'Short human-readable summary describing what this task/event is about.' },
      },
    },
    referenceSummary: {
      type: 'object',
      required: ['documents', 'uploads', 'links', 'entities', 'total'],
      properties: {
        documents: { type: 'integer' },
        uploads: { type: 'integer' },
        links: { type: 'integer' },
        entities: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
    review: {},
    timestamps: {},
    references: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type', 'entityType', 'entityId', 'fileId', 'url', 'label', 'metadata'],
        properties: {
          id: { type: 'string' },
          type: {
            type: 'string',
            enum: ['entity', 'upload', 'internal_route', 'external_url', 'document_url'],
          },
          entityType: {
            type: 'string',
            nullable: true,
            enum: ['tenant', 'care_group', 'home', 'young_person', 'vehicle', 'employee', 'task', null],
          },
          entityId: { type: 'string', nullable: true },
          fileId: { type: 'string', nullable: true },
          url: { type: 'string', nullable: true },
          label: { type: 'string', nullable: true },
          metadata: {},
        },
      },
    },
  },
} as const;

export const todoLabelsJson = {
  type: 'object',
  required: [
    'listTitle',
    'workflowStatus',
    'approvalStatus',
    'priority',
    'dueAt',
    'assignee',
    'createdBy',
    'relatedEntity',
  ],
  properties: {
    listTitle: { type: 'string', example: 'To-Do Items' },
    workflowStatus: { type: 'string', example: 'Workflow Status' },
    approvalStatus: { type: 'string', example: 'Approval Status' },
    priority: { type: 'string', example: 'Priority' },
    dueAt: { type: 'string', example: 'Due Date' },
    assignee: { type: 'string', example: 'Assignee' },
    createdBy: { type: 'string', example: 'Created By' },
    relatedEntity: { type: 'string', example: 'Related Entity' },
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
    'category',
    'categoryLabel',
    'status',
    'priority',
    'approvalStatus',
    'approvalStatusLabel',
    'meta',
    'references',
    'labels',
    'renderPayload',
    'reviewedByCurrentUser',
    'reviewedAt',
    'reviewedByCurrentUserName',
  ],
  properties: {
    id: { type: 'string' },
    taskRef: { type: 'string' },
    requestId: { type: 'string', nullable: true, example: '9921' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    domain: { type: 'string', example: 'Compliance' },
    formName: { type: 'string', nullable: true },
    formGroup: { type: 'string', nullable: true },
    category: {
      type: 'string',
      enum: ['task_log', 'document', 'system_link', 'checklist', 'incident', 'other', 'daily_log', 'reward'],
    },
    categoryLabel: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    statusLabel: { type: 'string', example: 'Pending' },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    approvalStatusLabel: { type: 'string' },
    submittedAt: { type: 'string', format: 'date-time' },
    approvers: { type: 'array', items: { type: 'string' } },
    previewFields: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'value'],
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
    referenceSummary: {
      type: 'object',
      required: ['documents', 'uploads', 'links', 'entities', 'total'],
      properties: {
        documents: { type: 'integer' },
        uploads: { type: 'integer' },
        links: { type: 'integer' },
        entities: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
    meta: {
      type: 'object',
      required: ['taskId', 'taskRef', 'submittedOn', 'updatedOn', 'approvers'],
      properties: {
        taskId: { type: 'string' },
        taskRef: { type: 'string' },
        homeId: { type: 'string', nullable: true },
        homeOrSchool: { type: 'string', nullable: true },
        vehicleId: { type: 'string', nullable: true },
        vehicleLabel: { type: 'string', nullable: true },
        relatedTo: { type: 'string', nullable: true },
        taskDate: { type: 'string', format: 'date-time', nullable: true },
        submittedOn: { type: 'string', format: 'date-time' },
        submittedBy: { type: 'string', nullable: true },
        updatedOn: { type: 'string', format: 'date-time' },
        updatedBy: { type: 'string', nullable: true },
        approvers: { type: 'array', items: { type: 'string' } },
      },
    },
    references: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type', 'entityType', 'entityId', 'fileId', 'url', 'label', 'metadata'],
        properties: {
          id: { type: 'string' },
          type: {
            type: 'string',
            enum: ['entity', 'upload', 'internal_route', 'external_url', 'document_url'],
          },
          entityType: {
            type: 'string',
            nullable: true,
            enum: ['tenant', 'care_group', 'home', 'young_person', 'vehicle', 'employee', 'task', null],
          },
          entityId: { type: 'string', nullable: true },
          fileId: { type: 'string', nullable: true },
          url: { type: 'string', nullable: true },
          label: { type: 'string', nullable: true },
          metadata: {},
        },
      },
    },
    labels: pendingApprovalLabelsJson,
    renderPayload: {
      description: 'Dynamic submitted form payload for rendering the form detail page.',
    },
    reviewedByCurrentUser: { type: 'boolean' },
    reviewedAt: { type: 'string', format: 'date-time', nullable: true },
    reviewedByCurrentUserName: { type: 'string', nullable: true },
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
export type ReviewTaskBody = z.infer<typeof ReviewTaskBodySchema>;
