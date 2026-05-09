/**
 * Phase 8.2 — `/api/v1/ai/conversations/*` — conversational AI surface.
 *
 * Sits alongside the existing `/api/v1/ai/ask` (page-aware structured cards
 * for dashboard widgets); both share the AI gate and (Phase 7.4) quota.
 *
 * Decisions locked in payment.md:
 *   - No streaming: full response in one chunk on `POST .../messages`
 *   - Conversations kept forever (archive flag, hard-delete on explicit request)
 *   - Pure free-form (no page binding)
 *   - User-scoped: many conversations per user
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../../types/index.js';
import { requirePrivilegedMfa } from '../../middleware/mfa.js';
import * as conversationsService from './conversations.service.js';

const PostMessageBodySchema = z.object({
  content: z.string().min(1).max(8_000),
});

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

const UpdateBodySchema = z
  .object({
    title: z.string().min(1).max(120).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (b) => b.title !== undefined || b.archived !== undefined,
    'At least one of `title` or `archived` must be provided.',
  );

const conversationParamsJson = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

const conversationsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requirePrivilegedMfa);

  // ── POST /api/v1/ai/conversations — create new conversation ────────────
  fastify.post('/', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['AI'],
      summary: 'Start a new AI conversation',
      response: {
        201: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await conversationsService.createConversation({ userId });
      return reply.status(201).send({ success: true, data });
    },
  });

  // ── GET /api/v1/ai/conversations — list user's conversations ───────────
  fastify.get('/', {
    schema: {
      tags: ['AI'],
      summary: "List the current user's AI conversations",
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          includeArchived: { type: 'boolean', default: false },
        },
      },
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
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = ListQuerySchema.safeParse(request.query);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const result = await conversationsService.listConversations({
        userId,
        page: parse.data.page,
        pageSize: parse.data.pageSize,
        includeArchived: parse.data.includeArchived,
      });
      return reply.send({ success: true, ...result });
    },
  });

  // ── GET /api/v1/ai/conversations/:id — full conversation + messages ────
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['AI'],
      summary: 'Get a conversation with all messages',
      params: conversationParamsJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await conversationsService.getConversation({
        userId,
        conversationId: request.params.id,
      });
      return reply.send({ success: true, data });
    },
  });

  // ── POST /api/v1/ai/conversations/:id/messages — send a message ────────
  fastify.post<{ Params: { id: string }; Body: { content: string } }>('/:id/messages', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['AI'],
      summary: 'Post a user message and get the assistant reply',
      params: conversationParamsJson,
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 8000 },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              required: ['assistantMessage'],
              properties: {
                assistantMessage: { type: 'object', additionalProperties: true },
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
      const parse = PostMessageBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const data = await conversationsService.postMessage({
        userId,
        conversationId: request.params.id,
        content: parse.data.content,
      });
      return reply.send({ success: true, data });
    },
  });

  // ── PATCH /api/v1/ai/conversations/:id — rename or archive ─────────────
  fastify.patch<{ Params: { id: string }; Body: { title?: string | null; archived?: boolean } }>('/:id', {
    schema: {
      tags: ['AI'],
      summary: 'Rename or archive a conversation',
      params: conversationParamsJson,
      body: {
        type: 'object',
        properties: {
          title: { type: ['string', 'null'], minLength: 1, maxLength: 120 },
          archived: { type: 'boolean' },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', additionalProperties: true },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
        422: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const parse = UpdateBodySchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(422).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: parse.error.issues[0]?.message ?? 'Validation error.' },
        });
      }
      const userId = (request.user as JwtPayload).sub;
      const data = await conversationsService.updateConversation({
        userId,
        conversationId: request.params.id,
        ...(parse.data.title !== undefined ? { title: parse.data.title } : {}),
        ...(parse.data.archived !== undefined ? { archived: parse.data.archived } : {}),
      });
      return reply.send({ success: true, data });
    },
  });

  // ── DELETE /api/v1/ai/conversations/:id — hard delete ──────────────────
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: ['AI'],
      summary: 'Permanently delete a conversation and all its messages',
      params: conversationParamsJson,
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'object', properties: { deleted: { type: 'boolean' } } },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { $ref: 'ApiError#' },
        404: { $ref: 'ApiError#' },
      },
    },
    handler: async (request, reply) => {
      const userId = (request.user as JwtPayload).sub;
      const data = await conversationsService.deleteConversation({
        userId,
        conversationId: request.params.id,
      });
      return reply.send({ success: true, data });
    },
  });
};

export default conversationsRoutes;
