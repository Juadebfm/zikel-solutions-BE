import 'dotenv/config';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import swaggerPlugin from './plugins/swagger.js';
import corsPlugin from './plugins/cors.js';
import helmetPlugin from './plugins/helmet.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import authPlugin from './plugins/auth.js';
import rootRouter from './routes/index.js';

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
    ajv: {
      customOptions: { removeAdditional: 'all', coerceTypes: 'array', useDefaults: true },
    },
  });

  // Plugins (order matters — swagger must come first to capture all route schemas)
  await fastify.register(swaggerPlugin);
  await fastify.register(helmetPlugin);
  await fastify.register(corsPlugin);
  await fastify.register(rateLimitPlugin);
  await fastify.register(authPlugin);

  // Error handler
  fastify.setErrorHandler((error, _req, reply) => {
    const statusCode = error.statusCode ?? 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      fastify.log.error(error);
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
}

start();
