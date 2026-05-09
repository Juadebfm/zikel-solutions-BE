import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requirePermission } from '../../middleware/rbac.js';
import { Permissions as P } from '../../auth/permissions.js';
import * as aiService from './ai.service.js';
import {
  AskAiBodySchema,
  SetAiAccessBodySchema,
  askAiBodyJson,
  setAiAccessBodyJson,
} from './ai.schema.js';

const aiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.post('/ask', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['AI'],
      summary: 'Ask AI (page-aware assistant)',
      description:
        'Generates concise, page-aware guidance. On the summary page it uses system-wide stats; on other pages it uses the items and filters visible on screen. Returns provider output when available, with automatic fallback.',
      body: askAiBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message', 'highlights', 'tip', 'actions', 'source', 'generatedAt', 'meta'],
              properties: {
                message: { type: 'string', description: 'The AI-generated conversational response. Render this as the chat message.' },
                highlights: {
                  type: 'array',
                  description: 'Top priority items to show as cards. Empty for casual messages.',
                  items: {
                    type: 'object',
                    required: ['title', 'reason', 'urgency', 'action'],
                    properties: {
                      title: { type: 'string' },
                      reason: { type: 'string' },
                      urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                      action: { type: 'string', description: 'Recommended next step for this item.' },
                    },
                  },
                },
                tip: { type: ['string', 'null'], description: 'A single actionable tip or pattern insight. Null if none.' },
                actions: {
                  type: 'array',
                  description: 'Suggested quick-action buttons for the user.',
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
                generatedAt: { type: 'string', format: 'date-time' },
                meta: {
                  type: 'object',
                  description: 'Metadata for debugging/logging — not for rendering.',
                  properties: {
                    model: { type: ['string', 'null'] },
                    page: { type: 'string' },
                    strengthProfile: { type: 'string', enum: ['owner', 'admin', 'staff'] },
                    responseMode: { type: 'string', enum: ['comprehensive', 'balanced', 'focused'] },
                    statsSource: { type: 'string', enum: ['client', 'server', 'none'] },
                    languageSafetyPassed: { type: 'boolean' },
                  },
                },
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
    preHandler: [
      requirePermission(P.AI_ADMIN),
    ],
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
