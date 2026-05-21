import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireActiveSubscription } from '../../middleware/billing-status.js';
import { OWNER_ONLY, requireScopedRole } from '../../middleware/rbac.js';
import {
  UpdateOrganisationSettingsBodySchema,
  UpdateSettingsNotificationsBodySchema,
  updateOrganisationSettingsBodyJson,
  updateSettingsNotificationsBodyJson,
} from './settings.schema.js';
import * as settingsService from './settings.service.js';

// Org-level mutations affect every member; restricted to the tenant Owner.
// Reads stay open because members need org name/timezone for display.
// User-scoped notification preferences (GET/PATCH /settings/notifications)
// remain open — each call only ever touches the caller's own preferences.
const requireOrgSettingsWrite = requireScopedRole({
  ...OWNER_ONLY,
  errorCode: 'ORG_SETTINGS_FORBIDDEN',
  errorMessage: 'Only the organisation owner can modify these settings.',
});

const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);
  fastify.addHook('preHandler', requireActiveSubscription);

  fastify.get('/organisation', {
    schema: {
      tags: ['Settings'],
      summary: 'Get organisation settings',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const data = await settingsService.getOrganisationSettings(actorId);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/organisation', {
    preHandler: [requireOrgSettingsWrite],
    schema: {
      tags: ['Settings'],
      summary: 'Update organisation settings',
      body: updateOrganisationSettingsBodyJson,
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
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateOrganisationSettingsBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const data = await settingsService.updateOrganisationSettings(actorId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/notifications', {
    schema: {
      tags: ['Settings'],
      summary: 'Get notification settings',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const data = await settingsService.getSettingsNotifications(actorId);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/notifications', {
    schema: {
      tags: ['Settings'],
      summary: 'Update notification settings',
      body: updateSettingsNotificationsBodyJson,
      response: {
        200: {
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
      const parse = UpdateSettingsNotificationsBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const data = await settingsService.updateSettingsNotifications(actorId, parse.data);
      return reply.send({ success: true, data });
    },
  });
};

export default settingsRoutes;
