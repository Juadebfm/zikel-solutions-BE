import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireActiveSubscription } from '../../middleware/billing-status.js';
import { ADMIN_OWNER_OR_SUB_ADMIN, requireScopedRole } from '../../middleware/rbac.js';
import { sendValidationError } from '../../lib/errors.js';
import {
  CreateSensitiveDataBodySchema,
  ListSensitiveDataQuerySchema,
  UpdateSensitiveDataBodySchema,
  createSensitiveDataBodyJson,
  listSensitiveDataQueryJson,
  updateSensitiveDataBodyJson,
} from './sensitive-data.schema.js';
import * as sensitiveDataService from './sensitive-data.service.js';

const requireSensitiveDataAccess = requireScopedRole({
  ...ADMIN_OWNER_OR_SUB_ADMIN,
  errorCode: 'SENSITIVE_DATA_FORBIDDEN',
  errorMessage: 'You do not have permission to access sensitive data records.',
});

const sensitiveDataRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);
  fastify.addHook('preHandler', requireActiveSubscription);
  // All verbs (list, get, create, update, delete, access-log, categories) are
  // restricted to admin / tenant_admin / sub_admin. Care Worker / Read-Only
  // never see sensitive-data rows even though they're tenant-scoped.
  fastify.addHook('preHandler', requireSensitiveDataAccess);

  fastify.get('/', {
    schema: {
      tags: ['Sensitive Data'],
      summary: 'List sensitive data records',
      querystring: listSensitiveDataQueryJson,
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
      const parse = ListSensitiveDataQuerySchema.safeParse(request.query);
      if (!parse.success) return sendValidationError(reply, parse.error);

      const actorId = (request.user as JwtPayload).sub;
      const { data, meta } = await sensitiveDataService.listSensitiveDataRecords(actorId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/categories', {
    schema: {
      tags: ['Sensitive Data'],
      summary: 'List sensitive data categories',
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
                required: ['category', 'count'],
                properties: {
                  category: { type: 'string' },
                  count: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const data = await sensitiveDataService.listSensitiveDataCategories(actorId);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id/access-log', {
    schema: {
      tags: ['Sensitive Data'],
      summary: 'Get sensitive data access log',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await sensitiveDataService.getSensitiveDataAccessLog(actorId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Sensitive Data'],
      summary: 'Get sensitive data record',
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
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await sensitiveDataService.getSensitiveDataRecord(actorId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/', {
    schema: {
      tags: ['Sensitive Data'],
      summary: 'Create sensitive data record',
      body: createSensitiveDataBodyJson,
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
      const parse = CreateSensitiveDataBodySchema.safeParse(request.body);
      if (!parse.success) return sendValidationError(reply, parse.error);

      const actorId = (request.user as JwtPayload).sub;
      const data = await sensitiveDataService.createSensitiveDataRecord(actorId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id', {
    schema: {
      tags: ['Sensitive Data'],
      summary: 'Update sensitive data record',
      params: { $ref: 'CuidParam#' },
      body: updateSensitiveDataBodyJson,
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
      const parse = UpdateSensitiveDataBodySchema.safeParse(request.body);
      if (!parse.success) return sendValidationError(reply, parse.error);

      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await sensitiveDataService.updateSensitiveDataRecord(actorId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.delete('/:id', {
    schema: {
      tags: ['Sensitive Data'],
      summary: 'Delete sensitive data record',
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
                message: { type: 'string' },
              },
            },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await sensitiveDataService.deleteSensitiveDataRecord(actorId, id);
      return reply.send({ success: true, data });
    },
  });
};

export default sensitiveDataRoutes;
