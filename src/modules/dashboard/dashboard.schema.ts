/**
 * Dashboard module — JSON schemas for route validation + OpenAPI docs.
 */
import { z } from 'zod';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const CreateWidgetBodySchema = z.object({
  title: z.string().min(1).max(100),
  period: z.enum(['last_7_days', 'last_30_days', 'this_month', 'this_year', 'all_time']),
  reportsOn: z.enum(['tasks', 'approvals', 'young_people', 'employees']),
});

// ─── JSON Schemas ─────────────────────────────────────────────────────────────

export const createWidgetBodyJson = {
  type: 'object',
  required: ['title', 'period', 'reportsOn'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 100, example: 'My Tasks This Month' },
    period: {
      type: 'string',
      enum: ['last_7_days', 'last_30_days', 'this_month', 'this_year', 'all_time'],
      description: 'Time window for the widget data',
    },
    reportsOn: {
      type: 'string',
      enum: ['tasks', 'approvals', 'young_people', 'employees'],
      description: 'Data source the widget visualises',
    },
  },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateWidgetBody = z.infer<typeof CreateWidgetBodySchema>;
