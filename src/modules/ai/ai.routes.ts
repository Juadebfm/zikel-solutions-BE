import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requireRole } from '../../middleware/rbac.js';
import * as aiService from './ai.service.js';
import {
  AskAiBodySchema,
  SetAiAccessBodySchema,
  askAiBodyJson,
  setAiAccessBodyJson,
} from './ai.schema.js';

const aiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/ask', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['AI'],
      summary: 'Ask AI (summary assistant)',
      description:
        'Generates concise guidance from summary context. Returns provider output when available, with automatic fallback.',
      body: askAiBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['answer', 'suggestions', 'source', 'model', 'statsSource', 'generatedAt'],
              properties: {
                answer: { type: 'string' },
                suggestions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['label', 'action'],
                    properties: {
                      label: { type: 'string' },
                      action: { type: 'string' },
                    },
                  },
                },
                source: { type: 'string', enum: ['model', 'fallback'] },
                model: { type: ['string', 'null'] },
                statsSource: { type: 'string', enum: ['client', 'server', 'none'] },
                generatedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = AskAiBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const data = await aiService.askAi(userId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/access/:id', {
    preHandler: [requireRole('admin', 'super_admin')],
    schema: {
      tags: ['AI'],
      summary: 'Update AI access for a user (admin only)',
      description: 'Enables or disables AI access for a specific user account.',
      params: { $ref: 'CuidParam#' },
      body: setAiAccessBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['userId', 'aiAccessEnabled', 'updatedAt'],
              properties: {
                userId: { type: 'string' },
                aiAccessEnabled: { type: 'boolean' },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = SetAiAccessBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await aiService.setUserAiAccess(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });
};

export default aiRoutes;
