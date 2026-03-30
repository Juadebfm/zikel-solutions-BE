import { z } from 'zod';
import {
  TaskApprovalStatusSchema,
  TaskCategoryInputSchema,
  TaskPrioritySchema,
  TaskReferenceEntityTypeSchema,
  TaskReferenceTypeSchema,
  TaskStatusSchema,
  TaskExplorerTypeSchema,
} from '../tasks/tasks.schema.js';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

const NullableDateTimeSchema = z
  .union([z.string().datetime(), z.date(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return value instanceof Date ? value : new Date(value);
  });

export const FORM_STATUS_VALUES = ['draft', 'released', 'archived'] as const;
export const FORM_VISIBILITY_VALUES = ['visible', 'hidden'] as const;
export const FORM_NOTIFICATION_MODE_VALUES = ['users', 'roles'] as const;
export const FORM_TYPE_VALUES = [
  'home',
  'young_person',
  'school',
  'employee',
  'vehicle',
  'annual_leave',
  'care_group',
  'tenant',
  'other',
] as const;
export const FORM_ACKNOWLEDGEMENT_VALUES = ['no', 'optional', 'mandatory'] as const;

export const FormStatusSchema = z.enum(FORM_STATUS_VALUES);
export const FormVisibilitySchema = z.enum(FORM_VISIBILITY_VALUES);
export const FormNotificationModeSchema = z.enum(FORM_NOTIFICATION_MODE_VALUES);
export const FormTypeSchema = z.enum(FORM_TYPE_VALUES);
export const FormAcknowledgementSchema = z.enum(FORM_ACKNOWLEDGEMENT_VALUES);
export const FormSensitivitySchema = z.enum(['sensitive', 'not_sensitive']);

const BuilderSchema = z
  .object({
    version: z.coerce.number().int().min(1).default(1),
    sections: z.array(z.unknown()).default([]),
    fields: z.array(z.unknown()).default([]),
  })
  .passthrough();

const NotificationsSchema = z.object({
  mode: FormNotificationModeSchema.default('users'),
  userIds: z.array(z.string().min(1)).max(500).default([]),
  roles: z.array(z.string().min(1)).max(500).default([]),
});

const AccessSchema = z.object({
  confidentialityMode: FormNotificationModeSchema.default('users'),
  confidentialityUserIds: z.array(z.string().min(1)).max(500).default([]),
  confidentialityRoles: z.array(z.string().min(1)).max(500).default([]),
  approverMode: FormNotificationModeSchema.default('users'),
  approverUserIds: z.array(z.string().min(1)).max(500).default([]),
  approverRoles: z.array(z.string().min(1)).max(500).default([]),
});

const TriggerTaskSchema = z.object({
  enabled: z.boolean().default(false),
  followUpFormId: z.string().min(1).nullable().optional(),
  allowUserChooseTriggerTime: z.boolean().default(false),
  alwaysTriggerSameProject: z.boolean().default(false),
  restrictProjectByAssociation: z.boolean().default(false),
  restrictProjectByPermission: z.boolean().default(false),
  allowCopyPreviousTaskData: z.boolean().default(false),
});

export const ListFormsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  type: z.string().max(200).optional(),
  group: z.string().max(150).optional(),
  status: z.string().max(200).optional(),
  sortBy: z.enum(['name', 'group', 'status', 'createdAt', 'updatedAt']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const CreateFormBodySchema = z.object({
  name: z.string().min(1).max(200),
  key: z.string().min(1).max(120).optional(),
  namingConvention: z.string().min(1).max(120).optional(),
  description: z.string().max(5000).optional(),
  instructions: z.string().max(10000).optional(),
  formTypes: z.array(FormTypeSchema).max(50).default([]),
  formGroup: z.string().min(1).max(120).default('General'),
  keywords: z.array(z.string().min(1).max(80)).max(100).default([]),
  status: FormStatusSchema.default('draft'),
  visibility: FormVisibilitySchema.optional(),
  hidden: z.boolean().optional(),
  defaultTaskSensitivity: FormSensitivitySchema.default('not_sensitive'),
  isOneOff: z.boolean().default(false),
  usableInProcedure: z.boolean().default(false),
  requiresAcknowledgement: FormAcknowledgementSchema.default('no'),
  forceDisplayOnTrigger: z.boolean().default(false),
  notifications: NotificationsSchema.default({
    mode: 'users',
    userIds: [],
    roles: [],
  }),
  access: AccessSchema.default({
    confidentialityMode: 'users',
    confidentialityUserIds: [],
    confidentialityRoles: [],
    approverMode: 'users',
    approverUserIds: [],
    approverRoles: [],
  }),
  triggerTask: TriggerTaskSchema.default({
    enabled: false,
    followUpFormId: null,
    allowUserChooseTriggerTime: false,
    alwaysTriggerSameProject: false,
    restrictProjectByAssociation: false,
    restrictProjectByPermission: false,
    allowCopyPreviousTaskData: false,
  }),
  builder: BuilderSchema.default({
    version: 1,
    sections: [],
    fields: [],
  }),
});

export const UpdateFormBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    key: z.string().min(1).max(120).optional(),
    namingConvention: z.string().min(1).max(120).optional(),
    description: z.string().max(5000).nullable().optional(),
    instructions: z.string().max(10000).nullable().optional(),
    formTypes: z.array(FormTypeSchema).max(50).optional(),
    formGroup: z.string().min(1).max(120).optional(),
    keywords: z.array(z.string().min(1).max(80)).max(100).optional(),
    status: FormStatusSchema.optional(),
    visibility: FormVisibilitySchema.optional(),
    hidden: z.boolean().optional(),
    defaultTaskSensitivity: FormSensitivitySchema.optional(),
    isOneOff: z.boolean().optional(),
    usableInProcedure: z.boolean().optional(),
    requiresAcknowledgement: FormAcknowledgementSchema.optional(),
    forceDisplayOnTrigger: z.boolean().optional(),
    notifications: NotificationsSchema.optional(),
    access: AccessSchema.optional(),
    triggerTask: TriggerTaskSchema.optional(),
    builder: BuilderSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one field must be provided.',
  });

