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

export const AI_PAGE_VALUES = [
  'summary',
  'tasks',
  'daily_logs',
  'care_groups',
  'homes',
  'young_people',
  'employees',
  'vehicles',
  'form_designer',
  'users',
  'audit',
] as const;

export type AiPage = (typeof AI_PAGE_VALUES)[number];

const PageItemSchema = z
  .object({
    id: z.string().max(64).optional(),
    title: z.string().min(1).max(300),
    status: z.string().max(50).optional(),
    priority: z.string().max(20).optional(),
    category: z.string().max(50).optional(),
    type: z.string().max(50).optional(),
    dueDate: z.string().max(64).nullable().optional(),
    assignee: z.string().max(120).optional(),
    home: z.string().max(120).optional(),
    extra: z.record(z.string(), z.string().max(200)).optional(),
  })
  .strict();

export const AskAiBodySchema = z
  .object({
    query: z.string().min(3).max(1200),
    page: z.enum(AI_PAGE_VALUES).default('summary'),
    displayMode: z.enum(['auto', 'standard', 'minimal']).default('auto'),
    context: z
      .object({
        stats: SummaryStatsContextSchema.optional(),
        todos: z.array(SummaryListItemContextSchema).max(10).optional(),
        tasksToApprove: z.array(SummaryListItemContextSchema).max(10).optional(),
        items: z.array(PageItemSchema).max(25).optional(),
        filters: z.record(z.string(), z.string().max(200)).optional(),
        meta: z
          .object({
            total: z.number().int().min(0).optional(),
            page: z.number().int().min(1).optional(),
            pageSize: z.number().int().min(1).optional(),
            totalPages: z.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const SetAiAccessBodySchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const askAiBodyJson = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: {
    query: { type: 'string', minLength: 3, maxLength: 1200 },
    page: {
      type: 'string',
      enum: ['summary', 'tasks', 'daily_logs', 'care_groups', 'homes', 'young_people', 'employees', 'vehicles', 'form_designer', 'users', 'audit'],
      default: 'summary',
    },
    displayMode: {
      type: 'string',
      enum: ['auto', 'standard', 'minimal'],
      default: 'auto',
    },
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
        items: {
          type: 'array',
          maxItems: 25,
          items: {
            type: 'object',
            required: ['title'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', maxLength: 64 },
              title: { type: 'string', minLength: 1, maxLength: 300 },
              status: { type: 'string', maxLength: 50 },
              priority: { type: 'string', maxLength: 20 },
              category: { type: 'string', maxLength: 50 },
              type: { type: 'string', maxLength: 50 },
              dueDate: { type: ['string', 'null'], maxLength: 64 },
              assignee: { type: 'string', maxLength: 120 },
              home: { type: 'string', maxLength: 120 },
              extra: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 } },
            },
          },
        },
        filters: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 } },
        meta: {
          type: 'object',
          additionalProperties: false,
          properties: {
            total: { type: 'integer', minimum: 0 },
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1 },
            totalPages: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
  },
} as const;

export const setAiAccessBodyJson = {
  type: 'object',
  required: ['enabled'],
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
  },
} as const;

export type AskAiBody = z.infer<typeof AskAiBodySchema>;
export type SetAiAccessBody = z.infer<typeof SetAiAccessBodySchema>;
