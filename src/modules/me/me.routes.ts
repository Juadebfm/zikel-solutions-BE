import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import * as meService from './me.service.js';
import {
  ChangePasswordBodySchema,
  UpdateMeBodySchema,
  UpdatePreferencesBodySchema,
  changePasswordBodyJson,
  updateMeBodyJson,
  updatePreferencesBodyJson,
} from './me.schema.js';

const meRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    schema: {
      tags: ['Auth'],
      summary: 'Get my profile',
      description: 'Returns the currently authenticated user profile.',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['id', 'email', 'firstName', 'lastName', 'role', 'aiAccessEnabled'],
              properties: {
                id: { type: 'string' },
                email: { type: 'string', format: 'email' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                role: { $ref: 'UserRole#' },
                avatar: { type: ['string', 'null'] },
                homeId: { type: ['string', 'null'] },
                homeName: { type: ['string', 'null'] },
                phone: { type: ['string', 'null'] },
                jobTitle: { type: ['string', 'null'] },
                language: { type: 'string' },
                timezone: { type: 'string' },
                aiAccessEnabled: { type: 'boolean' },
                createdAt: { type: 'string', format: 'date-time' },
                lastLoginAt: { type: ['string', 'null'], format: 'date-time' },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await meService.getMyProfile(userId);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/', {
    schema: {
      tags: ['Auth'],
      summary: 'Update my profile',
      description: 'Updates editable profile fields for the authenticated user.',
      body: updateMeBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        401: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateMeBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const data = await meService.updateMyProfile(userId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/change-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Change my password',
      description:
        'Changes the authenticated user password after validating the current password. Revokes active refresh tokens.',
      body: changePasswordBodyJson,
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
                message: { type: 'string', example: 'Password updated.' },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ChangePasswordBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const data = await meService.changeMyPassword(userId, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/permissions', {
    schema: {
      tags: ['Auth'],
      summary: 'Get my permissions',
      description:
        'Returns effective permissions for the authenticated user in the active tenant context when available (falls back to global role otherwise).',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: [
                'canViewAllHomes',
                'canViewAllYoungPeople',
                'canViewAllEmployees',
                'canApproveIOILogs',
                'canManageUsers',
                'canManageSettings',
                'canViewReports',
                'canExportData',
              ],
              properties: {
                canViewAllHomes: { type: 'boolean' },
                canViewAllYoungPeople: { type: 'boolean' },
                canViewAllEmployees: { type: 'boolean' },
                canApproveIOILogs: { type: 'boolean' },
                canManageUsers: { type: 'boolean' },
                canManageSettings: { type: 'boolean' },
                canViewReports: { type: 'boolean' },
                canExportData: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await meService.getMyPermissions(userId);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/preferences', {
    schema: {
      tags: ['Auth'],
      summary: 'Get my preferences',
      description: 'Returns language and timezone preference for the current user.',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['language', 'timezone'],
              properties: {
                language: { type: 'string', example: 'en' },
                timezone: { type: 'string', example: 'Europe/London' },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await meService.getMyPreferences(userId);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/preferences', {
    schema: {
      tags: ['Auth'],
      summary: 'Update my preferences',
      description: 'Updates language/timezone preferences for the authenticated user.',
      body: updatePreferencesBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['language', 'timezone'],
              properties: {
                language: { type: 'string' },
                timezone: { type: 'string' },
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
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const userId = (request.user as JwtPayload).sub;
      const data = await meService.updateMyPreferences(userId, parse.data);
      return reply.send({ success: true, data });
    },
  });
};

export default meRoutes;
