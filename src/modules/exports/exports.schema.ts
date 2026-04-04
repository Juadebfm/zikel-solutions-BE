import { z } from 'zod';

const ExportEntitySchema = z.enum([
  'homes',
  'employees',
  'young_people',
  'vehicles',
  'care_groups',
  'tasks',
  'daily_logs',
  'audit',
]);

const ExportFormatSchema = z.enum(['pdf', 'excel', 'csv']);
const ExportStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);

export const CreateExportJobBodySchema = z.object({
  entity: ExportEntitySchema,
  filters: z.record(z.string(), z.unknown()).optional(),
  format: ExportFormatSchema.default('excel'),
});

export const ListExportJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: ExportStatusSchema.optional(),
});

export const createExportJobBodyJson = {
  type: 'object',
  required: ['entity', 'format'],
  additionalProperties: false,
  properties: {
    entity: {
      type: 'string',
      enum: ['homes', 'employees', 'young_people', 'vehicles', 'care_groups', 'tasks', 'daily_logs', 'audit'],
    },
    filters: { type: 'object', additionalProperties: true },
    format: { type: 'string', enum: ['pdf', 'excel', 'csv'], default: 'excel' },
  },
} as const;

export const listExportJobsQueryJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
  },
} as const;

export type CreateExportJobBody = z.infer<typeof CreateExportJobBodySchema>;
export type ListExportJobsQuery = z.infer<typeof ListExportJobsQuerySchema>;
