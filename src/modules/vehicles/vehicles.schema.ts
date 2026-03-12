import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

const VehicleSortBySchema = z.enum([
  'registration',
  'make',
  'model',
  'nextServiceDue',
  'motDue',
  'createdAt',
  'updatedAt',
]);

const NullableDateSchema = z
  .union([z.string().datetime(), z.date(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return value instanceof Date ? value : new Date(value);
  });

export const ListVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  isActive: BoolishSchema.optional(),
  sortBy: VehicleSortBySchema.optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const CreateVehicleBodySchema = z.object({
  registration: z.string().min(1).max(32),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  colour: z.string().max(50).optional(),
  isActive: z.boolean().optional(),
  nextServiceDue: NullableDateSchema,
  motDue: NullableDateSchema,
});

export const UpdateVehicleBodySchema = z
  .object({
    registration: z.string().min(1).max(32).optional(),
    make: z.string().max(100).nullable().optional(),
    model: z.string().max(100).nullable().optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    colour: z.string().max(50).nullable().optional(),
    isActive: z.boolean().optional(),
    nextServiceDue: NullableDateSchema,
    motDue: NullableDateSchema,
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listVehiclesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 100 },
    isActive: { type: 'boolean' },
    sortBy: {
      type: 'string',
      enum: ['registration', 'make', 'model', 'nextServiceDue', 'motDue', 'createdAt', 'updatedAt'],
    },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
  },
} as const;

export const createVehicleBodyJson = {
  type: 'object',
  required: ['registration'],
  additionalProperties: false,
  properties: {
    registration: { type: 'string', minLength: 1, maxLength: 32 },
    make: { type: 'string', maxLength: 100 },
    model: { type: 'string', maxLength: 100 },
    year: { type: 'integer', minimum: 1900, maximum: 2100 },
    colour: { type: 'string', maxLength: 50 },
    isActive: { type: 'boolean' },
    nextServiceDue: { type: ['string', 'null'], format: 'date-time' },
    motDue: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

export const updateVehicleBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    registration: { type: 'string', minLength: 1, maxLength: 32 },
    make: { type: ['string', 'null'], maxLength: 100 },
    model: { type: ['string', 'null'], maxLength: 100 },
    year: { type: ['integer', 'null'], minimum: 1900, maximum: 2100 },
    colour: { type: ['string', 'null'], maxLength: 50 },
    isActive: { type: 'boolean' },
    nextServiceDue: { type: ['string', 'null'], format: 'date-time' },
    motDue: { type: ['string', 'null'], format: 'date-time' },
  },
  minProperties: 1,
} as const;

export type ListVehiclesQuery = z.infer<typeof ListVehiclesQuerySchema>;
export type CreateVehicleBody = z.infer<typeof CreateVehicleBodySchema>;
export type UpdateVehicleBody = z.infer<typeof UpdateVehicleBodySchema>;
