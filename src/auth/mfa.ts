/**
 * Shared MFA primitives — TOTP and backup codes.
 *
 * Used by both the tenant MFA flow (TenantMfaCredential) and the platform
 * mirror (PlatformMfaCredential). Service-layer wrappers handle the DB I/O;
 * everything in this file is pure logic + crypto.
 *
 * TOTP defaults match RFC 6238 conventions used by Google Authenticator,
 * 1Password, Authy, etc.: 6 digits, 30s window, SHA-1, ±30s clock-skew tolerance.
 */

import { generateSecret, verify as totpVerify, generateURI } from 'otplib';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';

// Accept the previous, current, and next 30s window (±30s clock skew).
const TOTP_EPOCH_TOLERANCE = 30;

// ── TOTP ─────────────────────────────────────────────────────────────────────

/** Generates a fresh base32 TOTP shared secret (suitable for QR enrollment). */
export function generateTotpSecret(): string {
  return generateSecret();
}

/**
 * Builds the otpauth:// URI that authenticator apps consume from QR codes.
 * Format: `otpauth://totp/<issuer>:<account>?secret=<base32>&issuer=<issuer>`
 */
export function buildOtpAuthUri(args: {
  issuer: string;
  accountName: string;
  secret: string;
}): string {
  return generateURI({
    issuer: args.issuer,
    label: args.accountName,
    secret: args.secret,
  });
}

/** Renders the otpauth URI to a `data:image/png;base64,...` data URI. */
export async function generateQrCodeDataUri(otpAuthUri: string): Promise<string> {
  return QRCode.toDataURL(otpAuthUri, { errorCorrectionLevel: 'M', margin: 1 });
}

/**
 * Verifies a 6-digit TOTP code against the shared secret. Constant-time.
 * Tolerates ±30s clock skew (one step before/after current).
 */
export async function verifyTotpCode(code: string, secret: string): Promise<boolean> {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  try {
    const result = await totpVerify({
      token: trimmed,
      secret,
      epochTolerance: TOTP_EPOCH_TOLERANCE,
    });
    return result.valid === true;
  } catch {
    return false;
  }
}

// ── Backup codes ─────────────────────────────────────────────────────────────

const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_BYTES = 5; // 5 bytes → 10 hex chars; we slice to 8 for readability

/**
 * Generates an array of plaintext backup codes (single-use). Returned ONCE
 * to the user at setup; only the bcrypt hashes are persisted afterwards.
 *
 * Format: 8 lowercase hex chars, hyphenated for readability ("a3f9-b1c0").
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const raw = randomBytes(BACKUP_CODE_BYTES).toString('hex'); // 10 chars
    const slim = raw.slice(0, 8); // 8 chars
    codes.push(`${slim.slice(0, 4)}-${slim.slice(4)}`);
  }
  return codes;
}

/** Bcrypt hashes a backup code for storage (cost 10 — these aren't user passwords). */
export async function hashBackupCode(code: string): Promise<string> {
  return bcrypt.hash(normalizeBackupCode(code), 10);
}

/** Compares a presented backup code against a stored bcrypt hash. Constant-time. */
export async function verifyBackupCodeHash(code: string, storedHash: string): Promise<boolean> {
  return bcrypt.compare(normalizeBackupCode(code), storedHash);
}

function normalizeBackupCode(code: string): string {
  return code.trim().toLowerCase().replace(/-/g, '');
}
