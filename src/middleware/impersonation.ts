import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../types/index.js';

/**
 * Blocks impersonation tokens on high-risk self-service flows where a support
 * engineer should NEVER act on behalf of the Owner — change-password, MFA
 * setup/disable, etc. The audit-trail layer captures the impersonator id, but
 * for these operations the user must complete the action themselves.
 *
 * Requires `fastify.authenticate` (tenant audience) to have run first.
 *
 * Design rule (2026-05-21): only gate actions that produce a *permanent*
 * security-control change a support engineer shouldn't be able to make —
 * password changes, MFA enrollment/disable. Transient actions like session
 * revocation are deliberately LEFT OPEN because they're a legitimate part
 * of support workflows ("log me out everywhere" is a textbook ticket). The
 * impersonation banner + audit trail are the right accountability surface
 * for transient ops; this guard is reserved for irreversible ones.
 *
 * One caveat to watch: if a future "log out OTHER sessions" variant is
 * added (kills everything except the current support session, permanently
 * locking the Owner out mid-impersonation), THAT one should be gated here
 * even though it's session-related — it crosses from transient into
 * permanent-lockout territory.
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