export const CloneFormBodySchema = z.object({
  key: z.string().min(1).max(120).optional(),
  namingConvention: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(200).optional(),
});

export const FormBuilderBodySchema = BuilderSchema;
export const FormAccessBodySchema = AccessSchema;
export const FormTriggerBodySchema = TriggerTaskSchema;

export const FormPreviewBodySchema = z.object({
  builder: BuilderSchema.optional(),
  sampleData: z.unknown().optional(),
});

const TaskReferenceInputSchema = z
  .object({
    type: TaskReferenceTypeSchema,
    entityType: TaskReferenceEntityTypeSchema.optional(),
    entityId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    label: z.string().max(200).optional(),
    metadata: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
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

export const FormSubmissionBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  dueAt: NullableDateTimeSchema,
  assigneeId: z.string().min(1).optional(),
  approverIds: z.array(z.string().min(1)).max(50).optional(),
  category: TaskCategoryInputSchema.optional(),
  type: TaskExplorerTypeSchema.optional(),
  relatedEntityId: z.string().min(1).optional(),
  homeId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  youngPersonId: z.string().min(1).optional(),
  priority: TaskPrioritySchema.default('medium'),
  status: TaskStatusSchema.optional(),
  approvalStatus: TaskApprovalStatusSchema.optional(),
  submissionPayload: z.unknown().default({}),
  references: z.array(TaskReferenceInputSchema).max(50).optional(),
  signatureFileId: z.string().min(1).optional(),
  attachmentFileIds: z.array(z.string().min(1)).max(50).optional(),
  submitNow: BoolishSchema.optional(),
});

export const listFormsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 200 },
    type: { type: 'string', maxLength: 200 },
    group: { type: 'string', maxLength: 150 },
    status: { type: 'string', maxLength: 200 },
    sortBy: { type: 'string', enum: ['name', 'group', 'status', 'createdAt', 'updatedAt'], default: 'updatedAt' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
  },
} as const;

