import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PlatformJwtPayload, PlatformRole } from '../types/index.js';

/**
 * Platform-side role gate. Use under any platform route after
 * `fastify.authenticatePlatform`. Mirrors the tenant-side requirePermission
 * idea but with the four PlatformRoles: `platform_admin`, `support`,
 * `engineer`, `billing`.
 *
 * Returns 403 PLATFORM_ROLE_DENIED when the caller's role is not in the
 * allowlist for the route.
 */
export function requirePlatformRole(...allowedRoles: PlatformRole[]) {
  return async function requirePlatformRoleHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const user = request.user as PlatformJwtPayload | undefined;
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
      });
    }
    if (!allowedRoles.includes(user.role)) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'PLATFORM_ROLE_DENIED',
          message: 'Your platform role is not authorised for this action.',
          details: { required: allowedRoles, actual: user.role },
        },
      });
    }
  };
}
