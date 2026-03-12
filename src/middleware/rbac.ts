import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole, TenantRole, JwtPayload } from '../types/index.js';

type ScopedRoleOptions = {
  globalRoles?: UserRole[];
  tenantRoles?: TenantRole[];
};

function deny(reply: FastifyReply) {
  return reply.status(403).send({
    success: false,
    error: {
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    },
  });
}

export function requireScopedRole(options: ScopedRoleOptions) {
  const globalRoles = options.globalRoles ?? [];
  const tenantRoles = options.tenantRoles ?? [];

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload | undefined;
    if (!user) return deny(reply);

    if (globalRoles.includes(user.role)) return;
    if (user.tenantRole && tenantRoles.includes(user.tenantRole)) return;

    return deny(reply);
  };
}

/**
 * Returns a preHandler hook that enforces role-based access control.
 * Requires fastify.authenticate to have already run (or be chained before it).
 *
 * @example
 * fastify.get('/admin-only', { preHandler: [fastify.authenticate, requireRole('admin')] }, handler)
 */
export function requireRole(...roles: UserRole[]) {
  return requireScopedRole({ globalRoles: roles });
}
