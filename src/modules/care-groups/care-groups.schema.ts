import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const ListCareGroupsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  isActive: BoolishSchema.optional(),
});

export const CreateCareGroupBodySchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional(),
});

export const UpdateCareGroupBodySchema = z
  .object({
    name: z.string().min(1).max(150).optional(),
    description: z.string().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
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
  },
} as const;

export const updateCareGroupBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 150 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    isActive: { type: 'boolean' },
  },
  minProperties: 1,
} as const;

export type ListCareGroupsQuery = z.infer<typeof ListCareGroupsQuerySchema>;
export type CreateCareGroupBody = z.infer<typeof CreateCareGroupBodySchema>;
export type UpdateCareGroupBody = z.infer<typeof UpdateCareGroupBodySchema>;
