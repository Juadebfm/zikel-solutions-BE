import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import * as summaryService from './summary.service.js';
import {
  ApproveTaskBodySchema,
  BatchApproveBodySchema,
  ReviewTaskBodySchema,
  SummaryListQuerySchema,
  approveTaskBodyJson,
  batchApproveBodyJson,
  reviewTaskBodyJson,
  tasksToApproveItemJson,
  taskToApproveDetailJson,
  tasksToApproveQueryJson,
  todoItemJson,
  pendingApprovalLabelsJson,
  provisionHomeJson,
  provisionsResponseExample,
} from './summary.schema.js';

const summaryRoutes: FastifyPluginAsync = async (fastify) => {
  // All summary routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  // ── GET /summary/stats ─────────────────────────────────────────────────────
  fastify.get('/stats', {
    schema: {
      tags: ['Summary'],
      summary: 'My summary stats',
      description:
        'Returns KPI counts for the authenticated user: overdue, due today, pending approval, ' +
        'rejected, draft, future tasks, unread announcements, and reward points.',
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
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await summaryService.getSummaryStats(userId);
      return reply.send({ success: true, data });
    },
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
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = SummaryListQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { data, meta } = await summaryService.listTodos(userId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  // ── GET /summary/overdue-tasks ────────────────────────────────────────────
  fastify.get('/overdue-tasks', {
    schema: {
      tags: ['Summary'],
      summary: 'My overdue tasks',
      description:
        'Returns only personal overdue tasks for the authenticated user (due date before today, excluding completed/cancelled).',
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
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = SummaryListQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { data, meta } = await summaryService.listOverdueTodos(userId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  // ── GET /summary/tasks-to-approve ─────────────────────────────────────────
  fastify.get('/tasks-to-approve', {
    schema: {
      tags: ['Summary'],
      summary: 'Items awaiting my approval',
      description:
        'Returns tasks with approvalStatus = pending_approval that the current user has permission to approve. ' +
        'Users without approval permission receive a 403.',
      querystring: tasksToApproveQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta', 'labels'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: tasksToApproveItemJson },
            meta: { $ref: 'PaginationMeta#' },
            labels: pendingApprovalLabelsJson,
          },
        },
        401: { $ref: 'ApiError#' },
        403: { description: 'User lacks approval permission.', $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = SummaryListQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { data, meta, labels } = await summaryService.listTasksToApprove(userId, parse.data);
      return reply.send({ success: true, data, meta, labels });
    },
  });

  // ── GET /summary/tasks-to-approve/:id ─────────────────────────────────────
  fastify.get('/tasks-to-approve/:id', {
    schema: {
      tags: ['Summary'],
      summary: 'Task approval detail',
      description:
        'Returns a single pending-approval task with metadata and dynamic submission payload for detail rendering.',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: taskToApproveDetailJson,
          },
        },
        401: { $ref: 'ApiError#' },
        403: { description: 'User lacks approval permission.', $ref: 'ApiError#' },
        404: { description: 'Task not found.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await summaryService.getTaskToApproveDetail(userId, id);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /summary/tasks-to-approve/:id/review-events ──────────────────────
  fastify.post('/tasks-to-approve/:id/review-events', {
    schema: {
      tags: ['Summary'],
      summary: 'Record that actor reviewed an item before acknowledgement',
      description:
        'Persists a review event for the current user on the target pending-approval task. ' +
        'Frontend should call this when user opens detail, downloads document, or navigates into task content.',
      params: { $ref: 'CuidParam#' },
      body: reviewTaskBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['taskId', 'reviewedByCurrentUser', 'reviewedAt', 'action'],
              properties: {
                taskId: { type: 'string' },
                reviewedByCurrentUser: { type: 'boolean', enum: [true] },
                reviewedAt: { type: 'string', format: 'date-time' },
                action: { type: 'string', enum: ['view_detail', 'open_document', 'open_task'] },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { description: 'User lacks approval permission.', $ref: 'ApiError#' },
        404: { description: 'Task not found.', $ref: 'ApiError#' },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ReviewTaskBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await summaryService.recordTaskReviewEvent(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /summary/tasks-to-approve/process-batch ──────────────────────────
  fastify.post('/tasks-to-approve/process-batch', {
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
        409: { description: 'Review is required before acknowledge submit.', $ref: 'ApiError#' },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = BatchApproveBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const data = await summaryService.processTaskBatch(userId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /summary/tasks-to-approve/:id/approve ────────────────────────────
  fastify.post('/tasks-to-approve/:id/approve', {
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
        409: {
          description:
            'Task is not in pending_approval state, or review is required before acknowledgement.',
          $ref: 'ApiError#',
        },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ApproveTaskBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await summaryService.approveTask(userId, id, parse.data.comment);
      return reply.send({ success: true, data });
    },
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
            data: {
              type: 'array',
              items: provisionHomeJson,
              example: provisionsResponseExample,
            },
          },
        },
        401: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await summaryService.getTodayProvisions(userId);
      return reply.send({ success: true, data });
    },
  });
};

export default summaryRoutes;
