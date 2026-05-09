import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../../types/index.js';
import { Permissions as P } from '../../auth/permissions.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  resendInvitation,
  resolveInvitationByToken,
  revokeInvitation,
  sendInvitationEmail,
} from './invitations.service.js';

const CreateInvitationBodySchema = z.object({
  email: z.string().email().max(254),
  roleId: z.string().min(1),
  homeId: z.string().min(1).optional(),
  expiresInHours: z.coerce.number().int().min(1).max(720).optional(), // up to 30 days
});

const ListInvitationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'accepted', 'revoked', 'expired', 'all']).optional(),
});

const ResendInvitationBodySchema = z
  .object({
    expiresInHours: z.coerce.number().int().min(1).max(720).optional(),
  })
  .optional();

const PreviewInvitationParamsSchema = z.object({
  token: z.string().min(16),
});

const AcceptInvitationBodySchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  password: z.string().min(12).max(128).optional(),
});

const invitationRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Authenticated tenant-side: invitation management ─────────────────────
  await fastify.register(async (authed) => {
    authed.addHook('preHandler', fastify.authenticate);

    authed.get('/', {
      preHandler: [requirePermission(P.MEMBERS_READ)],
      schema: {
        tags: ['Invitations'],
        summary: 'List tenant invitations',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            status: { type: 'string', enum: ['pending', 'accepted', 'revoked', 'expired', 'all'] },
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
        const parse = ListInvitationsQuerySchema.safeParse(request.query);
        if (!parse.success) {
          return reply.status(422).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
          });
        }
        const userId = (request.user as JwtPayload).sub;
        const tenant = await requireTenantContext(userId);
        const result = await listInvitations({
          tenantId: tenant.tenantId,
          page: parse.data.page,
          pageSize: parse.data.pageSize,
          ...(parse.data.status ? { status: parse.data.status } : {}),
        });
        return reply.send({ success: true, ...result });
      },
    });

    authed.post('/', {
      preHandler: [requirePermission(P.MEMBERS_WRITE)],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['Invitations'],
        summary: 'Create an invitation for a new tenant member',
        body: {
          type: 'object',
          required: ['email', 'roleId'],
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            roleId: { type: 'string', minLength: 1 },
            homeId: { type: 'string', minLength: 1 },
            expiresInHours: { type: 'integer', minimum: 1, maximum: 720 },
          },
        },
        response: {
          201: {
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { type: 'object', additionalProperties: true },
            },
          },
          403: { $ref: 'ApiError#' },
          404: { $ref: 'ApiError#' },
          409: { $ref: 'ApiError#' },
          422: { $ref: 'ApiError#' },
        },
      },
      handler: async (request, reply) => {
        const parse = CreateInvitationBodySchema.safeParse(request.body);
        if (!parse.success) {
          return reply.status(422).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
          });
        }
        const userId = (request.user as JwtPayload).sub;
        const tenant = await requireTenantContext(userId);
        const { invitation, plaintextToken } = await createInvitation({
          invitedById: userId,
          tenantId: tenant.tenantId,
          email: parse.data.email,
          roleId: parse.data.roleId,
          ...(parse.data.homeId ? { homeId: parse.data.homeId } : {}),
          ...(parse.data.expiresInHours ? { expiresInHours: parse.data.expiresInHours } : {}),
        });

        // Fire-and-forget delivery; the route returns even if email fails.
        void sendInvitationEmail({ email: invitation.email, plaintextToken });

        return reply.status(201).send({
          success: true,
          data: {
            invitation: {
              id: invitation.id,
              email: invitation.email,
              role: { id: invitation.roleId, name: invitation.role.name },
              expiresAt: invitation.expiresAt,
              status: invitation.status,
              createdAt: invitation.createdAt,
            },
            // Returned to the inviter so they can copy the link if email
            // delivery fails. The plaintext token is NOT persisted.
            inviteLink: buildInviteLink(plaintextToken),
          },
        });
      },
    });

    authed.delete<{ Params: { id: string } }>('/:id', {
      preHandler: [requirePermission(P.MEMBERS_WRITE)],
      schema: {
        tags: ['Invitations'],
        summary: 'Revoke a pending invitation',
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
              data: { type: 'object', properties: { revoked: { type: 'boolean' } } },
            },
          },
          404: { $ref: 'ApiError#' },
          409: { $ref: 'ApiError#' },
        },
      },
      handler: async (request, reply) => {
        const userId = (request.user as JwtPayload).sub;
        const tenant = await requireTenantContext(userId);
        const result = await revokeInvitation({
          tenantId: tenant.tenantId,
          actorUserId: userId,
          invitationId: request.params.id,
        });
        return reply.send({ success: true, data: result });
      },
    });

    authed.post<{ Params: { id: string } }>('/:id/resend', {
      preHandler: [requirePermission(P.MEMBERS_WRITE)],
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['Invitations'],
        summary: 'Re-issue the invitation token (generates a fresh link)',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1 } },
        },
        body: {
          type: 'object',
          properties: {
            expiresInHours: { type: 'integer', minimum: 1, maximum: 720 },
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
        },
      },
      handler: async (request, reply) => {
        const parse = ResendInvitationBodySchema.safeParse(request.body ?? {});
        const expiresInHours = parse.success ? parse.data?.expiresInHours : undefined;
        const userId = (request.user as JwtPayload).sub;
        const tenant = await requireTenantContext(userId);
        const { invitation, plaintextToken } = await resendInvitation({
          tenantId: tenant.tenantId,
          actorUserId: userId,
          invitationId: request.params.id,
          ...(expiresInHours ? { expiresInHours } : {}),
        });
        void sendInvitationEmail({ email: invitation.email, plaintextToken });
        return reply.send({
          success: true,
          data: {
            invitation: {
              id: invitation.id,
              email: invitation.email,
              expiresAt: invitation.expiresAt,
              status: invitation.status,
            },
            inviteLink: buildInviteLink(plaintextToken),
          },
        });
      },
    });
  });
};

