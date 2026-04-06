import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireScopedRole } from '../../middleware/rbac.js';
import { generateExport, type ExportColumn } from '../../lib/export.js';
import { ExportFormatSchema } from '../../lib/export-schema.js';
import * as youngPeopleService from './young-people.service.js';
import {
  CreateYoungPersonBodySchema,
  ListYoungPeopleQuerySchema,
  UpdateYoungPersonBodySchema,
  createYoungPersonBodyJson,
  listYoungPeopleQueryJson,
  updateYoungPersonBodyJson,
} from './young-people.schema.js';

const youngPeopleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.get('/', {
    schema: {
      tags: ['Young People'],
      summary: 'List young people',
      querystring: listYoungPeopleQueryJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data', 'meta'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { $ref: 'YoungPerson#' } },
            meta: { $ref: 'PaginationMeta#' },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListYoungPeopleQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { data, meta } = await youngPeopleService.listYoungPeople(actorId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/export', {
    schema: {
      tags: ['Young People'],
      summary: 'Export young people as PDF or Excel',
      querystring: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ...listYoungPeopleQueryJson.properties,
          format: { type: 'string', enum: ['pdf', 'excel'], default: 'pdf' },
          pageSize: { type: 'integer', minimum: 1, maximum: 5000, default: 500 },
        },
      },
    },
    handler: async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const format = ExportFormatSchema.catch('pdf').parse(query.format);
      const parse = ListYoungPeopleQuerySchema.safeParse({ ...query, pageSize: Math.min(Number(query.pageSize) || 500, 5000) });
      if (!parse.success) {
        return reply.status(422).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' } });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { data } = await youngPeopleService.listYoungPeople(actorId, parse.data);

      const columns: ExportColumn[] = [
        { header: 'Ref', key: 'referenceNo', width: 80 },
        { header: 'Name', key: 'name', width: 130 },
        { header: 'Date of Birth', key: 'dob', width: 80 },
        { header: 'Gender', key: 'gender', width: 60 },
        { header: 'Home', key: 'homeName', width: 120 },
        { header: 'Status', key: 'status', width: 70 },
        { header: 'Key Worker', key: 'keyWorkerName', width: 110 },
        { header: 'Placing Authority', key: 'placingAuthority', width: 140 },
        { header: 'Admission Date', key: 'admissionDate', width: 80 },
      ];

      const rows = data.map((yp) => ({
        ...yp,
        name: `${yp.firstName} ${yp.lastName}`,
        dob: yp.dateOfBirth ? new Date(String(yp.dateOfBirth)).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
        keyWorkerName: (yp.keyWorker as Record<string, unknown> | null)?.name ?? '',
        admissionDate: yp.admissionDate ? new Date(String(yp.admissionDate)).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '',
      }));

      const result = await generateExport({ title: 'Young People', columns, rows, format });

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Young People'],
      summary: 'Get young person',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'YoungPerson#' },
          },
        },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await youngPeopleService.getYoungPerson(actorId, id);
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
      tags: ['Young People'],
      summary: 'Create young person',
      body: createYoungPersonBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'YoungPerson#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateYoungPersonBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const data = await youngPeopleService.createYoungPerson(actorId, parse.data);
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
      tags: ['Young People'],
      summary: 'Update young person',
      params: { $ref: 'CuidParam#' },
      body: updateYoungPersonBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'YoungPerson#' },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateYoungPersonBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await youngPeopleService.updateYoungPerson(actorId, id, parse.data);
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
      tags: ['Young People'],
      summary: 'Deactivate young person',
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
                message: { type: 'string', example: 'Young person deactivated.' },
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
      const data = await youngPeopleService.deactivateYoungPerson(actorId, id);
      return reply.send({ success: true, data });
    },
  });
};

export default youngPeopleRoutes;
