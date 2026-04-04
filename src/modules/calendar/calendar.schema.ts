import { z } from 'zod';

const QueryDateSchema = z
  .union([z.string().datetime(), z.string().date(), z.date()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value instanceof Date ? value : new Date(value);
  });

const EventTypeSchema = z.enum(['shift', 'appointment', 'meeting', 'deadline', 'other']);

export const ListCalendarEventsQuerySchema = z.object({
  homeId: z.string().min(1).optional(),
  dateFrom: QueryDateSchema,
  dateTo: QueryDateSchema,
  type: EventTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const CreateCalendarEventBodySchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    type: EventTypeSchema.default('other'),
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional(),
    homeId: z.string().min(1),
    attendeeIds: z.array(z.string().min(1)).max(100).default([]),
    recurrence: z.record(z.string(), z.unknown()).optional(),
    allDay: z.boolean().default(false),
  })
  .refine((value) => !value.endAt || value.endAt >= value.startAt, {
    message: 'endAt must be greater than or equal to startAt.',
    path: ['endAt'],
  });

export const UpdateCalendarEventBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    type: EventTypeSchema.optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().nullable().optional(),
    homeId: z.string().min(1).optional(),
    attendeeIds: z.array(z.string().min(1)).max(100).optional(),
    recurrence: z.record(z.string(), z.unknown()).nullable().optional(),
    allDay: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listCalendarEventsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    homeId: { type: 'string' },
    dateFrom: { type: 'string', format: 'date-time' },
    dateTo: { type: 'string', format: 'date-time' },
    type: { type: 'string', enum: ['shift', 'appointment', 'meeting', 'deadline', 'other'] },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
} as const;

export const createCalendarEventBodyJson = {
  type: 'object',
  required: ['title', 'startAt', 'homeId'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 5000 },
    type: { type: 'string', enum: ['shift', 'appointment', 'meeting', 'deadline', 'other'], default: 'other' },
    startAt: { type: 'string', format: 'date-time' },
    endAt: { type: 'string', format: 'date-time' },
    homeId: { type: 'string' },
    attendeeIds: { type: 'array', maxItems: 100, items: { type: 'string' }, default: [] },
    recurrence: { type: 'object', additionalProperties: true },
    allDay: { type: 'boolean', default: false },
  },
} as const;

export const updateCalendarEventBodyJson = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 5000 },
    type: { type: 'string', enum: ['shift', 'appointment', 'meeting', 'deadline', 'other'] },
    startAt: { type: 'string', format: 'date-time' },
    endAt: { type: ['string', 'null'], format: 'date-time' },
    homeId: { type: 'string' },
    attendeeIds: { type: 'array', maxItems: 100, items: { type: 'string' } },
    recurrence: { type: ['object', 'null'], additionalProperties: true },
    allDay: { type: 'boolean' },
  },
} as const;

export type ListCalendarEventsQuery = z.infer<typeof ListCalendarEventsQuerySchema>;
export type CreateCalendarEventBody = z.infer<typeof CreateCalendarEventBodySchema>;
export type UpdateCalendarEventBody = z.infer<typeof UpdateCalendarEventBodySchema>;
