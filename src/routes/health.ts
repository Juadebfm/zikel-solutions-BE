import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Liveness probe',
      description: 'Returns 200 immediately. Used by Fly.io to confirm the process is alive.',
      security: [],
      response: {
        200: {
          description: 'Process is alive.',
          type: 'object',
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              properties: { status: { type: 'string', enum: ['ok'] } },
            },
          },
        },
      },
    },
    handler: async (_req, reply) => {
      return reply.status(200).send({ success: true, data: { status: 'ok' } });
    },
  });

  fastify.get('/ready', {
    schema: {
      tags: ['Health'],
      summary: 'Readiness probe',
      description:
        'Returns 200 when the app and database are ready to serve traffic. ' +
        'Returns 503 if the database is unreachable.',
      security: [],
      response: {
        200: {
          description: 'App and database are ready.',
          type: 'object',
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['ready'] },
                db: { type: 'string', enum: ['connected'] },
              },
            },
          },
        },
        503: { description: 'Database connection unavailable.', $ref: 'ApiError#' },
      },
    },
    handler: async (_req, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return reply
          .status(200)
          .send({ success: true, data: { status: 'ready', db: 'connected' } });
      } catch {
        return reply.status(503).send({
          success: false,
          error: { code: 'NOT_READY', message: 'Database connection unavailable.' },
        });
      }
    },
  });
};

export default healthRoutes;
