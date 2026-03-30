import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import * as tasksService from './tasks.service.js';
import {
  CreateTaskBodySchema,
  ListTasksQuerySchema,
  TaskActionBodySchema,
  UpdateTaskBodySchema,
  createTaskBodyJson,
  listTasksQueryJson,
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