export const createFormBodyJson = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    key: { type: 'string', minLength: 1, maxLength: 120 },
    namingConvention: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 5000 },
    instructions: { type: 'string', maxLength: 10000 },
    formTypes: { type: 'array', items: { type: 'string', enum: [...FORM_TYPE_VALUES] } },
    formGroup: { type: 'string', minLength: 1, maxLength: 120, default: 'General' },
    keywords: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 80 } },
    status: { type: 'string', enum: [...FORM_STATUS_VALUES], default: 'draft' },
    visibility: { type: 'string', enum: [...FORM_VISIBILITY_VALUES] },
    hidden: { type: 'boolean' },
    defaultTaskSensitivity: { type: 'string', enum: ['sensitive', 'not_sensitive'], default: 'not_sensitive' },
    isOneOff: { type: 'boolean', default: false },
    usableInProcedure: { type: 'boolean', default: false },
    requiresAcknowledgement: { type: 'string', enum: [...FORM_ACKNOWLEDGEMENT_VALUES], default: 'no' },
    forceDisplayOnTrigger: { type: 'boolean', default: false },
    notifications: { type: 'object', additionalProperties: true },
    access: { type: 'object', additionalProperties: true },
    triggerTask: { type: 'object', additionalProperties: true },
    builder: { type: 'object', additionalProperties: true },
  },
} as const;

export const updateFormBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: createFormBodyJson.properties,
  minProperties: 1,
} as const;

export const cloneFormBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 120 },
    namingConvention: { type: 'string', minLength: 1, maxLength: 120 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

export const formBuilderBodyJson = {
  type: 'object',
  additionalProperties: true,
  properties: {
    version: { type: 'integer', minimum: 1, default: 1 },
    sections: { type: 'array', items: {} },
    fields: { type: 'array', items: {} },
  },
} as const;

export const formAccessBodyJson = {
  type: 'object',
  additionalProperties: false,
  required: [
    'confidentialityMode',
    'confidentialityUserIds',
    'confidentialityRoles',
    'approverMode',
    'approverUserIds',
    'approverRoles',
  ],
  properties: {
    confidentialityMode: { type: 'string', enum: [...FORM_NOTIFICATION_MODE_VALUES] },
    confidentialityUserIds: { type: 'array', items: { type: 'string' } },
    confidentialityRoles: { type: 'array', items: { type: 'string' } },
    approverMode: { type: 'string', enum: [...FORM_NOTIFICATION_MODE_VALUES] },
    approverUserIds: { type: 'array', items: { type: 'string' } },
    approverRoles: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const formTriggerBodyJson = {
  type: 'object',
  additionalProperties: false,
  required: [
    'enabled',
    'allowUserChooseTriggerTime',
    'alwaysTriggerSameProject',
    'restrictProjectByAssociation',
    'restrictProjectByPermission',
    'allowCopyPreviousTaskData',
  ],
  properties: {
    enabled: { type: 'boolean' },
    followUpFormId: { type: ['string', 'null'] },
    allowUserChooseTriggerTime: { type: 'boolean' },
    alwaysTriggerSameProject: { type: 'boolean' },
    restrictProjectByAssociation: { type: 'boolean' },
    restrictProjectByPermission: { type: 'boolean' },
    allowCopyPreviousTaskData: { type: 'boolean' },
  },
} as const;

export const formPreviewBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    builder: { type: 'object', additionalProperties: true },
    sampleData: {},
  },
} as const;

export const formSubmissionBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 5000 },
    dueAt: { type: ['string', 'null'], format: 'date-time' },
    assigneeId: { type: 'string' },
    approverIds: { type: 'array', items: { type: 'string' } },
    category: { type: 'string' },
    type: { type: 'string' },
    relatedEntityId: { type: 'string' },
    homeId: { type: 'string' },
    vehicleId: { type: 'string' },
    youngPersonId: { type: 'string' },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    submissionPayload: {},
    references: { type: 'array', items: { type: 'object', additionalProperties: true } },
    signatureFileId: { type: 'string' },
    attachmentFileIds: { type: 'array', items: { type: 'string' } },
    submitNow: { type: 'boolean' },
  },
} as const;

export type ListFormsQuery = z.infer<typeof ListFormsQuerySchema>;
export type CreateFormBody = z.infer<typeof CreateFormBodySchema>;
export type UpdateFormBody = z.infer<typeof UpdateFormBodySchema>;
export type CloneFormBody = z.infer<typeof CloneFormBodySchema>;
export type FormBuilderBody = z.infer<typeof FormBuilderBodySchema>;
export type FormAccessBody = z.infer<typeof FormAccessBodySchema>;
export type FormTriggerBody = z.infer<typeof FormTriggerBodySchema>;
export type FormPreviewBody = z.infer<typeof FormPreviewBodySchema>;
export type FormSubmissionBody = z.infer<typeof FormSubmissionBodySchema>;
