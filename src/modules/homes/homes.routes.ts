import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requirePermission } from "../../middleware/rbac.js";
import { Permissions as P } from "../../auth/permissions.js";
import { generateExport, type ExportColumn } from '../../lib/export.js';
import { ExportFormatSchema } from '../../lib/export-schema.js';
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

  fastify.get('/export', {
    schema: {
      tags: ['Homes'],
      summary: 'Export homes as PDF or Excel',
      querystring: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ...listHomesQueryJson.properties,
          format: { type: 'string', enum: ['pdf', 'excel'], default: 'pdf' },
          pageSize: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const format = ExportFormatSchema.catch('pdf').parse(query.format);
      const parse = ListHomesQuerySchema.safeParse({ ...query, pageSize: Math.min(Number(query.pageSize) || 500, 5000) });
      if (!parse.success) {
        return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' } });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { data } = await homesService.listHomes(actorId, parse.data);

      const columns: ExportColumn[] = [
        { header: 'Name', key: 'name', width: 140 },
        { header: 'Address', key: 'address', width: 180 },
        { header: 'Region', key: 'region', width: 90 },
        { header: 'Capacity', key: 'capacity', width: 60 },
        { header: 'Status', key: 'status', width: 70 },
        { header: 'Category', key: 'category', width: 100 },
        { header: 'Care Group', key: 'careGroupName', width: 110 },
        { header: 'Ofsted URN', key: 'ofstedUrn', width: 80 },
      ];

      const rows = data.map((h) => ({ ...h }));
      const result = await generateExport({ title: 'Homes', columns, rows, format });

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
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
            data: { type: 'object', additionalProperties: true },
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
      requirePermission(P.HOMES_WRITE),
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
            data: { type: 'object', additionalProperties: true },
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
      requirePermission(P.HOMES_WRITE),
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
            data: { type: 'object', additionalProperties: true },
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
      requirePermission(P.HOMES_WRITE),
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

  // ─── Home Sub-Resource Lists ─────────────────────────────────────────────

  fastify.get('/:id/young-people', {
    schema: { tags: ['Homes'], summary: 'List young people for a home', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { type: 'object', additionalProperties: true } }, meta: { $ref: 'PaginationMeta#' } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const q = request.query as { page?: string; pageSize?: string };
      const result = await homesService.listHomeYoungPeople(actorId, id, { page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
      return reply.send({ success: true, ...result });
    },
  });

  fastify.get('/:id/employees', {
    schema: { tags: ['Homes'], summary: 'List employees for a home', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { type: 'object', additionalProperties: true } }, meta: { $ref: 'PaginationMeta#' } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const q = request.query as { page?: string; pageSize?: string };
      const result = await homesService.listHomeEmployees(actorId, id, { page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
      return reply.send({ success: true, ...result });
    },
  });

  fastify.get('/:id/vehicles', {
    schema: { tags: ['Homes'], summary: 'List vehicles for a home', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { type: 'object', additionalProperties: true } }, meta: { $ref: 'PaginationMeta#' } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const q = request.query as { page?: string; pageSize?: string };
      const result = await homesService.listHomeVehicles(actorId, id, { page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
      return reply.send({ success: true, ...result });
    },
  });

  fastify.get('/:id/tasks', {
    schema: { tags: ['Homes'], summary: 'List tasks for a home', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { type: 'object', additionalProperties: true } }, meta: { $ref: 'PaginationMeta#' } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const q = request.query as { page?: string; pageSize?: string };
      const result = await homesService.listHomeTasks(actorId, id, { page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 });
      return reply.send({ success: true, ...result });
    },
  });

  // ─── Additional Reports ────────────────────────────────────────────────────

  fastify.get('/:id/reports/access', {
    schema: { tags: ['Homes'], summary: 'Access audit report — who accessed task logs', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const q = request.query as { page?: string; pageSize?: string };
      const data = await homesService.getHomeAccessReport(actorId, id, { page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 50 });
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id/reports/weekly-record', {
    schema: { tags: ['Homes'], summary: 'Weekly record report', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const q = request.query as { startDate?: string; endDate?: string };
      const now = new Date();
      const weekStart = q.startDate ?? new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const weekEnd = q.endDate ?? now.toISOString().slice(0, 10);
      const data = await homesService.getHomePeriodRecord(actorId, id, weekStart, weekEnd);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id/reports/monthly-record', {
    schema: { tags: ['Homes'], summary: 'Monthly record report', params: { $ref: 'CuidParam#' }, response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const q = request.query as { startDate?: string; endDate?: string };
      const now = new Date();
      const monthStart = q.startDate ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const monthEnd = q.endDate ?? now.toISOString().slice(0, 10);
      const data = await homesService.getHomePeriodRecord(actorId, id, monthStart, monthEnd);
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
    preHandler: [requirePermission(P.HOMES_WRITE)],
    schema: { tags: ['Homes'], summary: 'Create event at a home', params: { $ref: 'CuidParam#' }, response: { 201: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' }, 422: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const body = request.body as { title: string; description?: string; startsAt: string; endsAt?: string };
      const data = await homesService.createHomeEvent(actorId, id, body);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id/events/:eventId', {
    preHandler: [requirePermission(P.HOMES_WRITE)],
    schema: { tags: ['Homes'], summary: 'Update event', response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id, eventId } = request.params as { id: string; eventId: string };
      const body = request.body as { title?: string; description?: string | null; startsAt?: string; endsAt?: string | null };
      const data = await homesService.updateHomeEvent(actorId, id, eventId, body);
      return reply.send({ success: true, data });
    },
  });

  fastify.delete('/:id/events/:eventId', {
    preHandler: [requirePermission(P.HOMES_WRITE)],
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
    preHandler: [requirePermission(P.HOMES_WRITE)],
    schema: { tags: ['Homes'], summary: 'Create shift at a home', params: { $ref: 'CuidParam#' }, response: { 201: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' }, 422: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const body = request.body as { employeeId: string; startTime: string; endTime: string };
      const data = await homesService.createHomeShift(actorId, id, body);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id/shifts/:shiftId', {
    preHandler: [requirePermission(P.HOMES_WRITE)],
    schema: { tags: ['Homes'], summary: 'Update shift', response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } }, 404: { $ref: 'ApiError#' } } },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id, shiftId } = request.params as { id: string; shiftId: string };
      const body = request.body as { employeeId?: string; startTime?: string; endTime?: string };
      const data = await homesService.updateHomeShift(actorId, id, shiftId, body);
      return reply.send({ success: true, data });
    },
  });

  fastify.delete('/:id/shifts/:shiftId', {
    preHandler: [requirePermission(P.HOMES_WRITE)],
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
