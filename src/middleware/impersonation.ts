import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../types/index.js';

/**
 * Blocks impersonation tokens on high-risk self-service flows where a support
 * engineer should NEVER act on behalf of the Owner — change-password, MFA
 * setup/disable, etc. The audit-trail layer captures the impersonator id, but
 * for these operations the user must complete the action themselves.
 *
 * Requires `fastify.authenticate` (tenant audience) to have run first.
 */
export async function requireNotImpersonating(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as JwtPayload | undefined;
  if (user?.impersonatorId) {
    return reply.status(409).send({
      success: false,
      error: {
        code: 'IMPERSONATION_ACTIVE',
        message:
          'This action cannot be performed while impersonating another user. Release the impersonation grant first.',
      },
    });
  }
}
