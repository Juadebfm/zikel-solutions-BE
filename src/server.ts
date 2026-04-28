import 'dotenv/config';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { setRequestAuditContext } from './lib/request-context.js';
import swaggerPlugin from './plugins/swagger.js';
import compressPlugin from './plugins/compress.js';
import corsPlugin from './plugins/cors.js';
import helmetPlugin from './plugins/helmet.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import cookiePlugin from './plugins/cookie.js';
import authPlugin from './plugins/auth.js';
import rootRouter from './routes/index.js';
import { startSafeguardingRiskBackfillScheduler } from './modules/safeguarding/risk-alerts.scheduler.js';

function buildAuditSource(request: FastifyRequest) {
  const routePath = request.routeOptions?.url ?? request.url.split('?')[0];
  return `${request.method} ${routePath}`;
}

function resolveUserAgent(request: FastifyRequest) {
  const header = request.headers['user-agent'];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
    trustProxy: true,
    // Explicit 1 MiB body limit — protects against large-payload DoS.
    bodyLimit: 1_048_576,
    // Attach a correlation ID to every request for log traceability.
    // Accepts X-Request-ID from a load balancer; generates UUID v4 otherwise.
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    ajv: {
      // strict: false lets AJV ignore OpenAPI-only keywords (e.g. `example`, `nullable`)
      // that appear in shared schemas used for both validation and Swagger docs.
      customOptions: { strict: false, removeAdditional: 'all', coerceTypes: 'array', useDefaults: true },
    },
  });

  // Disconnect Prisma cleanly when the server closes (graceful shutdown / tests).
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  fastify.addHook('onRequest', async (request) => {
    setRequestAuditContext({
      requestId: request.id,
      ipAddress: request.ip ?? null,
      userAgent: resolveUserAgent(request),
      source: buildAuditSource(request),
    });
  });

  // Plugins (order matters — swagger must come first to capture all route schemas)
  await fastify.register(swaggerPlugin);
  await fastify.register(compressPlugin);
  await fastify.register(helmetPlugin);
  await fastify.register(corsPlugin);
  await fastify.register(rateLimitPlugin);
  await fastify.register(cookiePlugin);
  await fastify.register(authPlugin);

  // Error handler
  fastify.setErrorHandler((error: FastifyError, req, reply) => {
    const statusCode = error.statusCode ?? 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      // req.log carries the reqId so this error line is traceable.
      req.log.error(error);
    }

    return reply.status(statusCode).send({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: isServerError ? 'An unexpected error occurred.' : error.message,
        ...(env.NODE_ENV !== 'production' && isServerError ? { details: error.message } : {}),
      },
    });
  });

  // 404 handler
  fastify.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'The requested resource does not exist.' },
    });
  });

  // Routes
  await fastify.register(rootRouter);

  const stopSafeguardingRiskBackfillScheduler = startSafeguardingRiskBackfillScheduler();

  // Keep Neon database connection warm — prevents serverless cold starts (~1-3s).
  // Pings every 4 minutes (Neon suspends after ~5 min idle).
  const DB_KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;
  const dbKeepAliveTimer = setInterval(() => {
    void prisma.$queryRawUnsafe('SELECT 1').catch(() => {});
  }, DB_KEEPALIVE_INTERVAL_MS);

  fastify.addHook('onClose', async () => {
    clearInterval(dbKeepAliveTimer);
    stopSafeguardingRiskBackfillScheduler();
  });

  return fastify;
}

async function start() {
  const app = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    logger.info(`Server running at http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }

  // Graceful shutdown — managed platforms send SIGTERM before stopping an instance.
  // app.close() drains in-flight requests and fires all onClose hooks.
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down...`);
    try {
      await app.close();
      logger.info('Server closed cleanly.');
      process.exit(0);
    } catch (err) {
      logger.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });
}

const isDirectRun = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  void start();
}
