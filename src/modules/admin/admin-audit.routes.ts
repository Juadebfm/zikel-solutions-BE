import type { FastifyPluginAsync } from 'fastify';
import { AuditAction } from '@prisma/client';
import { z } from 'zod';
import type { PlatformJwtPayload } from '../../types/index.js';
import { sendValidationError } from '../../lib/errors.js';
import {
  listTenantAuditForPlatform,
  listPlatformAudit,
  exportTenantAuditForPlatform,
} from './admin-audit.service.js';
import { rowsToCsv } from '../../lib/csv.js';
import {
  TENANT_AUDIT_CSV_COLUMNS,
  buildAuditExportFilename,
} from '../../lib/audit-export.js';

const AuditActionSchema = z.nativeEnum(AuditAction);

const ListTenantAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: AuditActionSchema.optional(),
  userId: z.string().min(1).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

const ExportTenantAuditQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  action: AuditActionSchema.optional(),
  userId: z.string().min(1).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

// TENANT_AUDIT_CSV_COLUMNS + buildAuditExportFilename are imported from
// src/lib/audit-export.ts so the tenant-side export endpoint shares the
// exact same row shape and filename pattern.

const ListPlatformAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: AuditActionSchema.optional(),
  platformUserId: z.string().min(1).optional(),
  targetTenantId: z.string().min(1).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

const adminAuditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticatePlatform);
  // These are read endpoints, but they expose cross-tenant audit data — and
  // the act of reading is itself recorded. Even though requirePlatformMfa
  // only blocks mutating methods, we keep it on this surface because an
  // attacker chaining a non-MFA platform session into reading a tenant's
  // audit history is the same threat model the gate exists for.
  fastify.addHook('preHandler', async (request, reply) => {
    const user = request.user as PlatformJwtPayload | undefined;
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
      });
    }
    if (user.mfaVerified !== true) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'MFA_REQUIRED',
          message:
            'Cross-tenant audit reads require an MFA-verified platform session. ' +
            'Sign out and sign in again with TOTP.',
        },
      });
    }
  });

  // ── GET /admin/audit/tenants/:id ────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/tenants/:id', {
    schema: {
      tags: ['Admin Audit'],
      summary: 'Read a tenant\'s audit log (cross-tenant; read is itself audited)',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 } },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          action: { type: 'string' },
          userId: { type: 'string' },
          fromDate: { type: 'string', format: 'date-time' },
          toDate: { type: 'string', format: 'date-time' },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListTenantAuditQuerySchema.safeParse(request.query);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const platformUser = request.user as PlatformJwtPayload;
      const ua = request.headers['user-agent'];
      const result = await listTenantAuditForPlatform({
        platformUserId: platformUser.sub,
        tenantId: request.params.id,
        page: parse.data.page,
        pageSize: parse.data.pageSize,
        ...(parse.data.action ? { action: parse.data.action } : {}),
        ...(parse.data.userId ? { userId: parse.data.userId } : {}),
        ...(parse.data.fromDate ? { fromDate: parse.data.fromDate } : {}),
        ...(parse.data.toDate ? { toDate: parse.data.toDate } : {}),
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });
      return reply.send({
        success: true,
        data: { tenant: result.tenant, items: result.data },
        meta: result.meta,
      });
    },
  });

  // ── GET /admin/audit/tenants/:id/export ─────────────────────────────────
  // CSV (default) or JSON export of a tenant's audit log for compliance use.
  // Hard-capped at TENANT_AUDIT_EXPORT_MAX_ROWS (50,000) — split by date range
  // for larger datasets. The export itself is recorded in PlatformAuditLog
  // as `event: 'tenant_audit_exported'` with format + row count + filters.
  fastify.get<{ Params: { id: string } }>('/tenants/:id/export', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    schema: {
      tags: ['Admin Audit'],
      summary: 'Export a tenant\'s audit log as CSV or JSON (cross-tenant; export is itself audited)',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 } },
      },
      querystring: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['csv', 'json'], default: 'csv' },
          action: { type: 'string' },
          userId: { type: 'string' },
          fromDate: { type: 'string', format: 'date-time' },
          toDate: { type: 'string', format: 'date-time' },
        },
      },
      // Schema response intentionally omitted — we're streaming a file, not a
      // JSON envelope. Fastify's serializer should not touch the response body.
    },
    handler: async (request, reply) => {
      const parse = ExportTenantAuditQuerySchema.safeParse(request.query);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const platformUser = request.user as PlatformJwtPayload;
      const ua = request.headers['user-agent'];
      const result = await exportTenantAuditForPlatform({
        platformUserId: platformUser.sub,
        tenantId: request.params.id,
        format: parse.data.format,
        ...(parse.data.action ? { action: parse.data.action } : {}),
        ...(parse.data.userId ? { userId: parse.data.userId } : {}),
        ...(parse.data.fromDate ? { fromDate: parse.data.fromDate } : {}),
        ...(parse.data.toDate ? { toDate: parse.data.toDate } : {}),
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
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

  // ── GET /admin/audit/platform ───────────────────────────────────────────
  fastify.get('/platform', {
    schema: {
      tags: ['Admin Audit'],
      summary: 'Read PlatformAuditLog (actions taken by platform staff)',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          action: { type: 'string' },
          platformUserId: { type: 'string' },
          targetTenantId: { type: 'string' },
          fromDate: { type: 'string', format: 'date-time' },
          toDate: { type: 'string', format: 'date-time' },
        },
      },
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
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListPlatformAuditQuerySchema.safeParse(request.query);
      if (!parse.success) return sendValidationError(reply, parse.error);
      const result = await listPlatformAudit({
        page: parse.data.page,
        pageSize: parse.data.pageSize,
        ...(parse.data.action ? { action: parse.data.action } : {}),
        ...(parse.data.platformUserId ? { platformUserId: parse.data.platformUserId } : {}),
        ...(parse.data.targetTenantId ? { targetTenantId: parse.data.targetTenantId } : {}),
        ...(parse.data.fromDate ? { fromDate: parse.data.fromDate } : {}),
        ...(parse.data.toDate ? { toDate: parse.data.toDate } : {}),
      });
      return reply.send({ success: true, ...result });
    },
  });
};

export default adminAuditRoutes;
