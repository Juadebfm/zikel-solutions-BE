import { z } from 'zod';

export const TicketStatusSchema = z.enum([
  'open',
  'in_progress',
  'waiting_on_customer',
  'resolved',
  'closed',
]);

export const TicketPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const TicketCategorySchema = z.enum([
  'bug_report',
  'feature_request',
  'account_issue',
  'billing',
  'technical_support',
  'general_question',
  'other',
]);

export const ListTicketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: TicketStatusSchema.optional(),
  priority: TicketPrioritySchema.optional(),
  category: TicketCategorySchema.optional(),
  search: z.string().max(200).optional(),
});

export const CreateTicketBodySchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(10_000),
  priority: TicketPrioritySchema.default('medium'),
  category: TicketCategorySchema.default('general_question'),
});

export const UpdateTicketBodySchema = z
  .object({
    status: TicketStatusSchema.optional(),
    priority: TicketPrioritySchema.optional(),
    category: TicketCategorySchema.optional(),
  })
  .refine((v) => Object.values(v).some((val) => val !== undefined), {
    message: 'At least one field must be provided.',
  });

export const CreateTicketCommentBodySchema = z.object({
  body: z.string().min(1).max(10_000),
  isInternal: z.boolean().default(false),
});

export const listTicketsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    status: {
      type: 'string',
      enum: ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'],
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    category: {
      type: 'string',
      enum: [
        'bug_report',
        'feature_request',
        'account_issue',
        'billing',
        'technical_support',
        'general_question',
        'other',
      ],
    },
    search: { type: 'string', maxLength: 200 },
  },
} as const;

export const createTicketBodyJson = {
  type: 'object',
  required: ['title', 'description'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 300 },
    description: { type: 'string', minLength: 1, maxLength: 10000 },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    category: {
      type: 'string',
      enum: [
        'bug_report',
        'feature_request',
        'account_issue',
        'billing',
        'technical_support',
        'general_question',
        'other',
      ],
      default: 'general_question',
    },
  },
} as const;

export const updateTicketBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    status: {
      type: 'string',
      enum: ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'],
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    category: {
      type: 'string',
      enum: [
        'bug_report',
        'feature_request',
        'account_issue',
        'billing',
        'technical_support',
        'general_question',
        'other',
      ],
    },
  },
} as const;

export const createTicketCommentBodyJson = {
  type: 'object',
  required: ['body'],
  additionalProperties: false,
  properties: {
    body: { type: 'string', minLength: 1, maxLength: 10000 },
    isInternal: { type: 'boolean', default: false },
  },
} as const;

export type ListTicketsQuery = z.infer<typeof ListTicketsQuerySchema>;
export type CreateTicketBody = z.infer<typeof CreateTicketBodySchema>;
export type UpdateTicketBody = z.infer<typeof UpdateTicketBodySchema>;
export type CreateTicketCommentBody = z.infer<typeof CreateTicketCommentBodySchema>;
