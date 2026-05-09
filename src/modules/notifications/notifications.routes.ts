import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import * as notificationsService from './notifications.service.js';
import {
  ListNotificationsQuerySchema,
  UpdatePreferencesBodySchema,
  listNotificationsQueryJson,
  updatePreferencesBodyJson,
} from './notifications.schema.js';

const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    schema: {
      tags: ['Notifications'],
      summary: 'List notifications for current user',
      querystring: listNotificationsQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListNotificationsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const result = await notificationsService.listNotifications(userId, parse.data);
      return reply.send({ success: true, ...result });
    },
  });

  fastify.get('/unread-count', {
    schema: {
      tags: ['Notifications'],
      summary: 'Get unread notification count',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['count'],
              properties: { count: { type: 'integer' } },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await notificationsService.getUnreadCount(userId);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/:id/read', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark notification as read',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', properties: { message: { type: 'string' } } },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await notificationsService.markRead(userId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/read-all', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark all notifications as read',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['updated'],
              properties: { updated: { type: 'integer' } },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await notificationsService.markAllRead(userId);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/preferences', {
    schema: {
      tags: ['Notifications'],
      summary: 'Get notification preferences',
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
                properties: {
                  category: { type: 'string' },
                  enabled: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await notificationsService.getPreferences(userId);
      return reply.send({ success: true, data });
    },
  });

  fastify.put('/preferences', {
    schema: {
      tags: ['Notifications'],
      summary: 'Update notification preferences',
      body: updatePreferencesBodyJson,
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
                properties: {
                  category: { type: 'string' },
                  enabled: { type: 'boolean' },
                },
              },
            },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdatePreferencesBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const data = await notificationsService.updatePreferences(userId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  // Phase 6 (2026-05-08): platform broadcast moved to /admin/notifications/broadcast
  // (platform_admin role only). The previous tenant-side stub was removed.
};

export default notificationsRoutes;
