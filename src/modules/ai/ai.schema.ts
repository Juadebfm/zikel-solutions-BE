import { z } from 'zod';

const SummaryStatsContextSchema = z
  .object({
    overdue: z.number().int().min(0).optional(),
    dueToday: z.number().int().min(0).optional(),
    pendingApproval: z.number().int().min(0).optional(),
    rejected: z.number().int().min(0).optional(),
    draft: z.number().int().min(0).optional(),
    future: z.number().int().min(0).optional(),
    comments: z.number().int().min(0).optional(),
    rewards: z.number().int().min(0).optional(),
  })
  .strict();

const SummaryListItemContextSchema = z
  .object({
    title: z.string().min(1).max(200),
    status: z.string().min(1).max(50).optional(),
    priority: z.string().min(1).max(20).optional(),
    dueDate: z.string().max(64).nullable().optional(),
  })
  .strict();

export const AskAiBodySchema = z
  .object({
    query: z.string().min(3).max(1200),
    page: z.enum(['summary']).default('summary'),
    context: z
      .object({
        stats: SummaryStatsContextSchema.optional(),
        todos: z.array(SummaryListItemContextSchema).max(10).optional(),
        tasksToApprove: z.array(SummaryListItemContextSchema).max(10).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const askAiBodyJson = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: {
    query: { type: 'string', minLength: 3, maxLength: 1200 },
    page: { type: 'string', enum: ['summary'], default: 'summary' },
    context: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stats: {
          type: 'object',
          additionalProperties: false,
          properties: {
            overdue: { type: 'integer', minimum: 0 },
            dueToday: { type: 'integer', minimum: 0 },
            pendingApproval: { type: 'integer', minimum: 0 },
            rejected: { type: 'integer', minimum: 0 },
            draft: { type: 'integer', minimum: 0 },
            future: { type: 'integer', minimum: 0 },
            comments: { type: 'integer', minimum: 0 },
            rewards: { type: 'integer', minimum: 0 },
          },
        },
        todos: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            required: ['title'],
            additionalProperties: false,
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 200 },
              status: { type: 'string', minLength: 1, maxLength: 50 },
              priority: { type: 'string', minLength: 1, maxLength: 20 },
              dueDate: { type: ['string', 'null'], maxLength: 64 },
            },
          },
        },
        tasksToApprove: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            required: ['title'],
            additionalProperties: false,
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 200 },
              status: { type: 'string', minLength: 1, maxLength: 50 },
              priority: { type: 'string', minLength: 1, maxLength: 20 },
              dueDate: { type: ['string', 'null'], maxLength: 64 },
            },
          },
        },
      },
    },
  },
} as const;

export type AskAiBody = z.infer<typeof AskAiBodySchema>;
