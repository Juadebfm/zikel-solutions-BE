import { z } from 'zod';

const BoolishSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const ListEmployeesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  homeId: z.string().min(1).optional(),
  isActive: BoolishSchema.optional(),
});

export const CreateEmployeeBodySchema = z.object({
  userId: z.string().min(1),
  homeId: z.string().min(1).optional(),
  jobTitle: z.string().max(150).optional(),
  startDate: z.iso.datetime().optional(),
  isActive: z.boolean().optional(),
});

export const UpdateEmployeeBodySchema = z
  .object({
    homeId: z.string().min(1).nullable().optional(),
    jobTitle: z.string().max(150).nullable().optional(),
    startDate: z.iso.datetime().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'At least one field must be provided.',
  });

export const listEmployeesQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 100 },
    homeId: { type: 'string' },
    isActive: { type: 'boolean' },
  },
} as const;

export const createEmployeeBodyJson = {
  type: 'object',
  required: ['userId'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string' },
    homeId: { type: 'string' },
    jobTitle: { type: 'string', maxLength: 150 },
    startDate: { type: 'string', format: 'date-time' },
    isActive: { type: 'boolean' },
  },
} as const;

export const updateEmployeeBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    homeId: { type: ['string', 'null'] },
    jobTitle: { type: ['string', 'null'], maxLength: 150 },
    startDate: { type: ['string', 'null'], format: 'date-time' },
    isActive: { type: 'boolean' },
  },
  minProperties: 1,
} as const;

export type ListEmployeesQuery = z.infer<typeof ListEmployeesQuerySchema>;
export type CreateEmployeeBody = z.infer<typeof CreateEmployeeBodySchema>;
export type UpdateEmployeeBody = z.infer<typeof UpdateEmployeeBodySchema>;
