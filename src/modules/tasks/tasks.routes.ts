import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { generateExport, type ExportColumn } from '../../lib/export.js';
import { ExportFormatSchema } from '../../lib/export-schema.js';
import * as tasksService from './tasks.service.js';
import {
  BatchArchiveBodySchema,
  BatchPostponeBodySchema,
  BatchReassignBodySchema,
  CreateTaskBodySchema,
  ListTasksQuerySchema,
  PostponeTaskBodySchema,
  TaskActionBodySchema,
  UpdateTaskBodySchema,
  batchArchiveBodyJson,
  batchPostponeBodyJson,
  batchReassignBodyJson,
  createTaskBodyJson,
  listTasksQueryJson,
  postponeTaskBodyJson,
  taskActionBodyJson,
  updateTaskBodyJson,
} from './tasks.schema.js';

const taskRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    schema: {
      tags: ['Tasks'],
      summary: 'List tasks',
      querystring: listTasksQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta', 'labels'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            meta: { $ref: 'PaginationMeta#' },
            labels: { type: 'object', additionalProperties: true },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListTasksQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { data, meta, labels } = await tasksService.listTasks(actorUserId, parse.data);
      return reply.send({ success: true, data, meta, labels });
    },
  });

  fastify.get('/export', {
    schema: {
      tags: ['Tasks'],
      summary: 'Export tasks as PDF or Excel',
      querystring: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ...listTasksQueryJson.properties,
          format: { type: 'string', enum: ['pdf', 'excel'], default: 'pdf' },
          pageSize: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const format = ExportFormatSchema.catch('pdf').parse(query.format);
      const parse = ListTasksQuerySchema.safeParse({ ...query, pageSize: Math.min(Number(query.pageSize) || 500, 5000) });
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { data } = await tasksService.listTasks(actorUserId, parse.data);

      const columns: ExportColumn[] = [
        { header: 'ID', key: 'taskRef', width: 80 },
        { header: 'Title', key: 'title', width: 180 },
        { header: 'Form Group', key: 'formGroup', width: 120 },
        { header: 'Status', key: 'lifecycleStatusLabel', width: 70 },
        { header: 'Priority', key: 'priority', width: 60 },
        { header: 'Relates To', key: 'relatesTo', width: 120 },
        { header: 'Assignee', key: 'assigneeName', width: 110 },
        { header: 'Task Date', key: 'taskDate', width: 80 },
      ];

      const rows = data.map((task: Record<string, unknown>) => ({
        taskRef: task.taskRef ?? task.id,
        title: task.title,
        formGroup: task.formGroup ?? task.category,
        lifecycleStatusLabel: task.lifecycleStatusLabel ?? task.status,
        priority: task.priority,
        relatesTo: (task.relatedEntity as Record<string, unknown> | null)?.name
          ?? (task.home as Record<string, unknown> | null)?.name
          ?? '',
        assigneeName: (task.assignee as Record<string, unknown> | null)?.name ?? '',
        taskDate: task.submittedAt
          ? new Date(task.submittedAt as string).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : '',
      }));

      const subtitle = parse.data.status ?? parse.data.scope ?? undefined;
      const result = await generateExport({ title: 'Task Overview', subtitle, columns, rows, format });

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    },
  });

  fastify.get('/categories', {
    schema: {
      tags: ['Tasks'],
      summary: 'List task categories',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'array',
              items: {
                type: 'object',
                required: ['value', 'label'],
                properties: {
                  value: { type: 'string' },
                  label: { type: 'string' },
                  types: { type: ['array', 'null'], items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const data = await tasksService.listTaskCategories();
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/form-templates', {
    schema: {
      tags: ['Tasks'],
      summary: 'List task form templates',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'array',
              items: {
                type: 'object',
                required: ['slug', 'label', 'category'],
                properties: {
                  slug: { type: 'string' },
                  label: { type: 'string' },
                  category: { type: 'string' },
                  formGroup: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const data = await tasksService.listTaskFormTemplates();
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Tasks'],
      summary: 'Get task by ID',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await tasksService.getTask(actorUserId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/:id/actions', {
    schema: {
      tags: ['Tasks'],
      summary: 'Run task action',
      params: { $ref: 'CuidParam#' },
      body: taskActionBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = TaskActionBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await tasksService.runTaskAction(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/', {
    schema: {
      tags: ['Tasks'],
      summary: 'Create task',
      body: createTaskBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'Task#' },
          },
        },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateTaskBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await tasksService.createTask(actorUserId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  /* ── Batch operations ─────────────────────────────────────────────────── */

  const batchResponseSchema = {
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'object',
        required: ['processed', 'failed'],
        properties: {
          processed: { type: 'integer' },
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
  } as const;

  fastify.post('/batch-archive', {
    schema: {
      tags: ['Tasks'],
      summary: 'Archive multiple tasks',
      body: batchArchiveBodyJson,
      response: {
        200: batchResponseSchema,
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = BatchArchiveBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await tasksService.batchArchiveTasks(actorUserId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/batch-postpone', {
    schema: {
      tags: ['Tasks'],
      summary: 'Postpone multiple tasks',
      body: batchPostponeBodyJson,
      response: {
        200: batchResponseSchema,
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = BatchPostponeBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await tasksService.batchPostponeTasks(actorUserId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/batch-reassign', {
    schema: {
      tags: ['Tasks'],
      summary: 'Reassign multiple tasks',
      body: batchReassignBodyJson,
      response: {
        200: batchResponseSchema,
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = BatchReassignBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await tasksService.batchReassignTasks(actorUserId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  /* ── Single-task postpone ──────────────────────────────────────────────── */

  fastify.post('/:id/postpone', {
    schema: {
      tags: ['Tasks'],
      summary: 'Postpone task due date',
      params: { $ref: 'CuidParam#' },
      body: postponeTaskBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = PostponeTaskBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await tasksService.postponeTask(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  /* ── Standard CRUD (parameterized) ─────────────────────────────────── */

  fastify.patch('/:id', {
    schema: {
      tags: ['Tasks'],
      summary: 'Update task',
      params: { $ref: 'CuidParam#' },
      body: updateTaskBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'Task#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateTaskBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await tasksService.updateTask(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.delete('/:id', {
    schema: {
      tags: ['Tasks'],
      summary: 'Archive task',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message'],
              properties: {
                message: { type: 'string', example: 'Task archived.' },
              },
            },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await tasksService.deleteTask(actorUserId, id);
      return reply.send({ success: true, data });
    },
  });
};

export default taskRoutes;
