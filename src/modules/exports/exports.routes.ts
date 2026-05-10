import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireActiveSubscription } from '../../middleware/billing-status.js';
import {
  CreateExportJobBodySchema,
  ListExportJobsQuerySchema,
  createExportJobBodyJson,
  listExportJobsQueryJson,
} from './exports.schema.js';
import * as exportsService from './exports.service.js';

const exportsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);
  // Phase 7.7: exports are paid-for compute. GETs (list/get jobs) pass
  // through; POST (create new job) is blocked in past_due_readonly.
  fastify.addHook('preHandler', requireActiveSubscription);

  fastify.post('/', {
    schema: {
      tags: ['Exports'],
      summary: 'Create export job',
      body: createExportJobBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateExportJobBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const data = await exportsService.createExportJob(actorId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.get('/', {
    schema: {
      tags: ['Exports'],
      summary: 'List export jobs',
      querystring: listExportJobsQueryJson,
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
      const parse = ListExportJobsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorId = (request.user as JwtPayload).sub;
      const { data, meta } = await exportsService.listExportJobs(actorId, parse.data);
      return reply.send({ success: true, data, meta });
    },
  });

  fastify.get('/:id', {
    schema: {
      tags: ['Exports'],
      summary: 'Get export job',
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
      const data = await exportsService.getExportJob(actorId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id/download', {
    schema: {
      tags: ['Exports'],
      summary: 'Download completed export',
      params: { $ref: 'CuidParam#' },
      response: {
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const result = await exportsService.downloadExportJob(actorId, id);

      return reply
        .header('Content-Type', result.contentType)
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    },
  });
};

export default exportsRoutes;
