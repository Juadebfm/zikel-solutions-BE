import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { env } from '../config/env.js';

export default fp(async (fastify) => {
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim());

  await fastify.register(cors, {
    origin: env.NODE_ENV === 'production' ? origins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Captcha-Token'],
    credentials: true,
  });
});
