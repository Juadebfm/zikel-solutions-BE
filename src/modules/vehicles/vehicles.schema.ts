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
  .union([z.string().datetime(), z.string().date(), z.date(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return value instanceof Date ? value : new Date(value);
  });

// ─── Query ───────────────────────────────────────────────────────────────────

export const ListVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().max(100).optional(),
  homeId: z.string().min(1).optional(),
  status: z.enum(['current', 'past', 'planned', 'all']).default('all'),
  fuelType: z.string().max(20).optional(),
  isActive: BoolishSchema.optional(),
  sortBy: VehicleSortBySchema.optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

// ─── Create ──────────────────────────────────────────────────────────────────

export const CreateVehicleBodySchema = z.object({
  homeId: z.string().min(1).optional(),
  registration: z.string().min(1).max(32),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  colour: z.string().max(50).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['current', 'past', 'planned']).default('current'),
  vin: z.string().max(50).optional(),
  registrationDate: NullableDateSchema,
  taxDate: NullableDateSchema,
  fuelType: z.string().max(20).optional(),
  insuranceDate: NullableDateSchema,
  ownership: z.string().max(50).optional(),
  leaseStartDate: NullableDateSchema,
  leaseEndDate: NullableDateSchema,
  purchasePrice: z.number().positive().optional(),
  purchaseDate: NullableDateSchema,
  startDate: NullableDateSchema,
  endDate: NullableDateSchema,
  adminUserId: z.string().min(1).optional(),
  contactPhone: z.string().max(30).optional(),
  avatarFileId: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  details: z.unknown().optional(),
  isActive: z.boolean().optional(),
  nextServiceDue: NullableDateSchema,
  motDue: NullableDateSchema,
});

// ─── Update ──────────────────────────────────────────────────────────────────

export const UpdateVehicleBodySchema = z
  .object({
    homeId: z.string().min(1).nullable().optional(),
    registration: z.string().min(1).max(32).optional(),
    make: z.string().max(100).nullable().optional(),
    model: z.string().max(100).nullable().optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    colour: z.string().max(50).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    status: z.enum(['current', 'past', 'planned']).optional(),
    vin: z.string().max(50).nullable().optional(),
    registrationDate: NullableDateSchema,
    taxDate: NullableDateSchema,
    fuelType: z.string().max(20).nullable().optional(),
    insuranceDate: NullableDateSchema,
    ownership: z.string().max(50).nullable().optional(),
    leaseStartDate: NullableDateSchema,
    leaseEndDate: NullableDateSchema,
    purchasePrice: z.number().positive().nullable().optional(),
    purchaseDate: NullableDateSchema,
    startDate: NullableDateSchema,
    endDate: NullableDateSchema,
    adminUserId: z.string().min(1).nullable().optional(),
    contactPhone: z.string().max(30).nullable().optional(),
    avatarFileId: z.string().min(1).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    details: z.unknown().nullable().optional(),
    isActive: z.boolean().optional(),
    nextServiceDue: NullableDateSchema,
    motDue: NullableDateSchema,
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

// ─── JSON Schemas (OpenAPI) ──────────────────────────────────────────────────

export const listVehiclesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 20 },
    search: { type: 'string', maxLength: 100 },
    homeId: { type: 'string' },
    status: { type: 'string', enum: ['current', 'past', 'planned', 'all'], default: 'all' },
    fuelType: { type: 'string', maxLength: 20 },
    isActive: { type: 'boolean' },
    sortBy: { type: 'string', enum: ['registration', 'make', 'model', 'nextServiceDue', 'motDue', 'createdAt', 'updatedAt'] },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
  },
} as const;

export const createVehicleBodyJson = {
  type: 'object',
  required: ['registration'],
  additionalProperties: false,
  properties: {
    homeId: { type: 'string' },
    registration: { type: 'string', minLength: 1, maxLength: 32 },
    make: { type: 'string', maxLength: 100 },
    model: { type: 'string', maxLength: 100 },
    year: { type: 'integer', minimum: 1900, maximum: 2100 },
    colour: { type: 'string', maxLength: 50 },
    description: { type: 'string', maxLength: 2000 },
    status: { type: 'string', enum: ['current', 'past', 'planned'], default: 'current' },
    vin: { type: 'string', maxLength: 50 },
    registrationDate: { type: ['string', 'null'], format: 'date-time' },
    taxDate: { type: ['string', 'null'], format: 'date-time' },
    fuelType: { type: 'string', maxLength: 20 },
    insuranceDate: { type: ['string', 'null'], format: 'date-time' },
    ownership: { type: 'string', maxLength: 50 },
    leaseStartDate: { type: ['string', 'null'], format: 'date-time' },
    leaseEndDate: { type: ['string', 'null'], format: 'date-time' },
    purchasePrice: { type: 'number', minimum: 0 },
    purchaseDate: { type: ['string', 'null'], format: 'date-time' },
    startDate: { type: ['string', 'null'], format: 'date-time' },
    endDate: { type: ['string', 'null'], format: 'date-time' },
    adminUserId: { type: 'string', minLength: 1 },
    contactPhone: { type: 'string', maxLength: 30 },
    avatarFileId: { type: 'string', minLength: 1 },
    avatarUrl: { type: 'string', format: 'uri' },
    details: {},
    isActive: { type: 'boolean' },
    nextServiceDue: { type: ['string', 'null'], format: 'date-time' },
    motDue: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

export const updateVehicleBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    homeId: { type: ['string', 'null'], minLength: 1 },
    registration: { type: 'string', minLength: 1, maxLength: 32 },
    make: { type: ['string', 'null'], maxLength: 100 },
    model: { type: ['string', 'null'], maxLength: 100 },
    year: { type: ['integer', 'null'], minimum: 1900, maximum: 2100 },
    colour: { type: ['string', 'null'], maxLength: 50 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    status: { type: 'string', enum: ['current', 'past', 'planned'] },
    vin: { type: ['string', 'null'], maxLength: 50 },
    registrationDate: { type: ['string', 'null'], format: 'date-time' },
    taxDate: { type: ['string', 'null'], format: 'date-time' },
    fuelType: { type: ['string', 'null'], maxLength: 20 },
    insuranceDate: { type: ['string', 'null'], format: 'date-time' },
    ownership: { type: ['string', 'null'], maxLength: 50 },
    leaseStartDate: { type: ['string', 'null'], format: 'date-time' },
    leaseEndDate: { type: ['string', 'null'], format: 'date-time' },
    purchasePrice: { type: ['number', 'null'], minimum: 0 },
    purchaseDate: { type: ['string', 'null'], format: 'date-time' },
    startDate: { type: ['string', 'null'], format: 'date-time' },
    endDate: { type: ['string', 'null'], format: 'date-time' },
    adminUserId: { type: ['string', 'null'], minLength: 1 },
    contactPhone: { type: ['string', 'null'], maxLength: 30 },
    avatarFileId: { type: ['string', 'null'], minLength: 1 },
    avatarUrl: { type: ['string', 'null'], format: 'uri' },
    details: {},
    isActive: { type: 'boolean' },
    nextServiceDue: { type: ['string', 'null'], format: 'date-time' },
    motDue: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ListVehiclesQuery = z.infer<typeof ListVehiclesQuerySchema>;
export type CreateVehicleBody = z.infer<typeof CreateVehicleBodySchema>;
export type UpdateVehicleBody = z.infer<typeof UpdateVehicleBodySchema>;
