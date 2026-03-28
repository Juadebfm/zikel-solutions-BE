import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const ListHomesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().max(100).optional(),
  careGroupId: z.string().min(1).optional(),
  isActive: BoolishSchema.optional(),
});

export const CreateHomeBodySchema = z.object({
  careGroupId: z.string().min(1),
  name: z.string().min(1).max(150),
  address: z.string().max(300).optional(),
  capacity: z.number().int().positive().max(1000).optional(),
  avatarFileId: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  details: z.unknown().optional(),
});

export const UpdateHomeBodySchema = z
  .object({
    careGroupId: z.string().min(1).optional(),
    name: z.string().min(1).max(150).optional(),
    address: z.string().max(300).nullable().optional(),
    capacity: z.number().int().positive().max(1000).nullable().optional(),
    avatarFileId: z.string().min(1).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    details: z.unknown().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listHomesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 20 },
    search: { type: 'string', maxLength: 100 },
    careGroupId: { type: 'string' },
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
    address: { type: 'string', maxLength: 300 },
    capacity: { type: 'integer', minimum: 1, maximum: 1000 },
    avatarFileId: { type: 'string', minLength: 1 },
    avatarUrl: { type: 'string', format: 'uri' },
    details: {},
  },
} as const;

export const updateHomeBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    careGroupId: { type: 'string' },
    name: { type: 'string', minLength: 1, maxLength: 150 },
    address: { type: ['string', 'null'], maxLength: 300 },
    capacity: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
    avatarFileId: { type: ['string', 'null'], minLength: 1 },
    avatarUrl: { type: ['string', 'null'], format: 'uri' },
    details: {},
    isActive: { type: 'boolean' },
  },
  minProperties: 1,
} as const;

export type ListHomesQuery = z.infer<typeof ListHomesQuerySchema>;
export type CreateHomeBody = z.infer<typeof CreateHomeBodySchema>;
export type UpdateHomeBody = z.infer<typeof UpdateHomeBodySchema>;
