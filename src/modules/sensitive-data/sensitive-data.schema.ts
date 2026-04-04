import { z } from 'zod';

const QueryDateSchema = z
  .union([z.string().datetime(), z.string().date(), z.date()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value instanceof Date ? value : new Date(value);
  });

const ConfidentialityScopeSchema = z.enum(['restricted', 'confidential', 'highly_confidential']);

export const ListSensitiveDataQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  category: z.string().max(120).optional(),
  youngPersonId: z.string().min(1).optional(),
  homeId: z.string().min(1).optional(),
  confidentialityScope: ConfidentialityScopeSchema.optional(),
  dateFrom: QueryDateSchema,
  dateTo: QueryDateSchema,
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'retentionDate']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const CreateSensitiveDataBodySchema = z.object({
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(120),
  content: z.string().min(1).max(20000),
  youngPersonId: z.string().min(1).optional(),
  homeId: z.string().min(1).optional(),
  confidentialityScope: ConfidentialityScopeSchema.default('confidential'),
  retentionDate: z.coerce.date().optional(),
  attachmentFileIds: z.array(z.string().min(1)).max(100).default([]),
});

export const UpdateSensitiveDataBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    category: z.string().min(1).max(120).optional(),
    content: z.string().min(1).max(20000).optional(),
    youngPersonId: z.string().min(1).nullable().optional(),
    homeId: z.string().min(1).nullable().optional(),
    confidentialityScope: ConfidentialityScopeSchema.optional(),
    retentionDate: z.coerce.date().nullable().optional(),
    attachmentFileIds: z.array(z.string().min(1)).max(100).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listSensitiveDataQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 200 },
    category: { type: 'string', maxLength: 120 },
    youngPersonId: { type: 'string' },
    homeId: { type: 'string' },
    confidentialityScope: { type: 'string', enum: ['restricted', 'confidential', 'highly_confidential'] },
    dateFrom: { type: 'string', format: 'date-time' },
    dateTo: { type: 'string', format: 'date-time' },
    sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'title', 'retentionDate'], default: 'createdAt' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
  },
} as const;

export const createSensitiveDataBodyJson = {
  type: 'object',
  required: ['title', 'category', 'content'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    category: { type: 'string', minLength: 1, maxLength: 120 },
    content: { type: 'string', minLength: 1, maxLength: 20000 },
    youngPersonId: { type: 'string' },
    homeId: { type: 'string' },
    confidentialityScope: { type: 'string', enum: ['restricted', 'confidential', 'highly_confidential'], default: 'confidential' },
    retentionDate: { type: 'string', format: 'date-time' },
    attachmentFileIds: { type: 'array', maxItems: 100, items: { type: 'string' }, default: [] },
  },
} as const;

export const updateSensitiveDataBodyJson = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    category: { type: 'string', minLength: 1, maxLength: 120 },
    content: { type: 'string', minLength: 1, maxLength: 20000 },
    youngPersonId: { type: ['string', 'null'] },
    homeId: { type: ['string', 'null'] },
    confidentialityScope: { type: 'string', enum: ['restricted', 'confidential', 'highly_confidential'] },
    retentionDate: { type: ['string', 'null'], format: 'date-time' },
    attachmentFileIds: { type: 'array', maxItems: 100, items: { type: 'string' } },
  },
} as const;

export type ListSensitiveDataQuery = z.infer<typeof ListSensitiveDataQuerySchema>;
export type CreateSensitiveDataBody = z.infer<typeof CreateSensitiveDataBodySchema>;
export type UpdateSensitiveDataBody = z.infer<typeof UpdateSensitiveDataBodySchema>;
