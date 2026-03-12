import { z } from 'zod';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CreateTenantBodySchema = z
  .object({
    name: z.string().min(2).max(120),
    slug: z.string().min(2).max(120).regex(slugRegex).optional(),
    country: z.enum(['UK', 'Nigeria']).default('UK'),
    adminUserId: z.string().min(1).optional(),
    adminEmail: z.email().optional(),
  })
  .strict()
  .refine((v) => !(v.adminUserId && v.adminEmail), {
    message: 'Provide either adminUserId or adminEmail, not both.',
    path: ['adminUserId'],
  });

export const SelfServeCreateTenantBodySchema = z
  .object({
    name: z.string().min(2).max(120),
    slug: z.string().min(2).max(120).regex(slugRegex).optional(),
    country: z.enum(['UK', 'Nigeria']).default('UK'),
  })
  .strict();

export const ListTenantsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(120).optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .strict();

export const AddTenantMemberBodySchema = z
  .object({
    userId: z.string().min(1).optional(),
    email: z.email().optional(),
    role: z.enum(['tenant_admin', 'sub_admin', 'staff']),
    status: z.enum(['invited', 'active', 'suspended', 'revoked']).default('active'),
  })
  .strict()
  .refine((v) => Boolean(v.userId || v.email), {
    message: 'Either userId or email is required.',
    path: ['userId'],
  })
  .refine((v) => !(v.userId && v.email), {
    message: 'Provide either userId or email, not both.',
    path: ['userId'],
  });

export const UpdateTenantMemberBodySchema = z
  .object({
    role: z.enum(['tenant_admin', 'sub_admin', 'staff']).optional(),
    status: z.enum(['invited', 'active', 'suspended', 'revoked']).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

export const CreateTenantInviteBodySchema = z
  .object({
    email: z.email(),
    role: z.enum(['tenant_admin', 'sub_admin', 'staff']),
    expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  })
  .strict();

export const ListTenantMembershipsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    role: z.enum(['tenant_admin', 'sub_admin', 'staff']).optional(),
    status: z.enum(['invited', 'active', 'suspended', 'revoked']).optional(),
    search: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const AcceptTenantInviteBodySchema = z
  .object({
    token: z.string().min(20).max(256),
  })
  .strict();

export const ListTenantInvitesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']).optional(),
  })
  .strict();

export const listTenantsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', minLength: 1, maxLength: 120 },
    isActive: { type: 'boolean' },
  },
} as const;

export const createTenantBodyJson = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 120 },
    slug: {
      type: 'string',
      minLength: 2,
      maxLength: 120,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    },
    country: { type: 'string', enum: ['UK', 'Nigeria'], default: 'UK' },
    adminUserId: { type: 'string', minLength: 1 },
    adminEmail: { type: 'string', format: 'email' },
  },
  allOf: [
    {
      not: {
        required: ['adminUserId', 'adminEmail'],
      },
    },
  ],
} as const;

export const selfServeCreateTenantBodyJson = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 120 },
    slug: {
      type: 'string',
      minLength: 2,
      maxLength: 120,
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    },
    country: { type: 'string', enum: ['UK', 'Nigeria'], default: 'UK' },
  },
} as const;

export const addTenantMemberBodyJson = {
  type: 'object',
  required: ['role'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string', minLength: 1 },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['tenant_admin', 'sub_admin', 'staff'] },
    status: { type: 'string', enum: ['invited', 'active', 'suspended', 'revoked'], default: 'active' },
  },
  oneOf: [
    { required: ['userId'] },
    { required: ['email'] },
  ],
} as const;

export const updateTenantMemberBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: { type: 'string', enum: ['tenant_admin', 'sub_admin', 'staff'] },
    status: { type: 'string', enum: ['invited', 'active', 'suspended', 'revoked'] },
  },
  minProperties: 1,
} as const;

export const createTenantInviteBodyJson = {
  type: 'object',
  required: ['email', 'role'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['tenant_admin', 'sub_admin', 'staff'] },
    expiresInHours: { type: 'integer', minimum: 1, maximum: 720, default: 168 },
  },
} as const;

export const listTenantMembershipsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    role: { type: 'string', enum: ['tenant_admin', 'sub_admin', 'staff'] },
    status: { type: 'string', enum: ['invited', 'active', 'suspended', 'revoked'] },
    search: { type: 'string', minLength: 1, maxLength: 120 },
  },
} as const;

export const acceptTenantInviteBodyJson = {
  type: 'object',
  required: ['token'],
  additionalProperties: false,
  properties: {
    token: { type: 'string', minLength: 20, maxLength: 256 },
  },
} as const;

export const listTenantInvitesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    status: { type: 'string', enum: ['pending', 'accepted', 'revoked', 'expired'] },
  },
} as const;

export type CreateTenantBody = z.infer<typeof CreateTenantBodySchema>;
export type SelfServeCreateTenantBody = z.infer<typeof SelfServeCreateTenantBodySchema>;
export type ListTenantsQuery = z.infer<typeof ListTenantsQuerySchema>;
export type AddTenantMemberBody = z.infer<typeof AddTenantMemberBodySchema>;
export type UpdateTenantMemberBody = z.infer<typeof UpdateTenantMemberBodySchema>;
export type CreateTenantInviteBody = z.infer<typeof CreateTenantInviteBodySchema>;
export type ListTenantMembershipsQuery = z.infer<typeof ListTenantMembershipsQuerySchema>;
export type AcceptTenantInviteBody = z.infer<typeof AcceptTenantInviteBodySchema>;
export type ListTenantInvitesQuery = z.infer<typeof ListTenantInvitesQuerySchema>;
