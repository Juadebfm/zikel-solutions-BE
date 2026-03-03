import type { FastifyPluginAsync } from 'fastify';
import {
  approveTaskBodyJson,
  batchApproveBodyJson,
  todoItemJson,
  provisionHomeJson,
} from './summary.schema.js';

const NOT_IMPLEMENTED = {
  success: false as const,
  error: { code: 'NOT_IMPLEMENTED', message: 'This endpoint is not yet implemented — Phase 4.' },
};

const summaryRoutes: FastifyPluginAsync = async (fastify) => {
  // All summary routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /summary/stats ─────────────────────────────────────────────────────
  fastify.get('/stats', {
    schema: {
      tags: ['Summary'],
      summary: 'My summary stats',
      description:
        'Returns KPI counts for the authenticated user: overdue, due today, pending approval, ' +
        'rejected, draft, future tasks, unread comments, and reward points.',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'SummaryStats#' },
          },
        },
        401: { $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => { reply.statusCode = 501; return reply.send(NOT_IMPLEMENTED as never); },
  });

  // ── GET /summary/todos ─────────────────────────────────────────────────────
  fastify.get('/todos', {
    schema: {
      tags: ['Summary'],
      summary: 'My to-do list',
      description: 'Returns the personal task list for the authenticated user, paginated.',
      querystring: { $ref: 'PaginatedQuery#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: todoItemJson },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        401: { $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => { reply.statusCode = 501; return reply.send(NOT_IMPLEMENTED as never); },
  });

  // ── GET /summary/tasks-to-approve ─────────────────────────────────────────
  fastify.get('/tasks-to-approve', {
    schema: {
      tags: ['Summary'],
      summary: 'Tasks pending my approval',
      description:
        'Returns tasks with approvalStatus = pending_approval that the current user has permission to approve. ' +
        'Users without approval permission receive a 403.',
      querystring: { $ref: 'PaginatedQuery#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { $ref: 'Task#' } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { description: 'User lacks approval permission.', $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => { reply.statusCode = 501; return reply.send(NOT_IMPLEMENTED as never); },
  });

  // ── POST /summary/tasks-to-approve/:id/approve ────────────────────────────
  fastify.post('/:id/approve', {
    schema: {
      tags: ['Summary'],
      summary: 'Approve a single task',
      description:
        'Approves the specified task. Requires approval permission. ' +
        'Stores approver ID, timestamp, and optional comment.',
      params: { $ref: 'CuidParam#' },
      body: approveTaskBodyJson,
      response: {
        200: {
          description: 'Task approved.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'Task#' },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { description: 'User lacks approval permission.', $ref: 'ApiError#' },
        404: { description: 'Task not found.', $ref: 'ApiError#' },
        409: { description: 'Task is not in pending_approval state.', $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => { reply.statusCode = 501; return reply.send(NOT_IMPLEMENTED as never); },
  });

  // ── POST /summary/tasks-to-approve/process-batch ──────────────────────────
  fastify.post('/process-batch', {
    schema: {
      tags: ['Summary'],
      summary: 'Batch approve or reject tasks',
      description:
        'Approves or rejects multiple tasks in a single operation. ' +
        'Requires approval permission. Partial success returns details per task.',
      body: batchApproveBodyJson,
      response: {
        200: {
          description: 'Batch processed.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['processed', 'failed'],
              properties: {
                processed: { type: 'integer', example: 5 },
                failed: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      reason: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { description: 'User lacks approval permission.', $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => { reply.statusCode = 501; return reply.send(NOT_IMPLEMENTED as never); },
  });

  // ── GET /summary/provisions ───────────────────────────────────────────────
  fastify.get('/provisions', {
    schema: {
      tags: ['Summary'],
      summary: "Today's provisions grouped by home",
      description:
        "Returns today's scheduled events and staff shifts for each home the authenticated user has access to.",
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: provisionHomeJson },
          },
        },
        401: { $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => { reply.statusCode = 501; return reply.send(NOT_IMPLEMENTED as never); },
  });
};

export default summaryRoutes;
