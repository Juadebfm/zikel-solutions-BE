import { z } from 'zod';

const NOTIFICATION_CATEGORY_VALUES = [
  'maintenance',
  'new_feature',
  'policy_change',
  'platform_announcement',
  'task_assigned',
  'task_approved',
  'task_rejected',
  'task_completed',
  'task_overdue',
  'employee_added',
  'announcement_posted',
  'shift_changed',
  'daily_log_submitted',
  'ticket_update',
  'general',
] as const;

export const ListNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['read', 'unread', 'all']).default('all'),
  level: z.enum(['platform', 'tenant']).optional(),
  category: z.enum(NOTIFICATION_CATEGORY_VALUES).optional(),
  since: z
    .union([z.string().datetime(), z.date()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v instanceof Date ? v : new Date(v);
    }),
});

export const BroadcastNotificationBodySchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(10_000),
  category: z.enum(['maintenance', 'new_feature', 'policy_change', 'platform_announcement']).default('platform_announcement'),
  tenantIds: z.array(z.string().min(1)).max(100).optional(),
  expiresAt: z
    .union([z.string().datetime(), z.date(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return undefined;
      return v instanceof Date ? v : new Date(v);
    }),
});

export const UpdatePreferencesBodySchema = z.object({
  preferences: z
    .array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORY_VALUES),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});

export const listNotificationsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    status: { type: 'string', enum: ['read', 'unread', 'all'], default: 'all' },
    level: { type: 'string', enum: ['platform', 'tenant'] },
    category: {
      type: 'string',
      enum: [...NOTIFICATION_CATEGORY_VALUES],
    },
    since: { type: 'string', format: 'date-time' },
  },
} as const;

export const broadcastNotificationBodyJson = {
  type: 'object',
  required: ['title', 'body'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 300 },
    body: { type: 'string', minLength: 1, maxLength: 10000 },
    category: {
      type: 'string',
      enum: ['maintenance', 'new_feature', 'policy_change', 'platform_announcement'],
      default: 'platform_announcement',
    },
    tenantIds: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1 } },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

export const updatePreferencesBodyJson = {
  type: 'object',
  required: ['preferences'],
  additionalProperties: false,
  properties: {
    preferences: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        required: ['category', 'enabled'],
        additionalProperties: false,
        properties: {
          category: {
            type: 'string',
            enum: [...NOTIFICATION_CATEGORY_VALUES],
          },
          enabled: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;
export type BroadcastNotificationBody = z.infer<typeof BroadcastNotificationBodySchema>;
export type UpdatePreferencesBody = z.infer<typeof UpdatePreferencesBodySchema>;
