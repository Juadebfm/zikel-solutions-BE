import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireScopedRole } from '../../middleware/rbac.js';
import * as announcementsService from './announcements.service.js';
import {
  CreateAnnouncementBodySchema,
  ListAnnouncementsQuerySchema,
  UpdateAnnouncementBodySchema,
  createAnnouncementBodyJson,
  listAnnouncementsQueryJson,
  updateAnnouncementBodyJson,
} from './announcements.schema.js';

const announcementsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    schema: {
      tags: ['Announcements'],
      summary: 'List announcements',
      description:
        'Returns announcements visible to the authenticated user. Supports read/unread filter and pagination.',
      querystring: listAnnouncementsQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'title', 'description', 'status', 'startsAt', 'isPinned'],
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  images: { type: 'array', items: { type: 'string' } },
                  startsAt: { type: 'string', format: 'date-time' },
                  endsAt: { type: ['string', 'null'], format: 'date-time' },
                  isPinned: { type: 'boolean' },
                  status: { type: 'string', enum: ['read', 'unread'] },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListAnnouncementsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const { data, meta } = await announcementsService.listAnnouncements(userId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Announcements'],
      summary: 'Get an announcement',
      description: 'Returns one announcement and marks it as read for the current user.',
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
      const data = await announcementsService.getAnnouncement(userId, id, true);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/:id/read', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['Announcements'],
      summary: 'Mark announcement as read',
      description: 'Marks an announcement as read for the authenticated user.',
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
                message: { type: 'string', example: 'Announcement marked as read.' },
              },
            },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await announcementsService.markAnnouncementRead(userId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['admin'],
        tenantRoles: ['tenant_admin'],
      }),
    ],
    schema: {
      tags: ['Announcements'],
      summary: 'Create announcement (admin only)',
      description: 'Creates a system-wide announcement.',
      body: createAnnouncementBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateAnnouncementBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const data = await announcementsService.createAnnouncement(actorId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['admin'],
        tenantRoles: ['tenant_admin'],
      }),
    ],
    schema: {
      tags: ['Announcements'],
      summary: 'Update announcement (admin only)',
      description: 'Updates an existing system announcement.',
      params: { $ref: 'CuidParam#' },
      body: updateAnnouncementBodyJson,
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
      const parse = UpdateAnnouncementBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await announcementsService.updateAnnouncement(actorId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.delete('/:id', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['admin'],
        tenantRoles: ['tenant_admin'],
      }),
    ],
    schema: {
      tags: ['Announcements'],
      summary: 'Archive announcement (admin only)',
      description: 'Archives an announcement while retaining it for audit/compliance history.',
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
                message: { type: 'string', example: 'Announcement archived.' },
              },
            },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await announcementsService.deleteAnnouncement(actorId, id);
      return reply.send({ success: true, data });
    },
  });
};

export default announcementsRoutes;
