import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireRole } from '../../middleware/rbac.js';
import * as tenantsService from './tenants.service.js';
import {
  AcceptTenantInviteBodySchema,
  AddTenantMemberBodySchema,
  CreateTenantInviteBodySchema,
  CreateTenantBodySchema,
  SelfServeCreateTenantBodySchema,
  ListTenantMembershipsQuerySchema,
  ListTenantInvitesQuerySchema,
  ListTenantsQuerySchema,
  UpdateTenantMemberBodySchema,
  acceptTenantInviteBodyJson,
  addTenantMemberBodyJson,
  createTenantInviteBodyJson,
  createTenantBodyJson,
  selfServeCreateTenantBodyJson,
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

  fastify.post('/self-serve', {
    config: { rateLimit: { max: 3, timeWindow: '10 minutes' } },
    schema: {
      tags: ['Tenants'],
      summary: 'Self-serve organization onboarding',
      description:
        'Creates a tenant and assigns the authenticated user as tenant_admin for first-time organization onboarding.',
      body: selfServeCreateTenantBodyJson,
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
                adminMembership: { $ref: 'TenantMembership#' },
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
      const parse = SelfServeCreateTenantBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await tenantsService.selfServeCreateTenant(actorUserId, parse.data);
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
