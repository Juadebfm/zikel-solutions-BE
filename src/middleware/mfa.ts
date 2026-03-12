import type { FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../types/index.js';

const MFA_REQUIRED_MESSAGE = 'Multi-factor verification is required for this privileged session.';

export function isPrivilegedSession(user: JwtPayload | undefined): boolean {
  if (!user) return false;
  return user.role === 'super_admin' || user.tenantRole === 'tenant_admin';
}

export async function requirePrivilegedMfa(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as JwtPayload | undefined;
  if (!isPrivilegedSession(user)) {
    return;
  }

  if (user?.mfaVerified === true) {
    return;
  }

  return reply.status(403).send({
    success: false,
    error: {
      code: 'MFA_REQUIRED',
      message: MFA_REQUIRED_MESSAGE,
    },
  });
}

