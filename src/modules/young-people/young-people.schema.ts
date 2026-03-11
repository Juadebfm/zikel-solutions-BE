import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

export const ListYoungPeopleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  homeId: z.string().min(1).optional(),
  isActive: BoolishSchema.optional(),
});

export const CreateYoungPersonBodySchema = z.object({
  homeId: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: IsoDateSchema.optional(),
  referenceNo: z.string().min(1).max(120).optional(),
});

export const UpdateYoungPersonBodySchema = z
  .object({
    homeId: z.string().min(1).optional(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    dateOfBirth: IsoDateSchema.nullable().optional(),
    referenceNo: z.string().min(1).max(120).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listYoungPeopleQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 100 },
    homeId: { type: 'string' },
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
    dateOfBirth: { type: 'string', format: 'date' },
    referenceNo: { type: 'string', minLength: 1, maxLength: 120 },
  },
} as const;

export const updateYoungPersonBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    homeId: { type: 'string' },
    firstName: { type: 'string', minLength: 1, maxLength: 100 },
    lastName: { type: 'string', minLength: 1, maxLength: 100 },
    dateOfBirth: { type: ['string', 'null'], format: 'date' },
    referenceNo: { type: ['string', 'null'], minLength: 1, maxLength: 120 },
    isActive: { type: 'boolean' },
  },
  minProperties: 1,
} as const;

export type ListYoungPeopleQuery = z.infer<typeof ListYoungPeopleQuerySchema>;
export type CreateYoungPersonBody = z.infer<typeof CreateYoungPersonBodySchema>;
export type UpdateYoungPersonBody = z.infer<typeof UpdateYoungPersonBodySchema>;
