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

export const ListHomesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().max(100).optional(),
  careGroupId: z.string().min(1).optional(),
  status: z.enum(['current', 'past', 'planned', 'all']).default('all'),
  isActive: BoolishSchema.optional(),
});

// ─── Create ──────────────────────────────────────────────────────────────────

export const CreateHomeBodySchema = z.object({
  careGroupId: z.string().min(1),
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  address: z.string().max(300).optional(),
  postCode: z.string().max(20).optional(),
  capacity: z.number().int().positive().max(1000).optional(),
  category: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  status: z.enum(['current', 'past', 'planned']).default('current'),
  phoneNumber: z.string().max(30).optional(),
  email: z.string().email().optional(),
  avatarFileId: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  adminUserId: z.string().min(1).optional(),
  personInChargeId: z.string().min(1).optional(),
  responsibleIndividualId: z.string().min(1).optional(),
  startDate: NullableDateTimeSchema,
  endDate: NullableDateTimeSchema,
  isSecure: z.boolean().default(false),
  shortTermStays: z.boolean().default(false),
  minAgeGroup: z.number().int().min(0).max(25).optional(),
  maxAgeGroup: z.number().int().min(0).max(25).optional(),
  ofstedUrn: z.string().max(50).optional(),
  compliance: z.unknown().optional(),
  details: z.unknown().optional(),
});

// ─── Update ──────────────────────────────────────────────────────────────────

export const UpdateHomeBodySchema = z
  .object({
    careGroupId: z.string().min(1).optional(),
    name: z.string().min(1).max(150).optional(),
    description: z.string().max(2000).nullable().optional(),
    address: z.string().max(300).nullable().optional(),
    postCode: z.string().max(20).nullable().optional(),
    capacity: z.number().int().positive().max(1000).nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    region: z.string().max(100).nullable().optional(),
    status: z.enum(['current', 'past', 'planned']).optional(),
    phoneNumber: z.string().max(30).nullable().optional(),
    email: z.string().email().nullable().optional(),
    avatarFileId: z.string().min(1).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    adminUserId: z.string().min(1).nullable().optional(),
    personInChargeId: z.string().min(1).nullable().optional(),
    responsibleIndividualId: z.string().min(1).nullable().optional(),
    startDate: NullableDateTimeSchema,
    endDate: NullableDateTimeSchema,
    isSecure: z.boolean().optional(),
    shortTermStays: z.boolean().optional(),
    minAgeGroup: z.number().int().min(0).max(25).nullable().optional(),
    maxAgeGroup: z.number().int().min(0).max(25).nullable().optional(),
    ofstedUrn: z.string().max(50).nullable().optional(),
    compliance: z.unknown().nullable().optional(),
    details: z.unknown().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

// ─── JSON Schemas (OpenAPI) ──────────────────────────────────────────────────

export const listHomesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 20 },
    search: { type: 'string', maxLength: 100 },
    careGroupId: { type: 'string' },
    status: { type: 'string', enum: ['current', 'past', 'planned', 'all'], default: 'all' },
    isActive: { type: 'boolean' },
  },
} as const;

export const createHomeBodyJson = {
  type: 'object',
  required: ['careGroupId', 'name'],
  additionalProperties: false,
  properties: {
    careGroupId: { type: 'string' },
    name: { type: 'string', minLength: 1, maxLength: 150 },
    description: { type: 'string', maxLength: 2000 },
    address: { type: 'string', maxLength: 300 },
    postCode: { type: 'string', maxLength: 20 },
    capacity: { type: 'integer', minimum: 1, maximum: 1000 },
    category: { type: 'string', maxLength: 100 },
    region: { type: 'string', maxLength: 100 },
    status: { type: 'string', enum: ['current', 'past', 'planned'], default: 'current' },
    phoneNumber: { type: 'string', maxLength: 30 },
    email: { type: 'string', format: 'email' },
    avatarFileId: { type: 'string', minLength: 1 },
    avatarUrl: { type: 'string', format: 'uri' },
    adminUserId: { type: 'string', minLength: 1 },
    personInChargeId: { type: 'string', minLength: 1 },
    responsibleIndividualId: { type: 'string', minLength: 1 },
    startDate: { type: ['string', 'null'], format: 'date-time' },
    endDate: { type: ['string', 'null'], format: 'date-time' },
    isSecure: { type: 'boolean', default: false },
    shortTermStays: { type: 'boolean', default: false },
    minAgeGroup: { type: 'integer', minimum: 0, maximum: 25 },
    maxAgeGroup: { type: 'integer', minimum: 0, maximum: 25 },
    ofstedUrn: { type: 'string', maxLength: 50 },
    compliance: {},
    details: {},
  },
} as const;

export const updateHomeBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    careGroupId: { type: 'string' },
    name: { type: 'string', minLength: 1, maxLength: 150 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    address: { type: ['string', 'null'], maxLength: 300 },
    postCode: { type: ['string', 'null'], maxLength: 20 },
    capacity: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
    category: { type: ['string', 'null'], maxLength: 100 },
    region: { type: ['string', 'null'], maxLength: 100 },
    status: { type: 'string', enum: ['current', 'past', 'planned'] },
    phoneNumber: { type: ['string', 'null'], maxLength: 30 },
    email: { type: ['string', 'null'], format: 'email' },
    avatarFileId: { type: ['string', 'null'], minLength: 1 },
    avatarUrl: { type: ['string', 'null'], format: 'uri' },
    adminUserId: { type: ['string', 'null'], minLength: 1 },
    personInChargeId: { type: ['string', 'null'], minLength: 1 },
    responsibleIndividualId: { type: ['string', 'null'], minLength: 1 },
    startDate: { type: ['string', 'null'], format: 'date-time' },
    endDate: { type: ['string', 'null'], format: 'date-time' },
    isSecure: { type: 'boolean' },
    shortTermStays: { type: 'boolean' },
    minAgeGroup: { type: ['integer', 'null'], minimum: 0, maximum: 25 },
    maxAgeGroup: { type: ['integer', 'null'], minimum: 0, maximum: 25 },
    ofstedUrn: { type: ['string', 'null'], maxLength: 50 },
    compliance: {},
    details: {},
    isActive: { type: 'boolean' },
  },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ListHomesQuery = z.infer<typeof ListHomesQuerySchema>;
export type CreateHomeBody = z.infer<typeof CreateHomeBodySchema>;
export type UpdateHomeBody = z.infer<typeof UpdateHomeBodySchema>;
