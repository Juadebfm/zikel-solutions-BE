import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireActiveSubscription } from '../../middleware/billing-status.js';
import * as dailyLogsService from './daily-logs.service.js';
import {
  CreateDailyLogBodySchema,
  UpdateDailyLogBodySchema,
  ListDailyLogsQuerySchema,
  createDailyLogBodyJson,
  updateDailyLogBodyJson,
  listDailyLogsQueryJson,
} from './daily-logs.schema.js';

const dailyLogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);
  fastify.addHook('preHandler', requireActiveSubscription);

  // ─── List daily logs ───────────────────────────────────────────────────────

  fastify.get('/', {
    schema: {
      tags: ['Daily Logs'],
      summary: 'List daily logs',
      querystring: listDailyLogsQueryJson,
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
      const parse = ListDailyLogsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { data, meta, labels } = await dailyLogsService.listDailyLogs(userId, parse.data);
      return reply.send({ success: true, data, meta, labels });
    },
  });

  // ─── Create daily log ─────────────────────────────────────────────────────

  fastify.post('/', {
    schema: {
      tags: ['Daily Logs'],
      summary: 'Create a daily log',
      body: createDailyLogBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateDailyLogBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const data = await dailyLogsService.createDailyLog(userId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  // ─── Get daily log ─────────────────────────────────────────────────────────

  fastify.get('/:id', {
    schema: {
      tags: ['Daily Logs'],
      summary: 'Get a daily log by ID',
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
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await dailyLogsService.getDailyLog(userId, id);
      return reply.send({ success: true, data });
    },
  });

  // ─── Update daily log ──────────────────────────────────────────────────────

  fastify.patch('/:id', {
    schema: {
      tags: ['Daily Logs'],
      summary: 'Update a daily log',
      params: { $ref: 'CuidParam#' },
      body: updateDailyLogBodyJson,
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
      const parse = UpdateDailyLogBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await dailyLogsService.updateDailyLog(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  // ─── Delete daily log ──────────────────────────────────────────────────────

  fastify.delete('/:id', {
    schema: {
      tags: ['Daily Logs'],
      summary: 'Delete a daily log',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean', enum: [true] },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      await dailyLogsService.deleteDailyLog(userId, id);
      return reply.send({ success: true });
    },
  });
};

export default dailyLogRoutes;
