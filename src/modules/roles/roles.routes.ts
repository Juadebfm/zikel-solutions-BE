import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireScopedRole } from '../../middleware/rbac.js';
import * as rolesService from './roles.service.js';
import {
  CreateRoleBodySchema,
  UpdateRoleBodySchema,
  ListRolesQuerySchema,
  createRoleBodyJson,
  updateRoleBodyJson,
  listRolesQueryJson,
} from './roles.schema.js';

const roleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  // ─── List roles ────────────────────────────────────────────────────────────

  fastify.get('/', {
    schema: {
      tags: ['Roles'],
      summary: 'List roles',
      querystring: listRolesQueryJson,
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
      const parse = ListRolesQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({ success: false as const, error: { code: 'VALIDATION_ERROR', message } });
      }
      const userId = (request.user as JwtPayload).sub;
      const { data, meta } = await rolesService.listRoles(userId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  // ─── Get role ──────────────────────────────────────────────────────────────

  fastify.get('/:id', {
    schema: {
      tags: ['Roles'],
      summary: 'Get role by ID',
      params: { $ref: 'CuidParam#' },
      response: {
        200: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', enum: [true] }, data: { type: 'object', additionalProperties: true } } },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await rolesService.getRole(userId, id);
      return reply.send({ success: true, data });
    },
  });

  // ─── Create role ───────────────────────────────────────────────────────────

  fastify.post('/', {
    preHandler: [requireScopedRole({ globalRoles: ['admin', 'super_admin'], tenantRoles: ['tenant_admin'] })],
    schema: {
      tags: ['Roles'],
      summary: 'Create a role',
      body: createRoleBodyJson,
      response: {
        201: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', enum: [true] }, data: { type: 'object', additionalProperties: true } } },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateRoleBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' } });
      }
      const userId = (request.user as JwtPayload).sub;
      const data = await rolesService.createRole(userId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  // ─── Update role ───────────────────────────────────────────────────────────

  fastify.patch('/:id', {
    preHandler: [requireScopedRole({ globalRoles: ['admin', 'super_admin'], tenantRoles: ['tenant_admin'] })],
    schema: {
      tags: ['Roles'],
      summary: 'Update a role',
      params: { $ref: 'CuidParam#' },
      body: updateRoleBodyJson,
      response: {
        200: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', enum: [true] }, data: { type: 'object', additionalProperties: true } } },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateRoleBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' } });
      }
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await rolesService.updateRole(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  // ─── Bulk update permissions ─────────────────────────────────────────────

  fastify.patch('/:id/permissions', {
    preHandler: [requireScopedRole({ globalRoles: ['admin', 'super_admin'], tenantRoles: ['tenant_admin'] })],
    schema: {
      tags: ['Roles'],
      summary: 'Bulk update role permissions',
      params: { $ref: 'CuidParam#' },
      response: {
        200: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', enum: [true] }, data: { type: 'object', additionalProperties: true } } },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const data = await rolesService.updateRole(userId, id, { permissions: body });
      return reply.send({ success: true, data });
    },
  });

  // ─── Delete role ───────────────────────────────────────────────────────────

  fastify.delete('/:id', {
    preHandler: [requireScopedRole({ globalRoles: ['admin', 'super_admin'], tenantRoles: ['tenant_admin'] })],
    schema: {
      tags: ['Roles'],
      summary: 'Deactivate a role',
      params: { $ref: 'CuidParam#' },
      response: {
        200: { type: 'object', required: ['success'], properties: { success: { type: 'boolean', enum: [true] } } },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      await rolesService.deactivateRole(userId, id);
      return reply.send({ success: true });
    },
  });
};

export default roleRoutes;
