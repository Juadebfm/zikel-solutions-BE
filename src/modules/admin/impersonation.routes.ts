import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import type { PlatformJwtPayload, UserRole, TenantRole } from '../../types/index.js';
import {
  createImpersonationGrant,
  revokeActiveImpersonation,
  listImpersonationGrants,
} from './impersonation.service.js';
import { sendImpersonationStartedEmail } from '../../lib/impersonation-email.js';
import { requirePlatformMfa } from '../../middleware/mfa.js';

const ImpersonateBodySchema = z.object({
  ticketReference: z.string().min(1).max(80),
  reason: z.string().min(10).max(500),
  durationMinutes: z.coerce.number().int().min(5).max(240).optional(),
  // Optional approver — set when an out-of-band four-eyes flow has confirmed
  // the request with another platform user. Stored on the grant for audit.
  grantedByUserId: z.string().min(1).optional(),
});

const ListGrantsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  platformUserId: z.string().min(1).optional(),
  targetTenantId: z.string().min(1).optional(),
  ticketReference: z.string().min(1).optional(),
});

/**
 * Signs a tenant-audience JWT that the platform user can use to access the
 * target tenant on behalf of its Owner. Carries `impersonatorId` so audit
 * writes record the real actor; the JWT itself expires when the grant does.
 */
function signImpersonationJwt(
  fastify: FastifyInstance,
  args: {
    ownerUserId: string;
    ownerEmail: string;
    targetTenantId: string;
    impersonatorPlatformUserId: string;
    grantId: string;
    expiresAtSeconds: number;
  },
): string {
  return fastify.jwt.sign(
    {
      sub: args.ownerUserId,
      email: args.ownerEmail,
      role: 'admin' as UserRole,
      tenantId: args.targetTenantId,
      tenantRole: 'tenant_admin' as TenantRole,
      mfaVerified: true,
      impersonatorId: args.impersonatorPlatformUserId,
      impersonationGrantId: args.grantId,
      aud: 'tenant' as const,
    },
    {
      expiresIn: args.expiresAtSeconds,
    },
  );
}

const impersonationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticatePlatform);
  // Defense-in-depth: even though the new login flow hard-blocks platform
  // users from minting a non-MFA-verified session, gate impersonation with
  // requirePlatformMfa so any future code path that issues a session without
  // mfaVerified=true (e.g. seed scripts, future workflow tokens) still cannot
  // create or release impersonation grants. The middleware allows GETs through
  // and only blocks mutating methods.
  fastify.addHook('preHandler', requirePlatformMfa);

  // ── POST /admin/tenants/:id/impersonate ──────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/tenants/:id/impersonate', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    schema: {
      tags: ['Admin Impersonation'],
      summary: 'Begin impersonating into a tenant on behalf of a support ticket',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', minLength: 1 } },
      },
      body: {
        type: 'object',
        required: ['ticketReference', 'reason'],
        properties: {
          ticketReference: { type: 'string', minLength: 1, maxLength: 80 },
          reason: { type: 'string', minLength: 10, maxLength: 500 },
          durationMinutes: { type: 'integer', minimum: 5, maximum: 240 },
          grantedByUserId: { type: 'string', minLength: 1 },
        },
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
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ImpersonateBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const platformUser = request.user as PlatformJwtPayload;
      const ua = request.headers['user-agent'];
      const result = await createImpersonationGrant({
        platformUserId: platformUser.sub,
        targetTenantId: request.params.id,
        ticketReference: parse.data.ticketReference,
        reason: parse.data.reason,
        ...(parse.data.durationMinutes ? { durationMinutes: parse.data.durationMinutes } : {}),
        ...(parse.data.grantedByUserId ? { grantedByUserId: parse.data.grantedByUserId } : {}),
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });

      const ttlSeconds = Math.max(60, Math.floor((result.grant.expiresAt.getTime() - Date.now()) / 1000));
      const accessToken = signImpersonationJwt(fastify, {
        ownerUserId: result.ownerUser.id,
        ownerEmail: result.ownerUser.email,
        targetTenantId: result.tenant.id,
        impersonatorPlatformUserId: platformUser.sub,
        grantId: result.grant.id,
        expiresAtSeconds: ttlSeconds,
      });

      // Best-effort email notification to the tenant Owner.
      void sendImpersonationStartedEmail({
        ownerEmail: result.ownerUser.email,
        ownerName: `${result.ownerUser.firstName} ${result.ownerUser.lastName}`,
        tenantName: result.tenant.name,
        ticketReference: result.grant.ticketReference,
        expiresAt: result.grant.expiresAt,
        platformUserEmail: platformUser.email,
      });

      return reply.send({
        success: true,
        data: {
          grant: {
            id: result.grant.id,
            targetTenantId: result.tenant.id,
            targetTenantName: result.tenant.name,
            targetUserId: result.ownerUser.id,
            ticketReference: result.grant.ticketReference,
            reason: result.grant.reason,
            grantedAt: result.grant.grantedAt,
            expiresAt: result.grant.expiresAt,
          },
          tokens: {
            accessToken,
            // Issuer publishes this as the URL base for the FE to construct
            // the full impersonation experience.
            audience: 'tenant',
            tenantBaseUrl: env.PUBLIC_BASE_URL,
            expiresAt: result.grant.expiresAt.toISOString(),
          },
        },
      });
    },
  });

  // ── DELETE /admin/impersonation/active — release my active grant ────────
  fastify.delete('/impersonation/active', {
    schema: {
      tags: ['Admin Impersonation'],
      summary: "Release the platform user's currently active impersonation grant",
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', properties: { revoked: { type: 'boolean' } } },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const platformUser = request.user as PlatformJwtPayload;
      const ua = request.headers['user-agent'];
      const result = await revokeActiveImpersonation({
        platformUserId: platformUser.sub,
        ipAddress: request.ip,
        ...(ua ? { userAgent: ua } : {}),
      });
      return reply.send({ success: true, data: result });
    },
  });

  // ── GET /admin/impersonation — list grants (audit dashboard) ────────────
  fastify.get('/impersonation', {
    schema: {
      tags: ['Admin Impersonation'],
      summary: 'List impersonation grants (audit dashboard)',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          platformUserId: { type: 'string' },
          targetTenantId: { type: 'string' },
          ticketReference: { type: 'string' },
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
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListGrantsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const { page, pageSize, platformUserId, targetTenantId, ticketReference } = parse.data;
      const result = await listImpersonationGrants({
        page,
        pageSize,
        ...(platformUserId ? { platformUserId } : {}),
        ...(targetTenantId ? { targetTenantId } : {}),
        ...(ticketReference ? { ticketReference } : {}),
      });
      return reply.send({ success: true, ...result });
    },
  });
};

export default impersonationRoutes;
