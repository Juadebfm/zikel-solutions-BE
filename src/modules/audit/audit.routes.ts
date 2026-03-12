import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import * as auditService from './audit.service.js';
import {
  BreakGlassAccessBodySchema,
  BreakGlassReleaseBodySchema,
  ListAuditLogsQuerySchema,
  SecurityAlertsQuerySchema,
  breakGlassAccessBodyJson,
  breakGlassReleaseBodyJson,
  listAuditLogsQueryJson,
  securityAlertsQueryJson,
} from './audit.schema.js';

const auditLogParamsJson = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;

const auditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    schema: {
      tags: ['Audit'],
      summary: 'List audit logs (tenant scoped)',
      querystring: listAuditLogsQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { $ref: 'AuditLog#' } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListAuditLogsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { data, meta } = await auditService.listAuditLogs(actorUserId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/security-alerts', {
    schema: {
      tags: ['Audit'],
      summary: 'List security alerts derived from recent audit events',
      querystring: securityAlertsQueryJson,
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
                required: ['type', 'severity', 'count', 'lastSeenAt', 'details'],
                properties: {
                  type: {
                    type: 'string',
                    enum: [
                      'repeated_auth_failures',
                      'cross_tenant_attempts',
                      'admin_changes',
                      'break_glass_access',
                    ],
                  },
                  severity: { type: 'string', enum: ['medium', 'high'] },
                  count: { type: 'integer' },
                  lastSeenAt: { type: 'string', format: 'date-time' },
                  details: { type: 'string' },
                },
              },
            },
          },
        },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = SecurityAlertsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await auditService.listSecurityAlerts(actorUserId, parse.data.lookbackHours);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Audit'],
      summary: 'Get one audit log by ID',
      params: auditLogParamsJson,
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tenantId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'AuditLog#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const { tenantId } = request.query as { tenantId?: string };
      const data = await auditService.getAuditLog(actorUserId, id, tenantId);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/break-glass/access', {
    schema: {
      tags: ['Audit'],
      summary: 'Break-glass tenant access (super-admin only)',
      body: breakGlassAccessBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message', 'activeTenantId', 'previousTenantId', 'expiresAt'],
              properties: {
                message: { type: 'string' },
                activeTenantId: { type: 'string' },
                previousTenantId: { type: ['string', 'null'] },
                expiresAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = BreakGlassAccessBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await auditService.breakGlassAccess(actorUserId, parse.data, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] as string | undefined,
      });
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/break-glass/release', {
    schema: {
      tags: ['Audit'],
      summary: 'Release active break-glass tenant context (super-admin only)',
      body: breakGlassReleaseBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message', 'activeTenantId', 'releasedTenantId', 'releasedAt'],
              properties: {
                message: { type: 'string' },
                activeTenantId: { type: ['string', 'null'] },
                releasedTenantId: { type: 'string' },
                releasedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = BreakGlassReleaseBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await auditService.breakGlassRelease(actorUserId, parse.data, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] as string | undefined,
      });
      return reply.send({ success: true, data });
    },
  });
};

export default auditRoutes;
