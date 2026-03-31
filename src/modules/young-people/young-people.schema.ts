import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

const NullableDateTimeSchema = z
  .union([z.string().datetime(), z.string().date(), z.date(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    return v instanceof Date ? v : new Date(v);
  });

// ─── Query ───────────────────────────────────────────────────────────────────

export const ListYoungPeopleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  homeId: z.string().min(1).optional(),
  status: z.enum(['current', 'past', 'planned', 'all']).default('all'),
  gender: z.string().max(20).optional(),
  type: z.string().max(50).optional(),
  isActive: BoolishSchema.optional(),
});

// ─── Create ──────────────────────────────────────────────────────────────────

export const CreateYoungPersonBodySchema = z.object({
  homeId: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  preferredName: z.string().max(100).optional(),
  namePronunciation: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  dateOfBirth: IsoDateSchema.optional(),
  gender: z.string().max(20).optional(),
  ethnicity: z.string().max(200).optional(),
  religion: z.string().max(100).optional(),
  referenceNo: z.string().min(1).max(120).optional(),
  niNumber: z.string().max(20).optional(),
  roomNumber: z.string().max(20).optional(),
  status: z.enum(['current', 'past', 'planned']).default('current'),
  type: z.string().max(50).optional(),
  admissionDate: NullableDateTimeSchema,
  placementEndDate: NullableDateTimeSchema,
  avatarFileId: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  keyWorkerId: z.string().min(1).optional(),
  practiceManagerId: z.string().min(1).optional(),
  adminUserId: z.string().min(1).optional(),
  socialWorkerName: z.string().max(200).optional(),
  independentReviewingOfficer: z.string().max(200).optional(),
  placingAuthority: z.string().max(200).optional(),
  legalStatus: z.string().max(100).optional(),
  isEmergencyPlacement: z.boolean().default(false),
  isAsylumSeeker: z.boolean().default(false),
  contact: z.unknown().optional(),
  health: z.unknown().optional(),
  education: z.unknown().optional(),
});

// ─── Update ──────────────────────────────────────────────────────────────────

export const UpdateYoungPersonBodySchema = z
  .object({
    homeId: z.string().min(1).optional(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    preferredName: z.string().max(100).nullable().optional(),
    namePronunciation: z.string().max(200).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    dateOfBirth: IsoDateSchema.nullable().optional(),
    gender: z.string().max(20).nullable().optional(),
    ethnicity: z.string().max(200).nullable().optional(),
    religion: z.string().max(100).nullable().optional(),
    referenceNo: z.string().min(1).max(120).nullable().optional(),
    niNumber: z.string().max(20).nullable().optional(),
    roomNumber: z.string().max(20).nullable().optional(),
    status: z.enum(['current', 'past', 'planned']).optional(),
    type: z.string().max(50).nullable().optional(),
    admissionDate: NullableDateTimeSchema,
    placementEndDate: NullableDateTimeSchema,
    avatarFileId: z.string().min(1).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    keyWorkerId: z.string().min(1).nullable().optional(),
    practiceManagerId: z.string().min(1).nullable().optional(),
    adminUserId: z.string().min(1).nullable().optional(),
    socialWorkerName: z.string().max(200).nullable().optional(),
    independentReviewingOfficer: z.string().max(200).nullable().optional(),
    placingAuthority: z.string().max(200).nullable().optional(),
    legalStatus: z.string().max(100).nullable().optional(),
    isEmergencyPlacement: z.boolean().optional(),
    isAsylumSeeker: z.boolean().optional(),
    contact: z.unknown().nullable().optional(),
    health: z.unknown().nullable().optional(),
    education: z.unknown().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

// ─── JSON Schemas (OpenAPI) ──────────────────────────────────────────────────

export const listYoungPeopleQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 100 },
    homeId: { type: 'string' },
    status: { type: 'string', enum: ['current', 'past', 'planned', 'all'], default: 'all' },
    gender: { type: 'string', maxLength: 20 },
    type: { type: 'string', maxLength: 50 },
    isActive: { type: 'boolean' },
  },
} as const;

