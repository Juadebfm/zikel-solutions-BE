import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { PlatformJwtPayload } from '../../types/index.js';
import { requirePlatformRole } from '../../middleware/platform-rbac.js';
import { requirePlatformMfa } from '../../middleware/mfa.js';
import {
  listTenantsForPlatform,
  getTenantForPlatform,
  suspendTenant,
  reactivateTenant,
} from './admin-tenants.service.js';

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().min(1).max(120).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  country: z.enum(['UK', 'Nigeria']).optional(),
});

const SuspendBodySchema = z.object({
  reason: z.string().min(10).max(500),
});

const ReactivateBodySchema = z.object({
  reason: z.string().min(10).max(500),
});

const adminTenantRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticatePlatform);
  // Mutating operations on this surface (suspend, reactivate) MUST go through
  // an MFA-verified session. The middleware allows GETs through.
  fastify.addHook('preHandler', requirePlatformMfa);

  // ── GET /admin/tenants — list ───────────────────────────────────────────
  fastify.get('/', {
    schema: {
      tags: ['Admin Tenants'],
      summary: 'List all tenants (platform staff view)',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          search: { type: 'string', minLength: 1, maxLength: 120 },
          isActive: { type: 'string', enum: ['true', 'false'] },
          country: { type: 'string', enum: ['UK', 'Nigeria'] },
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
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListQuerySchema.safeParse(request.query);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const { page, pageSize, search, isActive, country } = parse.data;
      const result = await listTenantsForPlatform({
        page,
        pageSize,
        ...(search ? { search } : {}),
        ...(isActive ? { isActive: isActive === 'true' } : {}),
        ...(country ? { country } : {}),
      });
      return reply.send({ success: true, ...result });
    },
  });

  // ── GET /admin/tenants/:id — detail ──────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['Admin Tenants'],
      summary: 'Get tenant detail (platform staff view)',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 } },
      },
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
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const data = await getTenantForPlatform(request.params.id);
      return reply.send({ success: true, data });
    },
  });

  // ── POST /admin/tenants/:id/suspend ─────────────────────────────────────
  // Suspension takes a tenant offline: isActive=false (memberships filter
  // already drops these out of every tenant-side flow) AND every active
  // session for the tenant's users is revoked atomically.
  // Restricted to platform_admin — support/engineer/billing cannot suspend.
  fastify.post<{ Params: { id: string }; Body: { reason: string } }>('/:id/suspend', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    preHandler: [requirePlatformRole('platform_admin')],
    schema: {
      tags: ['Admin Tenants'],
      summary: 'Suspend a tenant (platform_admin only)',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 } },
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: { reason: { type: 'string', minLength: 10, maxLength: 500 } },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['id', 'isActive'],
              properties: {
                id: { type: 'string' },
                isActive: { type: 'boolean' },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = SuspendBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const platformUser = request.user as PlatformJwtPayload;
      const ua = request.headers['user-agent'];
      const result = await suspendTenant({
        platformUserId: platformUser.sub,
        tenantId: request.params.id,
        reason: parse.data.reason,
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });
      return reply.send({ success: true, data: result });
    },
  });

  // ── POST /admin/tenants/:id/reactivate ──────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { reason: string } }>('/:id/reactivate', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    preHandler: [requirePlatformRole('platform_admin')],
    schema: {
      tags: ['Admin Tenants'],
      summary: 'Reactivate a previously-suspended tenant (platform_admin only)',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 } },
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: { reason: { type: 'string', minLength: 10, maxLength: 500 } },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['id', 'isActive'],
              properties: {
                id: { type: 'string' },
                isActive: { type: 'boolean' },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ReactivateBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const platformUser = request.user as PlatformJwtPayload;
      const ua = request.headers['user-agent'];
      const result = await reactivateTenant({
        platformUserId: platformUser.sub,
        tenantId: request.params.id,
        reason: parse.data.reason,
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });
      return reply.send({ success: true, data: result });
    },
  });
};

export default adminTenantRoutes;
