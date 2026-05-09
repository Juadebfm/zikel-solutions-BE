import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requirePermission } from '../../middleware/rbac.js';
import { Permissions as P } from '../../auth/permissions.js';
import { generateExport, type ExportColumn } from '../../lib/export.js';
import { ExportFormatSchema } from '../../lib/export-schema.js';
import * as employeesService from './employees.service.js';
import {
  CreateEmployeeBodySchema,
  ListEmployeesQuerySchema,
  UpdateEmployeeBodySchema,
  createEmployeeBodyJson,
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
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
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

  fastify.get('/export', {
    schema: {
      tags: ['Employees'],
      summary: 'Export employees as PDF or Excel',
      querystring: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ...listEmployeesQueryJson.properties,
          format: { type: 'string', enum: ['pdf', 'excel'], default: 'pdf' },
          pageSize: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const format = ExportFormatSchema.catch('pdf').parse(query.format);
      const parse = ListEmployeesQuerySchema.safeParse({ ...query, pageSize: Math.min(Number(query.pageSize) || 500, 5000) });
      if (!parse.success) {
        return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' } });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { data } = await employeesService.listEmployees(actorId, parse.data);

      const columns: ExportColumn[] = [
        { header: 'Name', key: 'name', width: 140 },
        { header: 'Email', key: 'email', width: 160 },
        { header: 'Job Title', key: 'jobTitle', width: 120 },
        { header: 'Role', key: 'roleName', width: 100 },
        { header: 'Home', key: 'homeName', width: 120 },
        { header: 'Status', key: 'status', width: 70 },
        { header: 'Contract', key: 'contractType', width: 80 },
        { header: 'DBS Number', key: 'dbsNumber', width: 100 },
      ];

      const rows = data.map((e) => ({
        ...e,
        name: e.user ? `${e.user.firstName} ${e.user.lastName}` : '',
        email: e.user?.email ?? '',
      }));

      const result = await generateExport({ title: 'Employees', columns, rows, format });

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
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
            data: { type: 'object', additionalProperties: true },
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
      requirePermission(P.EMPLOYEES_WRITE),
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
      requirePermission(P.EMPLOYEES_WRITE),
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
            data: { type: 'object', additionalProperties: true },
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
      requirePermission(P.EMPLOYEES_DEACTIVATE),
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
  // Phase 5: removed POST /employees/create-with-user. Admins now invite new
  // staff via POST /api/v1/invitations — the recipient sets their own password
  // when accepting, and an Employee record is auto-provisioned if a homeId is
  // attached to the invitation.
};

export default employeeRoutes;
