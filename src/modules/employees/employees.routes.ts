import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireScopedRole } from '../../middleware/rbac.js';
import * as employeesService from './employees.service.js';
import {
  CreateEmployeeBodySchema,
  CreateEmployeeWithUserBodySchema,
  ListEmployeesQuerySchema,
  UpdateEmployeeBodySchema,
  createEmployeeBodyJson,
  createEmployeeWithUserBodyJson,
  listEmployeesQueryJson,
  updateEmployeeBodyJson,
} from './employees.schema.js';

const employeeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    schema: {
      tags: ['Employees'],
      summary: 'List employees',
      querystring: listEmployeesQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { type: 'object' } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListEmployeesQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { data, meta } = await employeesService.listEmployees(actorId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Employees'],
      summary: 'Get employee',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object' },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await employeesService.getEmployee(actorId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['admin', 'manager'],
        tenantRoles: ['tenant_admin', 'sub_admin'],
      }),
    ],
    schema: {
      tags: ['Employees'],
      summary: 'Create employee',
      body: createEmployeeBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateEmployeeBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const data = await employeesService.createEmployee(actorId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['admin', 'manager'],
        tenantRoles: ['tenant_admin', 'sub_admin'],
      }),
    ],
    schema: {
      tags: ['Employees'],
      summary: 'Update employee',
      params: { $ref: 'CuidParam#' },
      body: updateEmployeeBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateEmployeeBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await employeesService.updateEmployee(actorId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.delete('/:id', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['admin', 'manager'],
        tenantRoles: ['tenant_admin', 'sub_admin'],
      }),
    ],
    schema: {
      tags: ['Employees'],
      summary: 'Deactivate employee',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['message'],
              properties: {
                message: { type: 'string', example: 'Employee deactivated.' },
              },
            },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await employeesService.deactivateEmployee(actorId, id);
      return reply.send({ success: true, data });
    },
  });
  // ─── Create employee with user (multi-step) ────────────────────────────────

  fastify.post('/create-with-user', {
    preHandler: [requireScopedRole({ globalRoles: ['admin', 'super_admin'], tenantRoles: ['tenant_admin'] })],
    schema: {
      tags: ['Employees'],
      summary: 'Create employee with new user account (multi-step)',
      body: createEmployeeWithUserBodyJson,
      response: {
        201: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', enum: [true] }, data: { type: 'object', additionalProperties: true } } },
        403: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateEmployeeWithUserBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message } });
      }
      const actorId = (request.user as JwtPayload).sub;
      const data = await employeesService.createEmployeeWithUser(actorId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });
};

export default employeeRoutes;
