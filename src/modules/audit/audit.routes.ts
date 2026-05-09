import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import * as auditService from './audit.service.js';
import {
  ListAuditLogsQuerySchema,
  SecurityAlertsQuerySchema,
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

  // Phase 6 (2026-05-08): legacy break-glass routes
  // (`POST /api/v1/audit/break-glass/access` and `release`) were removed.
  // Cross-tenant audit reads by Zikel platform staff now go through:
  //   - GET  /admin/audit/tenants/:id           (the read is itself audited)
  //   - POST /admin/tenants/:id/impersonate     (full tenant access, ticket-bound)
  // Historical AuditLog rows with entityType='break_glass_access' are still
  // surfaced by `listSecurityAlerts` for retrospective visibility.
};

export default auditRoutes;
