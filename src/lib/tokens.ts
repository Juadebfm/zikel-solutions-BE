import { randomBytes } from 'crypto';
import { env } from '../config/env.js';

/** Parses a duration string like "7d", "15m", "1h", "30s" to milliseconds. */
function parseExpiryMs(expiry: string): number {
  const units: Record<string, number> = {
    s: 1_000,
    m: 60 * 1_000,
    h: 60 * 60 * 1_000,
    d: 24 * 60 * 60 * 1_000,
  };
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiry format: "${expiry}". Expected e.g. "7d", "15m".`);
  return parseInt(match[1], 10) * units[match[2]];
}

/** Generates a cryptographically random opaque refresh token. */
export function generateRefreshToken(): string {
  return randomBytes(64).toString('hex');
}

/** Returns the Date at which a newly issued refresh token should expire. */
export function refreshExpiresAt(): Date {
  return new Date(Date.now() + parseExpiryMs(env.JWT_REFRESH_EXPIRY));
}
