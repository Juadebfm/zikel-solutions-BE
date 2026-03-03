import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole, JwtPayload } from '../types/index.js';

/**
 * Returns a preHandler hook that enforces role-based access control.
 * Requires fastify.authenticate to have already run (or be chained before it).
 *
 * @example
 * fastify.get('/admin-only', { preHandler: [fastify.authenticate, requireRole('admin')] }, handler)
 */
export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload | undefined;
    if (!user || !roles.includes(user.role)) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this resource.',
        },
      });
    }
  };
}
