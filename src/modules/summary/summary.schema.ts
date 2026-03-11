/**
 * Summary module — JSON schemas for route validation + OpenAPI docs.
 */
import { z } from 'zod';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const SummaryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().optional(),
});

export const ApproveTaskBodySchema = z.object({
  comment: z.string().max(500).optional(),
});

export const BatchApproveBodySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, 'At least one task ID required.'),
  action: z.enum(['approve', 'reject']),
  rejectionReason: z.string().max(500).optional(),
});

// ─── JSON Schemas ─────────────────────────────────────────────────────────────

export const approveTaskBodyJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    comment: { type: 'string', maxLength: 500, description: 'Optional approval comment' },
  },
} as const;

export const batchApproveBodyJson = {
  type: 'object',
  required: ['taskIds', 'action'],
  additionalProperties: false,
  properties: {
    taskIds: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      description: 'Array of task IDs to process',
    },
    action: { type: 'string', enum: ['approve', 'reject'] },
    rejectionReason: { type: 'string', maxLength: 500 },
  },
} as const;

// ─── Response shape schemas (for OpenAPI inline definitions) ──────────────────

export const todoItemJson = {
  type: 'object',
  required: ['id', 'title', 'status', 'approvalStatus', 'priority'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    relation: { type: 'string', nullable: true, description: 'Related young person name or home' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    approvalStatus: {
      type: 'string',
      enum: ['not_required', 'pending_approval', 'approved', 'rejected', 'processing'],
    },
    priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
    assignee: { type: 'string', nullable: true },
    dueDate: { type: 'string', format: 'date-time', nullable: true },
  },
} as const;

export const provisionHomeJson = {
  type: 'object',
  required: ['homeId', 'homeName', 'events', 'shifts'],
  properties: {
    homeId: { type: 'string', example: 'cm8xk1m2v0000z0n1f2g3h4i5' },
    homeName: { type: 'string', example: 'Sunrise House' },
    events: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'time'],
        properties: {
          id: { type: 'string', example: 'cm8xk2p7a0001z0n1m4n5o6p7' },
          title: { type: 'string', example: 'Morning Provision Planning' },
          time: { type: 'string', format: 'date-time', example: '2026-03-11T09:00:00.000Z' },
          description: {
            type: 'string',
            nullable: true,
            example: 'Daily support planning, risk checks, and priorities review.',
          },
        },
      },
    },
    shifts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['employeeId', 'employeeName', 'startTime', 'endTime'],
        properties: {
          employeeId: { type: 'string', example: 'cm8xk34hf0002z0n1t8u9v0w1' },
          employeeName: { type: 'string', example: 'Noah North' },
          startTime: { type: 'string', format: 'date-time', example: '2026-03-11T07:00:00.000Z' },
          endTime: { type: 'string', format: 'date-time', example: '2026-03-11T15:00:00.000Z' },
        },
      },
    },
  },
} as const;

export const provisionsResponseExample = [
  {
    homeId: 'cm8xk1m2v0000z0n1f2g3h4i5',
    homeName: 'Sunrise House',
    events: [
      {
        id: 'cm8xk2p7a0001z0n1m4n5o6p7',
        title: 'Morning Provision Planning',
        time: '2026-03-11T09:00:00.000Z',
        description: 'Daily support planning, risk checks, and priorities review.',
      },
    ],
    shifts: [
      {
        employeeId: 'cm8xk34hf0002z0n1t8u9v0w1',
        employeeName: 'Noah North',
        startTime: '2026-03-11T07:00:00.000Z',
        endTime: '2026-03-11T15:00:00.000Z',
      },
      {
        employeeId: 'cm8xk34hf0003z0n1a2b3c4d5',
        employeeName: 'Martha Manager',
        startTime: '2026-03-11T09:00:00.000Z',
        endTime: '2026-03-11T17:00:00.000Z',
      },
    ],
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type SummaryListQuery = z.infer<typeof SummaryListQuerySchema>;
export type ApproveTaskBody = z.infer<typeof ApproveTaskBodySchema>;
export type BatchApproveBody = z.infer<typeof BatchApproveBodySchema>;