export const createYoungPersonBodyJson = {
  type: 'object',
  required: ['homeId', 'firstName', 'lastName'],
  additionalProperties: false,
  properties: {
    homeId: { type: 'string' },
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    lastName: { type: 'string', minLength: 1, maxLength: 100 },
    preferredName: { type: 'string', maxLength: 100 },
    namePronunciation: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    dateOfBirth: { type: 'string', format: 'date' },
    gender: { type: 'string', maxLength: 20 },
    ethnicity: { type: 'string', maxLength: 200 },
    religion: { type: 'string', maxLength: 100 },
    referenceNo: { type: 'string', minLength: 1, maxLength: 120 },
    niNumber: { type: 'string', maxLength: 20 },
    roomNumber: { type: 'string', maxLength: 20 },
    status: { type: 'string', enum: ['current', 'past', 'planned'], default: 'current' },
    type: { type: 'string', maxLength: 50 },
    admissionDate: { type: ['string', 'null'], format: 'date-time' },
    placementEndDate: { type: ['string', 'null'], format: 'date-time' },
    avatarFileId: { type: 'string', minLength: 1 },
    avatarUrl: { type: 'string', format: 'uri' },
    keyWorkerId: { type: 'string', minLength: 1 },
    practiceManagerId: { type: 'string', minLength: 1 },
    adminUserId: { type: 'string', minLength: 1 },
    socialWorkerName: { type: 'string', maxLength: 200 },
    independentReviewingOfficer: { type: 'string', maxLength: 200 },
    placingAuthority: { type: 'string', maxLength: 200 },
    legalStatus: { type: 'string', maxLength: 100 },
    isEmergencyPlacement: { type: 'boolean', default: false },
    isAsylumSeeker: { type: 'boolean', default: false },
    contact: {},
    health: {},
    education: {},
  },
} as const;

export const updateYoungPersonBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    homeId: { type: 'string' },
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    lastName: { type: 'string', minLength: 1, maxLength: 100 },
    preferredName: { type: ['string', 'null'], maxLength: 100 },
    namePronunciation: { type: ['string', 'null'], maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    dateOfBirth: { type: ['string', 'null'], format: 'date' },
    gender: { type: ['string', 'null'], maxLength: 20 },
    ethnicity: { type: ['string', 'null'], maxLength: 200 },
    religion: { type: ['string', 'null'], maxLength: 100 },
    referenceNo: { type: ['string', 'null'], minLength: 1, maxLength: 120 },
    niNumber: { type: ['string', 'null'], maxLength: 20 },
    roomNumber: { type: ['string', 'null'], maxLength: 20 },
    status: { type: 'string', enum: ['current', 'past', 'planned'] },
    type: { type: ['string', 'null'], maxLength: 50 },
    admissionDate: { type: ['string', 'null'], format: 'date-time' },
    placementEndDate: { type: ['string', 'null'], format: 'date-time' },
    avatarFileId: { type: ['string', 'null'], minLength: 1 },
    avatarUrl: { type: ['string', 'null'], format: 'uri' },
    keyWorkerId: { type: ['string', 'null'], minLength: 1 },
    practiceManagerId: { type: ['string', 'null'], minLength: 1 },
    adminUserId: { type: ['string', 'null'], minLength: 1 },
    socialWorkerName: { type: ['string', 'null'], maxLength: 200 },
    independentReviewingOfficer: { type: ['string', 'null'], maxLength: 200 },
    placingAuthority: { type: ['string', 'null'], maxLength: 200 },
    legalStatus: { type: ['string', 'null'], maxLength: 100 },
    isEmergencyPlacement: { type: 'boolean' },
    isAsylumSeeker: { type: 'boolean' },
    contact: {},
    health: {},
    education: {},
    isActive: { type: 'boolean' },
  },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ListYoungPeopleQuery = z.infer<typeof ListYoungPeopleQuerySchema>;
export type CreateYoungPersonBody = z.infer<typeof CreateYoungPersonBodySchema>;
export type UpdateYoungPersonBody = z.infer<typeof UpdateYoungPersonBodySchema>;
