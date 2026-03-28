import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import * as uploadsService from './uploads.service.js';
import {
  CompleteUploadBodySchema,
  CreateUploadSessionBodySchema,
  completeUploadBodyJson,
  createUploadSessionBodyJson,
} from './uploads.schema.js';

const uploadsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  fastify.post('/sessions', {
    schema: {
      tags: ['Uploads'],
      summary: 'Create upload session',
      description:
        'Creates a pending upload record and returns a presigned PUT URL for direct browser upload.',
      body: createUploadSessionBodyJson,
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['file', 'upload'],
              properties: {
                file: { $ref: 'UploadedFile#' },
                upload: {
                  type: 'object',
                  required: ['method', 'url', 'expiresAt', 'headers'],
                  properties: {
                    method: { type: 'string', enum: ['PUT'] },
                    url: { type: 'string', format: 'uri' },
                    expiresAt: { type: 'string', format: 'date-time' },
                    headers: {
                      type: 'object',
                      properties: {
                        'Content-Type': { type: 'string' },
                      },
                      additionalProperties: true,
                    },
                  },
                },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateUploadSessionBodySchema.safeParse(request.body);
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const data = await uploadsService.createUploadSession(actorUserId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.post('/:id/complete', {
    schema: {
      tags: ['Uploads'],
      summary: 'Complete upload session',
      description:
        'Marks pending upload as uploaded after verifying object exists in storage. Idempotent for completed uploads.',
      params: { $ref: 'CuidParam#' },
      body: completeUploadBodyJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['file', 'download'],
              properties: {
                file: { $ref: 'UploadedFile#' },
                download: {
                  type: 'object',
                  required: ['url', 'expiresAt'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        409: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CompleteUploadBodySchema.safeParse(request.body ?? {});
      if (!parse.success) {
        const message = parse.error.issues[0]?.message ?? 'Validation error.';
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message },
        });
      }

      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await uploadsService.completeUploadSession(actorUserId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id/download-url', {
    schema: {
      tags: ['Uploads'],
      summary: 'Get signed download URL',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['file', 'download'],
              properties: {
                file: { $ref: 'UploadedFile#' },
                download: {
                  type: 'object',
                  required: ['url', 'expiresAt'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    expiresAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const actorUserId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await uploadsService.getUploadDownloadUrl(actorUserId, id);
      return reply.send({ success: true, data });
    },
  });
};

export default uploadsRoutes;
