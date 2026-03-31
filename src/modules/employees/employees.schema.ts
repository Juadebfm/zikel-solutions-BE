import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

const NullableDateTimeSchema = z
  .union([z.string().datetime(), z.string().date(), z.date(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return v instanceof Date ? v : new Date(v);
  });

// ─── Query ───────────────────────────────────────────────────────────────────

export const ListEmployeesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  homeId: z.string().min(1).optional(),
  status: z.enum(['current', 'past', 'planned', 'all']).default('all'),
  roleId: z.string().min(1).optional(),
  isActive: BoolishSchema.optional(),
});

// ─── Create ──────────────────────────────────────────────────────────────────

export const CreateEmployeeBodySchema = z.object({
  userId: z.string().min(1),
  homeId: z.string().min(1).optional(),
  roleId: z.string().min(1).optional(),
  jobTitle: z.string().max(150).optional(),
  startDate: NullableDateTimeSchema,
  endDate: NullableDateTimeSchema,
  status: z.enum(['current', 'past', 'planned']).default('current'),
  contractType: z.string().max(50).optional(),
  dbsNumber: z.string().max(50).optional(),
  dbsDate: NullableDateTimeSchema,
  qualifications: z.unknown().optional(),
  isActive: z.boolean().optional(),
});

// ─── Update ──────────────────────────────────────────────────────────────────

export const UpdateEmployeeBodySchema = z
  .object({
    homeId: z.string().min(1).nullable().optional(),
    roleId: z.string().min(1).nullable().optional(),
    jobTitle: z.string().max(150).nullable().optional(),
    startDate: NullableDateTimeSchema,
    endDate: NullableDateTimeSchema,
    status: z.enum(['current', 'past', 'planned']).optional(),
    contractType: z.string().max(50).nullable().optional(),
    dbsNumber: z.string().max(50).nullable().optional(),
    dbsDate: NullableDateTimeSchema,
    qualifications: z.unknown().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

// ─── JSON Schemas (OpenAPI) ──────────────────────────────────────────────────

export const listEmployeesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 100 },
    homeId: { type: 'string' },
    status: { type: 'string', enum: ['current', 'past', 'planned', 'all'], default: 'all' },
    roleId: { type: 'string' },
    isActive: { type: 'boolean' },
  },
} as const;

export const createEmployeeBodyJson = {
  type: 'object',
  required: ['userId'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string' },
    homeId: { type: 'string' },
    roleId: { type: 'string' },
    jobTitle: { type: 'string', maxLength: 150 },
    startDate: { type: ['string', 'null'], format: 'date-time' },
    endDate: { type: ['string', 'null'], format: 'date-time' },
    status: { type: 'string', enum: ['current', 'past', 'planned'], default: 'current' },
    contractType: { type: 'string', maxLength: 50 },
    dbsNumber: { type: 'string', maxLength: 50 },
    dbsDate: { type: ['string', 'null'], format: 'date-time' },
    qualifications: {},
    isActive: { type: 'boolean' },
  },
} as const;

export const updateEmployeeBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    homeId: { type: ['string', 'null'] },
    roleId: { type: ['string', 'null'] },
    jobTitle: { type: ['string', 'null'], maxLength: 150 },
    startDate: { type: ['string', 'null'], format: 'date-time' },
    endDate: { type: ['string', 'null'], format: 'date-time' },
    status: { type: 'string', enum: ['current', 'past', 'planned'] },
    contractType: { type: ['string', 'null'], maxLength: 50 },
    dbsNumber: { type: ['string', 'null'], maxLength: 50 },
    dbsDate: { type: ['string', 'null'], format: 'date-time' },
    qualifications: {},
    isActive: { type: 'boolean' },
  },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ListEmployeesQuery = z.infer<typeof ListEmployeesQuerySchema>;
export type CreateEmployeeBody = z.infer<typeof CreateEmployeeBodySchema>;
export type UpdateEmployeeBody = z.infer<typeof UpdateEmployeeBodySchema>;
