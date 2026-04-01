import { z } from 'zod';

const WEBHOOK_EVENT_TYPES = [
  'ticket_created',
  'ticket_updated',
  'ticket_status_changed',
  'ticket_comment_added',
  'notification_broadcast',
] as const;

export const CreateWebhookBodySchema = z.object({
  url: z.string().url().max(2000),
  secret: z.string().min(16).max(256),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(20),
  description: z.string().max(500).optional(),
});

export const UpdateWebhookBodySchema = z
  .object({
    url: z.string().url().max(2000).optional(),
    secret: z.string().min(16).max(256).optional(),
    events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(20).optional(),
    description: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((val) => val !== undefined), {
    message: 'At least one field must be provided.',
  });

export const ListDeliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'delivered', 'failed']).optional(),
});

export const createWebhookBodyJson = {
  type: 'object',
  required: ['url', 'secret', 'events'],
  additionalProperties: false,
  properties: {
    url: { type: 'string', format: 'uri', maxLength: 2000 },
    secret: { type: 'string', minLength: 16, maxLength: 256 },
    events: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES] },
    },
    description: { type: 'string', maxLength: 500 },
  },
} as const;

export const updateWebhookBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    url: { type: 'string', format: 'uri', maxLength: 2000 },
    secret: { type: 'string', minLength: 16, maxLength: 256 },
    events: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES] },
    },
    description: { type: ['string', 'null'], maxLength: 500 },
    isActive: { type: 'boolean' },
  },
} as const;

export const listDeliveriesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    status: { type: 'string', enum: ['pending', 'delivered', 'failed'] },
  },
} as const;

export type CreateWebhookBody = z.infer<typeof CreateWebhookBodySchema>;
export type UpdateWebhookBody = z.infer<typeof UpdateWebhookBodySchema>;
export type ListDeliveriesQuery = z.infer<typeof ListDeliveriesQuerySchema>;
