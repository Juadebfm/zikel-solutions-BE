import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireActiveSubscription } from '../../middleware/billing-status.js';
import * as auditService from './audit.service.js';
import { sendValidationError } from '../../lib/errors.js';
import { rowsToCsv } from '../../lib/csv.js';
import {
  TENANT_AUDIT_CSV_COLUMNS,
  buildAuditExportFilename,
} from '../../lib/audit-export.js';
import {
  ExportAuditLogsQuerySchema,
  ListAuditLogsQuerySchema,
  SecurityAlertsQuerySchema,
  exportAuditLogsQueryJson,
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
  fastify.addHook('preHandler', requireActiveSubscription);

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
      if (!parse.success) return sendValidationError(reply, parse.error);

      const actorUserId = (request.user as JwtPayload).sub;
      const { data, meta } = await auditService.listAuditLogs(actorUserId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  // ── GET /api/v1/audit/export ────────────────────────────────────────────
  // CSV (default) or JSON export of the tenant's OWN audit log. Mirrors the
  // platform-staff export at /admin/audit/tenants/:id/export — same row shape
  // and CSV columns, so an inspector receiving the file can't tell which
  // surface produced it. Hard-capped at 50,000 rows; the act of exporting is
  // itself written to the tenant's audit trail as
  // `entityType: 'tenant_audit_log_export'`.
  fastify.get('/export', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    schema: {
      tags: ['Audit'],
      summary: 'Export the tenant\'s audit log as CSV or JSON (Owner/Admin only; self-audited)',
      querystring: exportAuditLogsQueryJson,
      // No response schema — we stream a file, Fastify's serializer must not touch it.
    },
    handler: async (request, reply) => {
      const parse = ExportAuditLogsQuerySchema.safeParse(request.query);
      if (!parse.success) return sendValidationError(reply, parse.error);

      const actorUserId = (request.user as JwtPayload).sub;
      const ua = request.headers['user-agent'];
      const result = await auditService.exportTenantAudit({
        actorUserId,
        format: parse.data.format,
        ...(parse.data.action ? { action: parse.data.action } : {}),
        ...(parse.data.userId ? { userId: parse.data.userId } : {}),
        ...(parse.data.fromDate ? { fromDate: parse.data.fromDate } : {}),
        ...(parse.data.toDate ? { toDate: parse.data.toDate } : {}),
        ipAddress: request.ip,
        ...(typeof ua === 'string' ? { userAgent: ua } : {}),
      });

      const filename = buildAuditExportFilename({
        tenantSlug: result.tenant.slug,
        format: parse.data.format,
      });

      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Audit-Export-Total-Matching', String(result.totalMatching));
      reply.header('X-Audit-Export-Returned', String(result.rows.length));
      reply.header('X-Audit-Export-Truncated', result.truncated ? 'true' : 'false');

      if (parse.data.format === 'csv') {
        reply.type('text/csv; charset=utf-8');
        return reply.send(rowsToCsv(result.rows, TENANT_AUDIT_CSV_COLUMNS));
      }

      reply.type('application/json; charset=utf-8');
      return reply.send({
        tenant: result.tenant,
        filters: result.filters,
        totalMatching: result.totalMatching,
        rowsReturned: result.rows.length,
        truncated: result.truncated,
        items: result.rows,
      });
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
      if (!parse.success) return sendValidationError(reply, parse.error);

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
