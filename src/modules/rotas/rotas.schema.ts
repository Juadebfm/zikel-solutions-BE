import { z } from 'zod';

const DayOfWeekSchema = z.union([
  z.coerce.number().int().min(0).max(6),
  z.enum(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
]);

export const RotaShiftSchema = z.object({
  employeeId: z.string().min(1),
  dayOfWeek: DayOfWeekSchema,
  startTime: z.string().min(1).max(20),
  endTime: z.string().min(1).max(20),
  role: z.string().min(1).max(120),
});

export const ListRotasQuerySchema = z.object({
  homeId: z.string().min(1).optional(),
  weekStarting: z.coerce.date().optional(),
  employeeId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const CreateRotaBodySchema = z.object({
  homeId: z.string().min(1),
  weekStarting: z.coerce.date(),
  shifts: z.array(RotaShiftSchema).min(1).max(300),
});

export const UpdateRotaBodySchema = z
  .object({
    homeId: z.string().min(1).optional(),
    weekStarting: z.coerce.date().optional(),
    shifts: z.array(RotaShiftSchema).min(1).max(300).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided.',
  });

export const ListRotaTemplatesQuerySchema = z.object({
  homeId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const CreateRotaTemplateBodySchema = z.object({
  name: z.string().min(1).max(120),
  homeId: z.string().min(1).optional(),
  shifts: z.array(RotaShiftSchema).min(1).max(300),
});

export const listRotasQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    homeId: { type: 'string' },
    weekStarting: { type: 'string', format: 'date-time' },
    employeeId: { type: 'string' },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
} as const;

export const createRotaBodyJson = {
  type: 'object',
  required: ['homeId', 'weekStarting', 'shifts'],
  additionalProperties: false,
  properties: {
    homeId: { type: 'string' },
    weekStarting: { type: 'string', format: 'date-time' },
    shifts: {
      type: 'array',
      minItems: 1,
      maxItems: 300,
      items: {
        type: 'object',
        required: ['employeeId', 'dayOfWeek', 'startTime', 'endTime', 'role'],
        additionalProperties: false,
        properties: {
          employeeId: { type: 'string' },
          dayOfWeek: { oneOf: [{ type: 'integer', minimum: 0, maximum: 6 }, { type: 'string' }] },
          startTime: { type: 'string', maxLength: 20 },
          endTime: { type: 'string', maxLength: 20 },
          role: { type: 'string', maxLength: 120 },
        },
      },
    },
  },
} as const;

export const updateRotaBodyJson = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    homeId: { type: 'string' },
    weekStarting: { type: 'string', format: 'date-time' },
    shifts: createRotaBodyJson.properties.shifts,
  },
} as const;

export const listRotaTemplatesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    homeId: { type: 'string' },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
} as const;

export const createRotaTemplateBodyJson = {
  type: 'object',
  required: ['name', 'shifts'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    homeId: { type: 'string' },
    shifts: createRotaBodyJson.properties.shifts,
  },
} as const;

export type RotaShiftInput = z.infer<typeof RotaShiftSchema>;
export type ListRotasQuery = z.infer<typeof ListRotasQuerySchema>;
export type CreateRotaBody = z.infer<typeof CreateRotaBodySchema>;
export type UpdateRotaBody = z.infer<typeof UpdateRotaBodySchema>;
export type ListRotaTemplatesQuery = z.infer<typeof ListRotaTemplatesQuerySchema>;
export type CreateRotaTemplateBody = z.infer<typeof CreateRotaTemplateBodySchema>;
