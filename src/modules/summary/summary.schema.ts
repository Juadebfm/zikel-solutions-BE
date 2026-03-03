/**
 * Summary module — JSON schemas for route validation + OpenAPI docs.
 */
import { z } from 'zod';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

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
    homeId: { type: 'string' },
    homeName: { type: 'string' },
    events: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'time'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          time: { type: 'string', format: 'date-time' },
          description: { type: 'string', nullable: true },
        },
      },
    },
    shifts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['employeeId', 'employeeName', 'startTime', 'endTime'],
        properties: {
          employeeId: { type: 'string' },
          employeeName: { type: 'string' },
          startTime: { type: 'string', format: 'date-time' },
          endTime: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type BatchApproveBody = z.infer<typeof BatchApproveBodySchema>;
