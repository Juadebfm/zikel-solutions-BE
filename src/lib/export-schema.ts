import { z } from 'zod';

export const ExportFormatSchema = z.enum(['pdf', 'excel', 'csv']);

export const exportQueryJson = {
  type: 'object',
  additionalProperties: true,
  properties: {
    format: { type: 'string', enum: ['pdf', 'excel', 'csv'], default: 'pdf' },
  },
} as const;

export type ExportFormat = z.infer<typeof ExportFormatSchema>;
