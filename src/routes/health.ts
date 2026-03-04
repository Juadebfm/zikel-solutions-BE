import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';

// Inline SVG — served as a public asset for email templates.
// Hardcoded so no file I/O is needed at runtime (safe in Docker).
const WHITE_LOGO_SVG = `<svg width="125" height="42" viewBox="0 0 125 42" fill="none" xmlns="http://www.w3.org/2000/svg"><text x="52" y="21" dominant-baseline="middle" font-family="'Space Grotesk', Arial, sans-serif" font-size="27" font-weight="700" fill="white">Zikel</text><rect width="42" height="42" rx="4.2" fill="#F94D00"/><g clip-path="url(#clip0_wl)" transform="rotate(90, 21, 21)"><path d="M9.54541 10.1882H18.6592L24.9422 16.4732V23.2409L14.6903 13.0433L14.6583 31.8128H9.54541V10.1882Z" fill="white"/><path d="M32.4547 31.8127H23.3428L17.0608 25.5268V18.7562L27.3127 28.9519L27.3438 10.1872H32.4547V31.8127Z" fill="white"/></g><defs><clipPath id="clip0_wl"><rect width="22.9091" height="22.9091" fill="white" transform="translate(9.54541 9.54546)"/></clipPath></defs></svg>`;

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

  // Public asset — white logo SVG for email templates.
  // Gmail blocks data: URIs so we serve from a stable public URL instead.
  fastify.get('/assets/white-logo.svg', {
    schema: { hide: true },
    handler: async (_req, reply) => {
      return reply
        .header('Content-Type', 'image/svg+xml')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(WHITE_LOGO_SVG);
    },
  });
};

export default healthRoutes;
