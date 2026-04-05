import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

// Shared optional string fields for contact/address
const contactFields = {
  type: z.string().max(100).optional(),
  managerName: z.string().max(150).optional(),
  contactName: z.string().max(150).optional(),
  phoneNumber: z.string().max(30).optional(),
  email: z.string().email().max(200).optional(),
  fax: z.string().max(30).optional(),
  website: z.string().max(300).optional(),
  addressLine1: z.string().max(300).optional(),
  addressLine2: z.string().max(300).optional(),
  city: z.string().max(100).optional(),
  county: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
} as const;

const contactFieldsJson = {
  type: { type: 'string', maxLength: 100 },
  managerName: { type: 'string', maxLength: 150 },
  contactName: { type: 'string', maxLength: 150 },
  phoneNumber: { type: 'string', maxLength: 30 },
  email: { type: 'string', format: 'email', maxLength: 200 },
  fax: { type: 'string', maxLength: 30 },
  website: { type: 'string', maxLength: 300 },
  addressLine1: { type: 'string', maxLength: 300 },
  addressLine2: { type: 'string', maxLength: 300 },
  city: { type: 'string', maxLength: 100 },
  county: { type: 'string', maxLength: 100 },
  postcode: { type: 'string', maxLength: 20 },
  country: { type: 'string', maxLength: 100 },
} as const;

const nullableContactFieldsJson = {
  type: { type: ['string', 'null'], maxLength: 100 },
  managerName: { type: ['string', 'null'], maxLength: 150 },
  contactName: { type: ['string', 'null'], maxLength: 150 },
  phoneNumber: { type: ['string', 'null'], maxLength: 30 },
  email: { type: ['string', 'null'], maxLength: 200 },
  fax: { type: ['string', 'null'], maxLength: 30 },
  website: { type: ['string', 'null'], maxLength: 300 },
  addressLine1: { type: ['string', 'null'], maxLength: 300 },
  addressLine2: { type: ['string', 'null'], maxLength: 300 },
  city: { type: ['string', 'null'], maxLength: 100 },
  county: { type: ['string', 'null'], maxLength: 100 },
  postcode: { type: ['string', 'null'], maxLength: 20 },
  country: { type: ['string', 'null'], maxLength: 100 },
} as const;

export const ListCareGroupsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  isActive: BoolishSchema.optional(),
});

export const CreateCareGroupBodySchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
  ...contactFields,
});

export const UpdateCareGroupBodySchema = z
  .object({
    name: z.string().min(1).max(150).optional(),
    description: z.string().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
    type: z.string().max(100).nullable().optional(),
    managerName: z.string().max(150).nullable().optional(),
    contactName: z.string().max(150).nullable().optional(),
    phoneNumber: z.string().max(30).nullable().optional(),
    email: z.string().email().max(200).nullable().optional(),
    fax: z.string().max(30).nullable().optional(),
    website: z.string().max(300).nullable().optional(),
    addressLine1: z.string().max(300).nullable().optional(),
    addressLine2: z.string().max(300).nullable().optional(),
    city: z.string().max(100).nullable().optional(),
    county: z.string().max(100).nullable().optional(),
    postcode: z.string().max(20).nullable().optional(),
    country: z.string().max(100).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listCareGroupsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 100 },
    isActive: { type: 'boolean' },
  },
} as const;

export const createCareGroupBodyJson = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 150 },
    description: { type: 'string', maxLength: 2000 },
    ...contactFieldsJson,
  },
} as const;

export const updateCareGroupBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 150 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    isActive: { type: 'boolean' },
    ...nullableContactFieldsJson,
  },
  minProperties: 1,
} as const;

export type ListCareGroupsQuery = z.infer<typeof ListCareGroupsQuerySchema>;
export type CreateCareGroupBody = z.infer<typeof CreateCareGroupBodySchema>;
export type UpdateCareGroupBody = z.infer<typeof UpdateCareGroupBodySchema>;
