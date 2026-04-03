import { z } from 'zod';

export const EvidencePackTypeSchema = z.enum(['reg44', 'reg45']);

export const EvidencePackQuerySchema = z
  .object({
    homeId: z.string().min(1).optional(),
    dateFrom: z.union([z.string().datetime(), z.string().date()]).optional(),
    dateTo: z.union([z.string().datetime(), z.string().date()]).optional(),
    maxEvidenceItems: z.coerce.number().int().min(10).max(1000).default(200),
    format: z.enum(['json', 'pdf', 'excel', 'zip']).default('json'),
  })
  .strict();

export const evidencePackQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    homeId: { type: 'string', minLength: 1 },
    dateFrom: { type: 'string' },
    dateTo: { type: 'string' },
    maxEvidenceItems: { type: 'integer', minimum: 10, maximum: 1000, default: 200 },
    format: { type: 'string', enum: ['json', 'pdf', 'excel', 'zip'], default: 'json' },
  },
} as const;

export const RiDashboardMetricSchema = z.enum([
  'compliance',
  'safeguarding_risk',
  'staffing_pressure',
  'action_completion',
]);

const DateQuerySchema = z.union([z.string().datetime(), z.string().date()]);

export const RiDashboardQuerySchema = z
  .object({
    homeId: z.string().min(1).optional(),
    careGroupId: z.string().min(1).optional(),
    dateFrom: DateQuerySchema.optional(),
    dateTo: DateQuerySchema.optional(),
    format: z.enum(['json', 'pdf', 'excel']).default('json'),
  })
  .strict();

export const riDashboardQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    homeId: { type: 'string', minLength: 1 },
    careGroupId: { type: 'string', minLength: 1 },
    dateFrom: { type: 'string' },
    dateTo: { type: 'string' },
    format: { type: 'string', enum: ['json', 'pdf', 'excel'], default: 'json' },
  },
} as const;

export const RiDashboardDrilldownQuerySchema = z
  .object({
    metric: RiDashboardMetricSchema,
    homeId: z.string().min(1).optional(),
    careGroupId: z.string().min(1).optional(),
    dateFrom: DateQuerySchema.optional(),
    dateTo: DateQuerySchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(20),
    format: z.enum(['json', 'pdf', 'excel']).default('json'),
  })
  .strict();

export const riDashboardDrilldownQueryJson = {
  type: 'object',
  additionalProperties: false,
  required: ['metric'],
  properties: {
    metric: {
      type: 'string',
      enum: ['compliance', 'safeguarding_risk', 'staffing_pressure', 'action_completion'],
    },
    homeId: { type: 'string', minLength: 1 },
    careGroupId: { type: 'string', minLength: 1 },
    dateFrom: { type: 'string' },
    dateTo: { type: 'string' },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
    format: { type: 'string', enum: ['json', 'pdf', 'excel'], default: 'json' },
  },
} as const;

export type EvidencePackType = z.infer<typeof EvidencePackTypeSchema>;
export type EvidencePackQuery = z.infer<typeof EvidencePackQuerySchema>;
export type RiDashboardQuery = z.infer<typeof RiDashboardQuerySchema>;
export type RiDashboardMetric = z.infer<typeof RiDashboardMetricSchema>;
export type RiDashboardDrilldownQuery = z.infer<typeof RiDashboardDrilldownQuerySchema>;
