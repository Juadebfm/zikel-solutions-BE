import { z } from 'zod';

const GroupingTypeSchema = z.enum(['operational', 'reporting', 'custom']);
const GroupingEntityTypeSchema = z.enum(['home', 'employee', 'care_group']);

export const ListGroupingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  type: GroupingTypeSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});

export const CreateGroupingBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  type: GroupingTypeSchema.default('custom'),
  entityType: GroupingEntityTypeSchema,
  entityIds: z.array(z.string().min(1)).max(500).default([]),
});

export const UpdateGroupingBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    type: GroupingTypeSchema.optional(),
    entityType: GroupingEntityTypeSchema.optional(),
    entityIds: z.array(z.string().min(1)).max(500).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listGroupingsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 200 },
    type: { type: 'string', enum: ['operational', 'reporting', 'custom'] },
    isActive: { type: 'boolean' },
  },
} as const;

export const createGroupingBodyJson = {
  type: 'object',
  required: ['name', 'entityType'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 2000 },
    type: { type: 'string', enum: ['operational', 'reporting', 'custom'], default: 'custom' },
    entityType: { type: 'string', enum: ['home', 'employee', 'care_group'] },
    entityIds: { type: 'array', maxItems: 500, items: { type: 'string' }, default: [] },
  },
} as const;

export const updateGroupingBodyJson = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: ['string', 'null'], maxLength: 2000 },
    type: { type: 'string', enum: ['operational', 'reporting', 'custom'] },
    entityType: { type: 'string', enum: ['home', 'employee', 'care_group'] },
    entityIds: { type: 'array', maxItems: 500, items: { type: 'string' } },
    isActive: { type: 'boolean' },
  },
} as const;

export type ListGroupingsQuery = z.infer<typeof ListGroupingsQuerySchema>;
export type CreateGroupingBody = z.infer<typeof CreateGroupingBodySchema>;
export type UpdateGroupingBody = z.infer<typeof UpdateGroupingBodySchema>;
