import { z } from 'zod';

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const RELATES_TO_TYPES = ['young_person', 'vehicle', 'employee', 'home_event'] as const;

export const CreateDailyLogBodySchema = z
  .object({
    homeId: z.string().min(1),
    relatesTo: z
      .union([
        z.object({
          type: z.enum(RELATES_TO_TYPES),
          id: z.string().min(1),
        }).strict(),
        z.null(),
        z.literal(''),
        z.literal('None'),
        z.literal('none'),
      ])
      .optional()
      .transform((v) => (v && typeof v === 'object' ? v : undefined)),
    noteDate: z.union([z.string().datetime(), z.string().date()]),
    category: z.string().min(1).max(120),
    triggerTaskFormKey: z.string().max(120).optional(),
    note: z.string().min(1).max(10000),
  })
  .strict();

export const UpdateDailyLogBodySchema = z
  .object({
    homeId: z.string().min(1).optional(),
    relatesTo: z
      .object({
        type: z.enum(RELATES_TO_TYPES),
        id: z.string().min(1),
      })
      .strict()
      .nullable()
      .optional(),
    noteDate: z.union([z.string().datetime(), z.string().date()]).optional(),
    category: z.string().min(1).max(120).optional(),
    triggerTaskFormKey: z.string().max(120).nullable().optional(),
    note: z.string().min(1).max(10000).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((val) => val !== undefined), {
    message: 'At least one field must be provided.',
  });

export const ListDailyLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  homeId: z.string().min(1).optional(),
  youngPersonId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  dateFrom: z.union([z.string().datetime(), z.string().date()]).optional(),
  dateTo: z.union([z.string().datetime(), z.string().date()]).optional(),
  search: z.string().max(200).optional(),
  sortBy: z.enum(['createdAt', 'dueAt', 'title']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ─── JSON Schemas (OpenAPI) ──────────────────────────────────────────────────

export const createDailyLogBodyJson = {
  type: 'object',
  required: ['homeId', 'noteDate', 'category', 'note'],
  additionalProperties: false,
  properties: {
    homeId: { type: 'string', minLength: 1 },
    relatesTo: {
      oneOf: [
        {
          type: 'object',
          required: ['type', 'id'],
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['young_person', 'vehicle', 'employee', 'home_event'] },
            id: { type: 'string', minLength: 1 },
          },
        },
        { type: 'null' },
        { type: 'string' },
      ],
    },
    noteDate: { type: 'string' },
    category: { type: 'string', minLength: 1, maxLength: 120 },
    triggerTaskFormKey: { type: 'string', maxLength: 120 },
    note: { type: 'string', minLength: 1, maxLength: 10000 },
  },
} as const;

export const updateDailyLogBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    homeId: { type: 'string', minLength: 1 },
    relatesTo: {
      type: ['object', 'null'],
      required: ['type', 'id'],
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['young_person', 'vehicle', 'employee', 'home_event'] },
        id: { type: 'string', minLength: 1 },
      },
    },
    noteDate: { type: 'string', format: 'date-time' },
    category: { type: 'string', minLength: 1, maxLength: 120 },
    triggerTaskFormKey: { type: ['string', 'null'], maxLength: 120 },
    note: { type: 'string', minLength: 1, maxLength: 10000 },
  },
} as const;

export const listDailyLogsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    homeId: { type: 'string' },
    youngPersonId: { type: 'string' },
    vehicleId: { type: 'string' },
    dateFrom: { type: 'string', format: 'date-time' },
    dateTo: { type: 'string', format: 'date-time' },
    search: { type: 'string', maxLength: 200 },
    sortBy: { type: 'string', enum: ['createdAt', 'dueAt', 'title'], default: 'createdAt' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
  },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type CreateDailyLogBody = z.infer<typeof CreateDailyLogBodySchema>;
export type UpdateDailyLogBody = z.infer<typeof UpdateDailyLogBodySchema>;
export type ListDailyLogsQuery = z.infer<typeof ListDailyLogsQuerySchema>;
