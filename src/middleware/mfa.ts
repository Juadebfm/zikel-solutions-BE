import type { FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../types/index.js';

const MFA_REQUIRED_MESSAGE =
  'Multi-factor verification is required before you can perform this action. ' +
  'Complete MFA from your dashboard prompt to protect your account.';
const MFA_GATED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isPrivilegedSession(user: JwtPayload | undefined): boolean {
  if (!user) return false;
  return user.role === 'super_admin' || user.tenantRole === 'tenant_admin';
}

export async function requirePrivilegedMfa(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as JwtPayload | undefined;
  if (!isPrivilegedSession(user)) {
    return;
  }

  // Allow privileged users to load read-only data (dashboard/bootstrap) before MFA.
  // Mutating actions still require verified MFA.
  if (!MFA_GATED_METHODS.has(request.method.toUpperCase())) {
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
