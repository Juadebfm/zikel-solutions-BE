import { z } from 'zod';

export const ListRegionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  isActive: z.coerce.boolean().optional(),
});

export const CreateRegionBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  homeIds: z.array(z.string().min(1)).max(300).default([]),
});

export const UpdateRegionBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
    homeIds: z.array(z.string().min(1)).max(300).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listRegionsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 200 },
    isActive: { type: 'boolean' },
  },
} as const;

export const createRegionBodyJson = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 2000 },
    homeIds: { type: 'array', maxItems: 300, items: { type: 'string' }, default: [] },
  },
} as const;

export const updateRegionBodyJson = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    isActive: { type: 'boolean' },
    homeIds: { type: 'array', maxItems: 300, items: { type: 'string' } },
  },
} as const;

export type ListRegionsQuery = z.infer<typeof ListRegionsQuerySchema>;
export type CreateRegionBody = z.infer<typeof CreateRegionBodySchema>;
export type UpdateRegionBody = z.infer<typeof UpdateRegionBodySchema>;
