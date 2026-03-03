import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { env } from '../config/env.js';
import type { JwtPayload } from '../types/index.js';

export default fp(async (fastify) => {
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_EXPIRY },
  });

  // Convenience decorator: call fastify.authenticate(request) inside any route
  fastify.decorate('authenticate', async (request: Parameters<typeof fastify.authenticate>[0]) => {
    await request.jwtVerify<JwtPayload>();
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: import('fastify').FastifyRequest): Promise<void>;
  }
}