// ─── Public: invitation preview + accept ────────────────────────────────────

const publicInvitationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /auth/invitations/:token — pre-flight metadata so the FE can render
  // a "You've been invited to <Tenant Name> as <Role>" screen.
  fastify.get<{ Params: { token: string } }>('/:token', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Preview invitation metadata (public, by token)',
      params: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 16 } },
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
        410: { $ref: 'ApiError#' },
      },
      security: [],
    },
    handler: async (request, reply) => {
      const parse = PreviewInvitationParamsSchema.safeParse(request.params);
      if (!parse.success) {
        throw httpError(422, 'VALIDATION_ERROR', parse.error.issues[0]?.message ?? 'Invalid token.');
      }
      const invitation = await resolveInvitationByToken(parse.data.token);
      return reply.send({
        success: true,
        data: {
          tenant: { id: invitation.tenant.id, name: invitation.tenant.name, slug: invitation.tenant.slug },
          email: invitation.email,
          role: { id: invitation.role.id, name: invitation.role.name },
          home: invitation.home ? { id: invitation.home.id, name: invitation.home.name } : null,
          expiresAt: invitation.expiresAt,
        },
      });
    },
  });

  fastify.post<{ Params: { token: string } }>('/:token/accept', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['Auth'],
      summary: 'Accept an invitation by token',
      params: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 16 } },
      },
      body: {
        type: 'object',
        required: ['firstName', 'lastName'],
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          password: { type: 'string', minLength: 12, maxLength: 128 },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['userId', 'tenantId', 'message'],
              properties: {
                userId: { type: 'string' },
                tenantId: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        410: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
      security: [],
    },
    handler: async (request, reply) => {
      const paramsParse = PreviewInvitationParamsSchema.safeParse(request.params);
      if (!paramsParse.success) {
        throw httpError(422, 'VALIDATION_ERROR', paramsParse.error.issues[0]?.message ?? 'Invalid token.');
      }
      const bodyParse = AcceptInvitationBodySchema.safeParse(request.body);
      if (!bodyParse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: bodyParse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const result = await acceptInvitation({
        plaintextToken: paramsParse.data.token,
        firstName: bodyParse.data.firstName,
        lastName: bodyParse.data.lastName,
        ...(bodyParse.data.password ? { password: bodyParse.data.password } : {}),
      });
      return reply.send({
        success: true,
        data: {
          userId: result.userId,
          tenantId: result.tenantId,
          message: 'Invitation accepted. You can now sign in.',
        },
      });
    },
  });
};

function buildInviteLink(plaintextToken: string): string {
  // FE reads PUBLIC_BASE_URL or constructs from window.location; we just hand
  // the raw token + a path so the client can build the final link.
  return `/invitations/${plaintextToken}`;
}

export { invitationRoutes as default, publicInvitationRoutes };
