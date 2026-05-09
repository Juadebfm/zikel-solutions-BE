import type { FastifyPluginAsync } from 'fastify';
import type { PlatformJwtPayload } from '../../types/index.js';
import { requirePlatformRole } from '../../middleware/platform-rbac.js';
import { requirePlatformMfa } from '../../middleware/mfa.js';
import {
  BroadcastNotificationBodySchema,
  broadcastNotificationBodyJson,
} from '../notifications/notifications.schema.js';
import { broadcastPlatformNotification } from '../notifications/notifications.service.js';

const adminNotificationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticatePlatform);
  fastify.addHook('preHandler', requirePlatformMfa);

  // ── POST /admin/notifications/broadcast ─────────────────────────────────
  // System-wide announcements written by Zikel platform staff: maintenance
  // windows, security advisories, ToS updates, etc. Restricted to
  // platform_admin (support/engineer/billing get 403 PLATFORM_ROLE_DENIED).
  // Optional `tenantIds` narrows the audience; omit to fan-out to ALL active
  // users across every tenant.
  fastify.post('/broadcast', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    preHandler: [requirePlatformRole('platform_admin')],
    schema: {
      tags: ['Admin Notifications'],
      summary: 'Broadcast a platform-wide notification (platform_admin only)',
      body: broadcastNotificationBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['recipientCount'],
              properties: { recipientCount: { type: 'integer' } },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = BroadcastNotificationBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const platformUser = request.user as PlatformJwtPayload;
      const data = await broadcastPlatformNotification(platformUser.sub, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });
};

export default adminNotificationsRoutes;
