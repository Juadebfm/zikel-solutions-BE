import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

// ─── Query ───────────────────────────────────────────────────────────────────

export const ListRolesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().max(100).optional(),
  isActive: BoolishSchema.optional(),
});

// ─── Create ──────────────────────────────────────────────────────────────────

export const CreateRoleBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

// ─── Update ──────────────────────────────────────────────────────────────────

export const UpdateRoleBodySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    permissions: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

// ─── JSON Schemas (OpenAPI) ──────────────────────────────────────────────────

export const listRolesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    search: { type: 'string', maxLength: 100 },
    isActive: { type: 'boolean' },
  },
} as const;

export const createRoleBodyJson = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    permissions: { type: 'object', additionalProperties: true },
    isActive: { type: 'boolean', default: true },
  },
} as const;

export const updateRoleBodyJson = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: ['string', 'null'], maxLength: 500 },
    permissions: { type: 'object', additionalProperties: true },
    isActive: { type: 'boolean' },
  },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ListRolesQuery = z.infer<typeof ListRolesQuerySchema>;
export type CreateRoleBody = z.infer<typeof CreateRoleBodySchema>;
export type UpdateRoleBody = z.infer<typeof UpdateRoleBodySchema>;
