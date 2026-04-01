import { z } from 'zod';

export const ListFaqsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
});

export const CreateFaqBodySchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(50_000),
  category: z.string().min(1).max(100),
  tags: z.array(z.string().max(50)).max(20).default([]),
  sortOrder: z.number().int().min(0).default(0),
  isPublished: z.boolean().default(true),
});

export const UpdateFaqBodySchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    body: z.string().min(1).max(50_000).optional(),
    category: z.string().min(1).max(100).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    sortOrder: z.number().int().min(0).optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((val) => val !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listFaqsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 200 },
    category: { type: 'string', maxLength: 100 },
  },
} as const;

export const createFaqBodyJson = {
  type: 'object',
  required: ['title', 'body', 'category'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 300 },
    body: { type: 'string', minLength: 1, maxLength: 50000 },
    category: { type: 'string', minLength: 1, maxLength: 100 },
    tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 50 } },
    sortOrder: { type: 'integer', minimum: 0, default: 0 },
    isPublished: { type: 'boolean', default: true },
  },
} as const;

export const updateFaqBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 300 },
    body: { type: 'string', minLength: 1, maxLength: 50000 },
    category: { type: 'string', minLength: 1, maxLength: 100 },
    tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 50 } },
    sortOrder: { type: 'integer', minimum: 0 },
    isPublished: { type: 'boolean' },
  },
} as const;

export type ListFaqsQuery = z.infer<typeof ListFaqsQuerySchema>;
export type CreateFaqBody = z.infer<typeof CreateFaqBodySchema>;
export type UpdateFaqBody = z.infer<typeof UpdateFaqBodySchema>;
