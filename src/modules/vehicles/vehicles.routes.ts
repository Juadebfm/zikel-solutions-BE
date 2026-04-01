import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireScopedRole } from '../../middleware/rbac.js';
import { generateExport, type ExportColumn } from '../../lib/export.js';
import { ExportFormatSchema } from '../../lib/export-schema.js';
import * as vehiclesService from './vehicles.service.js';
import {
  CreateVehicleBodySchema,
  ListVehiclesQuerySchema,
  UpdateVehicleBodySchema,
  createVehicleBodyJson,
  listVehiclesQueryJson,
  updateVehicleBodyJson,
} from './vehicles.schema.js';

const vehicleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    schema: {
      tags: ['Vehicles'],
      summary: 'List vehicles',
      querystring: listVehiclesQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { $ref: 'Vehicle#' } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListVehiclesQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { data, meta } = await vehiclesService.listVehicles(actorUserId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/export', {
    schema: {
      tags: ['Vehicles'],
      summary: 'Export vehicles as PDF or Excel',
      querystring: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ...listVehiclesQueryJson.properties,
          format: { type: 'string', enum: ['pdf', 'excel'], default: 'pdf' },
          pageSize: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const format = ExportFormatSchema.catch('pdf').parse(query.format);
      const parse = ListVehiclesQuerySchema.safeParse({ ...query, pageSize: Math.min(Number(query.pageSize) || 500, 5000) });
      if (!parse.success) {
        return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' } });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { data } = await vehiclesService.listVehicles(actorUserId, parse.data);

      const columns: ExportColumn[] = [
        { header: 'Registration', key: 'registration', width: 90 },
        { header: 'Make', key: 'make', width: 80 },
        { header: 'Model', key: 'model', width: 90 },
        { header: 'Year', key: 'year', width: 50 },
        { header: 'Status', key: 'status', width: 70 },
        { header: 'Fuel', key: 'fuelType', width: 60 },
        { header: 'Ownership', key: 'ownership', width: 80 },
        { header: 'MOT Due', key: 'motDueDate', width: 80 },
        { header: 'Next Service', key: 'nextServiceDate', width: 80 },
      ];

      const rows = data.map((v) => ({
        ...v,
        motDueDate: v.motDue ? new Date(String(v.motDue)).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
        nextServiceDate: v.nextServiceDue ? new Date(String(v.nextServiceDue)).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
      }));

      const result = await generateExport({ title: 'Vehicles', columns, rows, format });

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Vehicles'],
      summary: 'Get vehicle by ID',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'Vehicle#' },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await vehiclesService.getVehicle(actorUserId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['super_admin', 'admin', 'manager'],
        tenantRoles: ['tenant_admin', 'sub_admin'],
      }),
    ],
    schema: {
      tags: ['Vehicles'],
      summary: 'Create vehicle (manager/admin)',
      body: createVehicleBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'Vehicle#' },
          },
        },
        403: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateVehicleBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await vehiclesService.createVehicle(actorUserId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['super_admin', 'admin', 'manager'],
        tenantRoles: ['tenant_admin', 'sub_admin'],
      }),
    ],
    schema: {
      tags: ['Vehicles'],
      summary: 'Update vehicle (manager/admin)',
      params: { $ref: 'CuidParam#' },
      body: updateVehicleBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'Vehicle#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateVehicleBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await vehiclesService.updateVehicle(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.delete('/:id', {
    preHandler: [
      requireScopedRole({
        globalRoles: ['super_admin', 'admin', 'manager'],
        tenantRoles: ['tenant_admin', 'sub_admin'],
      }),
    ],
    schema: {
      tags: ['Vehicles'],
      summary: 'Deactivate vehicle (manager/admin)',
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
                message: { type: 'string', example: 'Vehicle deactivated.' },
              },
            },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await vehiclesService.deactivateVehicle(actorUserId, id);
      return reply.send({ success: true, data });
    },
  });
};

export default vehicleRoutes;
