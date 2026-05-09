import type { FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload, PlatformJwtPayload } from '../types/index.js';

const MFA_REQUIRED_MESSAGE =
  'Multi-factor verification is required before you can perform this action. ' +
  'Complete MFA from your dashboard prompt to protect your account.';
const MFA_GATED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isPrivilegedSession(user: JwtPayload | undefined): boolean {
  if (!user) return false;
  // Owner role maps to legacy tenant_admin enum (see auth.service.ts).
  return user.tenantRole === 'tenant_admin';
}

/**
 * Tenant-side MFA gate. Privileged users (Owners) must have completed a TOTP
 * challenge in this session before they can perform mutating operations.
 * Read operations are allowed pre-MFA so the dashboard can bootstrap.
 *
 * Phase 4: `mfaVerified` is set by `finalizeTenantLogin` when the verify
 * endpoints succeed, OR when MFA isn't required for the user.
 */
export async function requirePrivilegedMfa(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as JwtPayload | undefined;
  if (!isPrivilegedSession(user)) {
    return;
  }

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

/**
 * Platform-side MFA gate. ALL platform users carry elevated risk, so any
 * mutating operation requires MFA verification in this session. Read-only
 * operations (and the MFA setup endpoints themselves) are allowed pre-MFA so
 * a freshly-seeded platform admin can enroll.
 */
export async function requirePlatformMfa(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as PlatformJwtPayload | undefined;
  if (!user) {
    return reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });
  }

  if (!MFA_GATED_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  if (user.mfaVerified === true) {
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
