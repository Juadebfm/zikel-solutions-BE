import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireRole } from '../../middleware/rbac.js';
import * as tenantsService from './tenants.service.js';
import {
  AcceptTenantInviteBodySchema,
  AddTenantMemberBodySchema,
  CreateInviteLinkBodySchema,
  CreateTenantInviteBodySchema,
  CreateTenantBodySchema,
  ProvisionStaffBodySchema,
  ListTenantMembershipsQuerySchema,
  ListTenantInvitesQuerySchema,
  ListTenantsQuerySchema,
  UpdateTenantMemberBodySchema,
  acceptTenantInviteBodyJson,
  addTenantMemberBodyJson,
  createInviteLinkBodyJson,
  createTenantInviteBodyJson,
  createTenantBodyJson,
  provisionStaffBodyJson,
  listTenantMembershipsQueryJson,
  listTenantInvitesQueryJson,
  listTenantsQueryJson,
  updateTenantMemberBodyJson,
} from './tenants.schema.js';

const membershipParamsJson = {
  type: 'object',
  required: ['id', 'membershipId'],
  properties: {
    id: { type: 'string' },
    membershipId: { type: 'string' },
  },
} as const;

const inviteParamsJson = {
  type: 'object',
  required: ['id', 'inviteId'],
  properties: {
    id: { type: 'string' },
    inviteId: { type: 'string' },
  },
} as const;

const tenantRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    preHandler: [requireRole('super_admin')],
    schema: {
      tags: ['Tenants'],
      summary: 'List tenants (super-admin only)',
      querystring: listTenantsQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { $ref: 'Tenant#' } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListTenantsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const { data, meta } = await tenantsService.listTenants(parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/:id', {
    preHandler: [requireRole('super_admin')],
    schema: {
      tags: ['Tenants'],
      summary: 'Get tenant details (super-admin only)',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              allOf: [
                { $ref: 'Tenant#' },
                {
                  type: 'object',
                  required: ['memberships'],
                  properties: {
                    memberships: {
                      type: 'array',
                      items: { $ref: 'TenantMembership#' },
                    },
                  },
                },
              ],
            },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const data = await tenantsService.getTenantById(id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/', {
    preHandler: [requireRole('super_admin')],
    schema: {
      tags: ['Tenants'],
      summary: 'Provision tenant (super-admin only)',
      description:
        'Creates a tenant and optionally assigns an initial tenant admin from an existing user.',
      body: createTenantBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['tenant', 'adminMembership'],
              properties: {
                tenant: { $ref: 'Tenant#' },
                adminMembership: {
                  anyOf: [{ $ref: 'TenantMembership#' }, { type: 'null' }],
                },
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
      const parse = CreateTenantBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await tenantsService.createTenant(actorUserId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.get('/:id/memberships', {
    schema: {
      tags: ['Tenants'],
      summary: 'List tenant memberships (scoped)',
      params: { $ref: 'CuidParam#' },
      querystring: listTenantMembershipsQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { $ref: 'TenantMembership#' } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListTenantMembershipsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actor = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const { data, meta } = await tenantsService.listTenantMemberships(
        actor.sub,
        actor.role,
        id,
        parse.data,
      );
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.post('/:id/memberships', {
    schema: {
      tags: ['Tenants'],
      summary: 'Add tenant membership (scoped)',
      params: { $ref: 'CuidParam#' },
      body: addTenantMemberBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'TenantMembership#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = AddTenantMemberBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actor = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const data = await tenantsService.addTenantMembership(actor.sub, actor.role, id, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id/memberships/:membershipId', {
    schema: {
      tags: ['Tenants'],
      summary: 'Update tenant membership (scoped)',
      params: membershipParamsJson,
      body: updateTenantMemberBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'TenantMembership#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateTenantMemberBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actor = request.user as JwtPayload;
      const { id, membershipId } = request.params as { id: string; membershipId: string };
      const data = await tenantsService.updateTenantMembership(
        actor.sub,
        actor.role,
        id,
        membershipId,
        parse.data,
      );
      return reply.send({ success: true, data });
    },
  });

  // ── POST /:id/staff — Provision staff account ─────────────────────────────
  fastify.post('/:id/staff', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['Tenants'],
      summary: 'Provision a staff account (admin-driven)',
      description:
        'Creates a pre-provisioned user account for a staff member and sends them an activation email. ' +
        'The staff member activates via /auth/staff-activate with their OTP code and a new password.',
      params: { $ref: 'CuidParam#' },
      body: provisionStaffBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['user', 'membership', 'tenantName'],
              properties: {
                user: {
                  type: 'object',
                  required: ['id', 'email', 'firstName', 'lastName'],
                  properties: {
                    id: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                  },
                },
                membership: { $ref: 'TenantMembership#' },
                tenantName: { type: 'string' },
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
      const parse = ProvisionStaffBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actor = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const data = await tenantsService.provisionStaff(
        actor.sub,
        actor.role,
        id,
        parse.data,
      );
      return reply.status(201).send({ success: true, data });
    },
  });

  // ── Invite Links (self-service staff registration) ─────────────────────────

  const createInviteLinkJsonSchema = {
    tags: ['Tenants'],
    summary: 'Generate org invite link (admin)',
    description: 'Creates a reusable invite link that can be shared with staff for self-registration.',
    params: { $ref: 'CuidParam#' },
    body: createInviteLinkBodyJson,
    response: {
      201: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            required: ['id', 'tenantId', 'code', 'defaultRole', 'isActive', 'createdAt'],
            properties: {
              id: { type: 'string' },
              tenantId: { type: 'string' },
              tenantName: { type: 'string' },
              code: { type: 'string' },
              defaultRole: { type: 'string', enum: ['sub_admin', 'staff'] },
              isActive: { type: 'boolean' },
              expiresAt: { type: 'string', format: 'date-time', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      403: { $ref: 'ApiError#' },
      404: { $ref: 'ApiError#' },
      422: { $ref: 'ApiError#' },
    },
  } as const;

  async function handleCreateInviteLink(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const parse = CreateInviteLinkBodySchema.safeParse(request.body);
    if (!parse.success) {
      const message = parse.error.issues[0]?.message ?? 'Validation error.';
      return reply.status(422).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message },
      });
    }

    const actor = request.user as JwtPayload;
    const { id } = request.params;
    const data = await tenantsService.createInviteLink(actor.sub, actor.role, id, parse.data);
    return reply.status(201).send({ success: true, data });
  }

  fastify.post('/:id/invite-link', {
    schema: createInviteLinkJsonSchema,
    handler: handleCreateInviteLink,
  });

  fastify.post('/:id/invite-links', {
    schema: {
      ...createInviteLinkJsonSchema,
      summary: 'Generate org invite link (admin) — preferred path',
      description:
        'Same as POST /tenants/:id/invite-link. Creates a reusable invite link for self-registration.',
    },
    handler: handleCreateInviteLink,
  });

  fastify.get('/:id/invite-links', {
    schema: {
      tags: ['Tenants'],
      summary: 'List active invite links (admin)',
      params: { $ref: 'CuidParam#' },
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
                required: ['id', 'tenantId', 'code', 'defaultRole', 'isActive', 'createdAt'],
                properties: {
                  id: { type: 'string' },
                  tenantId: { type: 'string' },
                  tenantName: { type: 'string' },
                  code: { type: 'string' },
                  defaultRole: { type: 'string', enum: ['sub_admin', 'staff'] },
                  isActive: { type: 'boolean' },
                  expiresAt: { type: 'string', format: 'date-time', nullable: true },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const { id } = request.params as { id: string };
      const data = await tenantsService.getInviteLink(actor.sub, actor.role, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/:id/invite-links/:linkId/revoke', {
    schema: {
      tags: ['Tenants'],
      summary: 'Revoke an invite link',
      params: {
        type: 'object',
        required: ['id', 'linkId'],
        properties: {
          id: { type: 'string' },
          linkId: { type: 'string' },
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
              required: ['id', 'isActive'],
              properties: {
                id: { type: 'string' },
                isActive: { type: 'boolean' },
              },
            },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const { id, linkId } = request.params as { id: string; linkId: string };
      const data = await tenantsService.revokeInviteLink(actor.sub, actor.role, id, linkId);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id/invites', {
    schema: {
      tags: ['Tenants'],
      summary: 'List tenant invites (scoped)',
      params: { $ref: 'CuidParam#' },
      querystring: listTenantInvitesQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { $ref: 'TenantInvite#' } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListTenantInvitesQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const { id } = request.params as { id: string };
      const actor = request.user as JwtPayload;
      const { data, meta } = await tenantsService.listTenantInvites(
        actor.sub,
        actor.role,
        id,
        parse.data,
      );
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.post('/:id/invites', {
    schema: {
      tags: ['Tenants'],
      summary: 'Create tenant invite (tokenized, scoped)',
      params: { $ref: 'CuidParam#' },
      body: createTenantInviteBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['invite', 'inviteToken'],
              properties: {
                invite: { $ref: 'TenantInvite#' },
                inviteToken: { type: 'string' },
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
      const parse = CreateTenantInviteBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const { id } = request.params as { id: string };
      const actor = request.user as JwtPayload;
      const data = await tenantsService.createTenantInvite(
        actor.sub,
        actor.role,
        id,
        parse.data,
      );
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id/invites/:inviteId/revoke', {
    schema: {
      tags: ['Tenants'],
      summary: 'Revoke tenant invite (scoped)',
      params: inviteParamsJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'TenantInvite#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actor = request.user as JwtPayload;
      const { id, inviteId } = request.params as { id: string; inviteId: string };
      const data = await tenantsService.revokeTenantInvite(actor.sub, actor.role, id, inviteId);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/invites/accept', {
    schema: {
      tags: ['Tenants'],
      summary: 'Accept tenant invite',
      body: acceptTenantInviteBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['membership', 'invite'],
              properties: {
                membership: { $ref: 'TenantMembership#' },
                invite: { $ref: 'TenantInvite#' },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        410: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = AcceptTenantInviteBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actor = request.user as JwtPayload;
      const data = await tenantsService.acceptTenantInvite(actor.sub, actor.email, parse.data);
      return reply.send({ success: true, data });
    },
  });
};

export default tenantRoutes;
