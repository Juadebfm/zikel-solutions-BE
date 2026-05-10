import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requireActiveSubscription } from '../../middleware/billing-status.js';
import * as webhooksService from './webhooks.service.js';
import {
  CreateWebhookBodySchema,
  ListDeliveriesQuerySchema,
  UpdateWebhookBodySchema,
  createWebhookBodyJson,
  listDeliveriesQueryJson,
  updateWebhookBodyJson,
} from './webhooks.schema.js';

const webhooksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);
  fastify.addHook('preHandler', requireActiveSubscription);

  fastify.get('/', {
    schema: {
      tags: ['Webhooks'],
      summary: 'List webhook endpoints',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        403: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await webhooksService.listWebhookEndpoints(userId);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Register webhook endpoint',
      body: createWebhookBodyJson,
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
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = CreateWebhookBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const data = await webhooksService.createWebhookEndpoint(userId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/:id', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Update webhook endpoint',
      params: { $ref: 'CuidParam#' },
      body: updateWebhookBodyJson,
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
      const parse = UpdateWebhookBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await webhooksService.updateWebhookEndpoint(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.delete('/:id', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Delete webhook endpoint',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', properties: { message: { type: 'string' } } },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await webhooksService.deleteWebhookEndpoint(userId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.get('/:id/deliveries', {
    schema: {
      tags: ['Webhooks'],
      summary: 'List webhook deliveries',
      params: { $ref: 'CuidParam#' },
      querystring: listDeliveriesQueryJson,
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
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListDeliveriesQuerySchema.safeParse(request.query);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const result = await webhooksService.listDeliveries(userId, id, parse.data);
      return reply.send({ success: true, ...result });
    },
  });

  fastify.post('/:id/test', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Send test webhook payload',
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              properties: {
                deliveryId: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await webhooksService.sendTestPayload(userId, id);
      return reply.send({ success: true, data });
    },
  });
};

export default webhooksRoutes;
