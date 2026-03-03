import type { FastifyPluginAsync } from 'fastify';
import { createWidgetBodyJson } from './dashboard.schema.js';

const NOT_IMPLEMENTED = {
  success: false as const,
  error: { code: 'NOT_IMPLEMENTED', message: 'This endpoint is not yet implemented — Phase 4.' },
};

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  // All dashboard routes require authentication
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /dashboard/stats ──────────────────────────────────────────────────
  fastify.get('/stats', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Dashboard KPI stats',
      description:
        'Returns the same high-level KPI counts as /summary/stats for use in the dashboard header block.',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'SummaryStats#' },
          },
        },
        401: { $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED),
  });

  // ── GET /dashboard/widgets ────────────────────────────────────────────────
  fastify.get('/widgets', {
    schema: {
      tags: ['Dashboard'],
      summary: 'List my saved widgets',
      description:
        'Returns all dashboard widgets belonging to the authenticated user. ' +
        'Returns an empty array when no widgets have been created yet.',
      response: {
        200: {
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { type: 'array', items: { $ref: 'Widget#' } },
          },
        },
        401: { $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED),
  });

  // ── POST /dashboard/widgets ───────────────────────────────────────────────
  fastify.post('/widgets', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Create a new widget',
      description:
        'Saves a new dashboard widget for the authenticated user. ' +
        'The widget configuration (title, period, reportsOn) is persisted in the database.',
      body: createWidgetBodyJson,
      response: {
        201: {
          description: 'Widget created.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: { $ref: 'Widget#' },
          },
        },
        401: { $ref: 'ApiError#' },
        422: { description: 'Validation error.', $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED),
  });

  // ── DELETE /dashboard/widgets/:id ─────────────────────────────────────────
  fastify.delete('/widgets/:id', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Delete a widget',
      description:
        "Removes a widget from the user's dashboard. Returns 404 if not found or 403 if it belongs to another user.",
      params: { $ref: 'CuidParam#' },
      response: {
        200: {
          description: 'Widget deleted.',
          type: 'object',
          required: ['success', 'data'],
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              properties: { message: { type: 'string', example: 'Widget deleted.' } },
            },
          },
        },
        401: { $ref: 'ApiError#' },
        403: { description: 'Widget belongs to another user.', $ref: 'ApiError#' },
        404: { description: 'Widget not found.', $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => reply.status(501).send(NOT_IMPLEMENTED),
  });
};

export default dashboardRoutes;
