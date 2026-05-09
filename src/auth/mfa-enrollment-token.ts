/**
 * Short-lived signed token issued at the password step of login when a user
 * who is required to have MFA (tenant Owner, or any platform user) has not
 * yet enrolled TOTP. Industry-standard "enrollment-required" pattern: the
 * server hard-blocks the login from completing but hands the client a
 * single-purpose token that can drive the user through enrollment in the
 * same flow — no partial session, no second password entry.
 *
 * This token can ONLY authorize the matching enrollment endpoints:
 *   - POST /auth/mfa/totp/enroll/setup         (tenant)
 *   - POST /auth/mfa/totp/enroll/confirm       (tenant — mints session on success)
 *   - POST /admin/auth/mfa/totp/enroll/setup   (platform)
 *   - POST /admin/auth/mfa/totp/enroll/confirm (platform — mints session on success)
 *
 * Lifespan is longer than a challenge token (15 min) because enrollment is
 * interactive: install authenticator app → scan QR → save backup codes → enter
 * first 6-digit code. 5 minutes is too tight for new users.
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const MFA_ENROLLMENT_EXPIRY_SECONDS = 15 * 60;
const PURPOSE = 'mfa-enrollment';

export type EnrollmentAudience = 'tenant' | 'platform';

export interface MfaEnrollmentClaims {
  sub: string;            // user id (tenant or platform)
  purpose: typeof PURPOSE;
  aud: EnrollmentAudience;
}

export function signMfaEnrollmentToken(args: {
  userId: string;
  audience: EnrollmentAudience;
}): string {
  const payload: MfaEnrollmentClaims = {
    sub: args.userId,
    purpose: PURPOSE,
    aud: args.audience,
  };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: MFA_ENROLLMENT_EXPIRY_SECONDS,
  });
}

/**
 * Verifies an enrollment token. Returns the userId on success, throws on
 * invalid signature, expired, audience mismatch, or wrong purpose.
 */
export function verifyMfaEnrollmentToken(args: {
  token: string;
  expectedAudience: EnrollmentAudience;
}): string {
  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(args.token, env.JWT_SECRET);
  } catch {
    throw createError('MFA_ENROLLMENT_INVALID', 'Enrollment token is invalid or expired.');
  }
  if (typeof decoded === 'string' || !decoded || typeof decoded !== 'object') {
    throw createError('MFA_ENROLLMENT_INVALID', 'Enrollment token has an invalid payload.');
  }
  const claims = decoded as Partial<MfaEnrollmentClaims>;
  if (claims.purpose !== PURPOSE) {
    throw createError('MFA_ENROLLMENT_INVALID', 'Token is not an MFA enrollment token.');
  }
  if (claims.aud !== args.expectedAudience) {
    throw createError('MFA_ENROLLMENT_AUDIENCE', 'Enrollment token audience mismatch.');
  }
  if (typeof claims.sub !== 'string' || !claims.sub) {
    throw createError('MFA_ENROLLMENT_INVALID', 'Enrollment token is missing a subject.');
  }
  return claims.sub;
}

function createError(code: string, message: string): Error & { statusCode: number; code: string } {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 401;
  err.code = code;
  return err;
}
