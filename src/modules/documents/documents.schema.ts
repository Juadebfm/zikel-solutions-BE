import { z } from 'zod';

const QueryDateSchema = z
  .union([z.string().datetime(), z.string().date(), z.date()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value instanceof Date ? value : new Date(value);
  });

export const ListDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  category: z.string().max(120).optional(),
  homeId: z.string().min(1).optional(),
  uploadedBy: z.string().min(1).optional(),
  dateFrom: QueryDateSchema,
  dateTo: QueryDateSchema,
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'category']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const CreateDocumentBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  category: z.string().min(1).max(120),
  fileId: z.string().min(1),
  homeId: z.string().min(1).optional(),
  visibility: z.enum(['private', 'tenant', 'home']).default('tenant'),
  tags: z.array(z.string().min(1).max(60)).max(30).default([]),
});

export const UpdateDocumentBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    category: z.string().min(1).max(120).optional(),
    fileId: z.string().min(1).optional(),
    homeId: z.string().min(1).nullable().optional(),
    visibility: z.enum(['private', 'tenant', 'home']).optional(),
    tags: z.array(z.string().min(1).max(60)).max(30).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listDocumentsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 200 },
    category: { type: 'string', maxLength: 120 },
    homeId: { type: 'string' },
    uploadedBy: { type: 'string' },
    dateFrom: { type: 'string', format: 'date-time' },
    dateTo: { type: 'string', format: 'date-time' },
    sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'title', 'category'], default: 'createdAt' },
    sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
  },
} as const;

export const createDocumentBodyJson = {
  type: 'object',
  required: ['title', 'category', 'fileId'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 5000 },
    category: { type: 'string', minLength: 1, maxLength: 120 },
    fileId: { type: 'string', minLength: 1 },
    homeId: { type: 'string', minLength: 1 },
    visibility: { type: 'string', enum: ['private', 'tenant', 'home'], default: 'tenant' },
    tags: {
      type: 'array',
      maxItems: 30,
      items: { type: 'string', minLength: 1, maxLength: 60 },
      default: [],
    },
  },
} as const;

export const updateDocumentBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 5000 },
    category: { type: 'string', minLength: 1, maxLength: 120 },
    fileId: { type: 'string', minLength: 1 },
    homeId: { type: ['string', 'null'], minLength: 1 },
    visibility: { type: 'string', enum: ['private', 'tenant', 'home'] },
    tags: {
      type: 'array',
      maxItems: 30,
      items: { type: 'string', minLength: 1, maxLength: 60 },
    },
  },
} as const;

export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;
export type CreateDocumentBody = z.infer<typeof CreateDocumentBodySchema>;
export type UpdateDocumentBody = z.infer<typeof UpdateDocumentBodySchema>;
