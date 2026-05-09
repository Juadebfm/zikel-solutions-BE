import type { FastifyPluginAsync } from 'fastify';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import { requirePermission } from '../../middleware/rbac.js';
import { Permissions as P } from '../../auth/permissions.js';
import * as faqsService from './faqs.service.js';
import * as ticketsService from './tickets.service.js';
import {
  CreateFaqBodySchema,
  ListFaqsQuerySchema,
  UpdateFaqBodySchema,
  createFaqBodyJson,
  listFaqsQueryJson,
  updateFaqBodyJson,
} from './faqs.schema.js';
import {
  CreateTicketBodySchema,
  CreateTicketCommentBodySchema,
  ListTicketsQuerySchema,
  UpdateTicketBodySchema,
  createTicketBodyJson,
  createTicketCommentBodyJson,
  listTicketsQueryJson,
  updateTicketBodyJson,
} from './tickets.schema.js';

const helpCenterRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  /* ── FAQs ────────────────────────────────────────────────────────────── */

  fastify.get('/faqs', {
    schema: {
      tags: ['Help Center'],
      summary: 'List published FAQ articles',
      querystring: listFaqsQueryJson,
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
      const parse = ListFaqsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const result = await faqsService.listFaqs(parse.data);
      return reply.send({ success: true, ...result });
    },
  });

  fastify.get('/faqs/:id', {
    schema: {
      tags: ['Help Center'],
      summary: 'Get FAQ article',
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
      const { id } = request.params as { id: string };
      const data = await faqsService.getFaq(id);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/faqs', {
    preHandler: [requirePermission(P.HELP_CENTER_ADMIN)],
    schema: {
      tags: ['Help Center'],
      summary: 'Create FAQ article',
      body: createFaqBodyJson,
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
      const parse = CreateFaqBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const data = await faqsService.createFaq(userId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.patch('/faqs/:id', {
    preHandler: [requirePermission(P.HELP_CENTER_ADMIN)],
    schema: {
      tags: ['Help Center'],
      summary: 'Update FAQ article',
      params: { $ref: 'CuidParam#' },
      body: updateFaqBodyJson,
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
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateFaqBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const { id } = request.params as { id: string };
      const data = await faqsService.updateFaq(id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.delete('/faqs/:id', {
    preHandler: [requirePermission(P.HELP_CENTER_ADMIN)],
    schema: {
      tags: ['Help Center'],
      summary: 'Delete FAQ article',
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
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const data = await faqsService.deleteFaq(id);
      return reply.send({ success: true, data });
    },
  });

  /* ── Tickets ─────────────────────────────────────────────────────────── */

  fastify.post('/tickets', {
    schema: {
      tags: ['Help Center'],
      summary: 'Create support ticket',
      body: createTicketBodyJson,
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
      const parse = CreateTicketBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const data = await ticketsService.createTicket(userId, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.get('/tickets', {
    schema: {
      tags: ['Help Center'],
      summary: 'List support tickets',
      querystring: listTicketsQueryJson,
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
      const parse = ListTicketsQuerySchema.safeParse(request.query);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const result = await ticketsService.listTickets(userId, parse.data);
      return reply.send({ success: true, ...result });
    },
  });

  fastify.get('/tickets/:id', {
    schema: {
      tags: ['Help Center'],
      summary: 'Get support ticket with comments',
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
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await ticketsService.getTicket(userId, id);
      return reply.send({ success: true, data });
    },
  });

  fastify.patch('/tickets/:id', {
    schema: {
      tags: ['Help Center'],
      summary: 'Update ticket status/priority/category',
      params: { $ref: 'CuidParam#' },
      body: updateTicketBodyJson,
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
      const parse = UpdateTicketBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await ticketsService.updateTicket(userId, id, parse.data);
      return reply.send({ success: true, data });
    },
  });

  fastify.post('/tickets/:id/comments', {
    schema: {
      tags: ['Help Center'],
      summary: 'Add comment to ticket',
      params: { $ref: 'CuidParam#' },
      body: createTicketCommentBodyJson,
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
      const parse = CreateTicketCommentBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const { id } = request.params as { id: string };
      const data = await ticketsService.addComment(userId, id, parse.data);
      return reply.status(201).send({ success: true, data });
    },
  });

  fastify.delete('/tickets/:id', {
    schema: {
      tags: ['Help Center'],
      summary: 'Close support ticket',
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
      const data = await ticketsService.closeTicket(userId, id);
      return reply.send({ success: true, data });
    },
  });
};

export default helpCenterRoutes;
