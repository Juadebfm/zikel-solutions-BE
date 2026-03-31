import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireScopedRole } from '../../middleware/rbac.js';
import * as homesService from './homes.service.js';
import {
  CreateHomeBodySchema,
  ListHomesQuerySchema,
  UpdateHomeBodySchema,
  createHomeBodyJson,
  listHomesQueryJson,
  updateHomeBodyJson,
} from './homes.schema.js';

const homeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    schema: {
      tags: ['Homes'],
      summary: 'List homes',
      querystring: listHomesQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'careGroupId', 'name', 'isActive', 'createdAt', 'updatedAt'],
                properties: {
                  id: { type: 'string' },
                  careGroupId: { type: 'string' },
                  careGroupName: { type: ['string', 'null'] },
                  name: { type: 'string' },
                  address: { type: ['string', 'null'] },
                  capacity: { type: ['integer', 'null'] },
                  isActive: { type: 'boolean' },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListHomesQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { data, meta } = await homesService.listHomes(actorId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Homes'],
      summary: 'Get home',
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
      const data = await homesService.getHome(actorId, id);
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
      tags: ['Homes'],
      summary: 'Create home',
      body: createHomeBodyJson,
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
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateHomeBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const data = await homesService.createHome(actorId, parse.data);
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
      tags: ['Homes'],
      summary: 'Update home',
      params: { $ref: 'CuidParam#' },
      body: updateHomeBodyJson,
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
      const parse = UpdateHomeBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await homesService.updateHome(actorId, id, parse.data);
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
      tags: ['Homes'],
      summary: 'Deactivate home',
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
                message: { type: 'string', example: 'Home deactivated.' },
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
      const data = await homesService.deactivateHome(actorId, id);
      return reply.send({ success: true, data });
    },
  });
  // ─── Home Summary ────────────────────────────────────────────────────────

  fastify.get('/:id/summary', {
    schema: { tags: ['Homes'], summary: 'Get home summary with YPs, staff, vehicles, events, shifts, task stats', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await homesService.getHomeSummary(actorId, id);
      return reply.send({ success: true, data });
    },
  });

  // ─── Reports ───────────────────────────────────────────────────────────────

  fastify.get('/:id/reports/daily-audit', {
    schema: { tags: ['Homes'], summary: 'Daily audit report for a home', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const query = request.query as { date?: string };
      const date = query.date ?? new Date().toISOString().slice(0, 10);
      const data = await homesService.getHomeDailyAudit(actorId, id, date);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id/reports/employee-stats', {
    schema: { tags: ['Homes'], summary: 'Employee stats for Ofsted', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await homesService.getHomeEmployeeStats(actorId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id/reports/statistics', {
    schema: { tags: ['Homes'], summary: 'Home statistics overview', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await homesService.getHomeStatistics(actorId, id);
      return reply.send({ success: true, data });
    },
  });

  // ─── Home Events ──────────────────────────────────────────────────────────

  fastify.get('/:id/events', {
    schema: { tags: ['Homes'], summary: 'List events for a home', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { type: 'object', additionalProperties: true } }, meta: { $ref: 'PaginationMeta#' } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const query = request.query as { page?: string; pageSize?: string };
      const result = await homesService.listHomeEvents(actorId, id, { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 });
      return reply.send({ success: true, ...result });
    },
  });

  fastify.post('/:id/events', {
    preHandler: [requireScopedRole({ globalRoles: ['admin', 'manager'], tenantRoles: ['tenant_admin', 'sub_admin'] })],
    schema: { tags: ['Homes'], summary: 'Create event at a home', params: { $ref: 'CuidParam#' }, response: { 201: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' }, 422: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const body = request.body as { title: string; description?: string; startsAt: string; endsAt?: string };
      const data = await homesService.createHomeEvent(actorId, id, body);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.delete('/:id/events/:eventId', {
    preHandler: [requireScopedRole({ globalRoles: ['admin', 'manager'], tenantRoles: ['tenant_admin', 'sub_admin'] })],
    schema: { tags: ['Homes'], summary: 'Delete event', response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id, eventId } = request.params as { id: string; eventId: string };
      await homesService.deleteHomeEvent(actorId, id, eventId);
      return reply.send({ success: true });
    },
  });

  // ─── Employee Shifts ─────────────────────────────────────────────────────

  fastify.get('/:id/shifts', {
    schema: { tags: ['Homes'], summary: 'List shifts for a home', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { type: 'object', additionalProperties: true } }, meta: { $ref: 'PaginationMeta#' } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const query = request.query as { page?: string; pageSize?: string };
      const result = await homesService.listHomeShifts(actorId, id, { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 });
      return reply.send({ success: true, ...result });
    },
  });

  fastify.post('/:id/shifts', {
    preHandler: [requireScopedRole({ globalRoles: ['admin', 'manager'], tenantRoles: ['tenant_admin', 'sub_admin'] })],
    schema: { tags: ['Homes'], summary: 'Create shift at a home', params: { $ref: 'CuidParam#' }, response: { 201: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' }, 422: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const body = request.body as { employeeId: string; startTime: string; endTime: string };
      const data = await homesService.createHomeShift(actorId, id, body);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.delete('/:id/shifts/:shiftId', {
    preHandler: [requireScopedRole({ globalRoles: ['admin', 'manager'], tenantRoles: ['tenant_admin', 'sub_admin'] })],
    schema: { tags: ['Homes'], summary: 'Delete shift', response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id, shiftId } = request.params as { id: string; shiftId: string };
      await homesService.deleteHomeShift(actorId, id, shiftId);
      return reply.send({ success: true });
    },
  });
};

export default homeRoutes;
