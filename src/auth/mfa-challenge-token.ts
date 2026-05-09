/**
 * Short-lived signed token issued at the password step of login when the user
 * has MFA enabled. Carries enough state to finalize the login at the verify
 * endpoint, but not enough to be a useful credential on its own — it cannot
 * authenticate any tenant or admin route, only the matching /auth/mfa verify endpoint.
 *
 * Lifespan is intentionally short (5 minutes) so a stolen challenge token
 * is only briefly useful even if intercepted.
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const MFA_CHALLENGE_EXPIRY_SECONDS = 5 * 60;
const PURPOSE = 'mfa-challenge';

export type ChallengeAudience = 'tenant' | 'platform';

export interface MfaChallengeClaims {
  sub: string;            // user id (tenant or platform)
  purpose: typeof PURPOSE;
  aud: ChallengeAudience;
}

export function signMfaChallengeToken(args: {
  userId: string;
  audience: ChallengeAudience;
}): string {
  const payload: MfaChallengeClaims = {
    sub: args.userId,
    purpose: PURPOSE,
    aud: args.audience,
  };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: MFA_CHALLENGE_EXPIRY_SECONDS,
  });
}

/**
 * Verifies a challenge token. Returns the userId on success, throws on:
 *   - invalid signature
 *   - expired
 *   - audience mismatch
 *   - wrong purpose
 */
export function verifyMfaChallengeToken(args: {
  token: string;
  expectedAudience: ChallengeAudience;
}): string {
  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(args.token, env.JWT_SECRET);
  } catch {
    throw createError('MFA_CHALLENGE_INVALID', 'MFA challenge token is invalid or expired.');
  }
  if (typeof decoded === 'string' || !decoded || typeof decoded !== 'object') {
    throw createError('MFA_CHALLENGE_INVALID', 'MFA challenge token has an invalid payload.');
  }
  const claims = decoded as Partial<MfaChallengeClaims>;
  if (claims.purpose !== PURPOSE) {
    throw createError('MFA_CHALLENGE_INVALID', 'Token is not an MFA challenge.');
  }
  if (claims.aud !== args.expectedAudience) {
    throw createError('MFA_CHALLENGE_AUDIENCE', 'MFA challenge token audience mismatch.');
  }
  if (typeof claims.sub !== 'string' || !claims.sub) {
    throw createError('MFA_CHALLENGE_INVALID', 'MFA challenge token is missing a subject.');
  }
  return claims.sub;
}

function createError(code: string, message: string): Error & { statusCode: number; code: string } {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 401;
  err.code = code;
  return err;
}
