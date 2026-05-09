/**
 * Symmetric encryption for sensitive secrets at rest (TOTP shared secrets,
 * future field-level encryption). AES-256-GCM with a per-record random IV;
 * authentication tag is stored alongside the ciphertext to detect tampering.
 *
 * Key sourcing:
 *   - Reads `MFA_SECRET_KEY_BASE64` from env (32 bytes / 256 bits, base64-encoded).
 *   - Designed so a future KMS-backed key resolver can plug in without
 *     touching call sites — `loadKey()` is the only thing that changes.
 *
 * Encoding format: `<ivBase64>:<authTagBase64>:<ciphertextBase64>`
 *   — single string, easy to store as a column, easy to migrate.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // 256 bits
const IV_BYTES = 12; // 96-bit IV is the AES-GCM standard
const AUTH_TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.MFA_SECRET_KEY_BASE64;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MFA_SECRET_KEY_BASE64 is required in production. Generate one with: ' +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    // Dev convenience: deterministic-ish dev key so devs can decrypt seed data
    // across restarts. NEVER ship without env var set in staging/production.
    const fallback = Buffer.alloc(KEY_BYTES);
    Buffer.from('zikel-dev-mfa-secret-key-32bytes').copy(fallback);
    cachedKey = fallback;
    return cachedKey;
  }

  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `MFA_SECRET_KEY_BASE64 must decode to exactly ${KEY_BYTES} bytes (got ${buf.length}). ` +
        `Generate with: node -e "console.log(require('crypto').randomBytes(${KEY_BYTES}).toString('base64'))"`,
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * Encrypts a UTF-8 plaintext (e.g. a TOTP shared secret) and returns the
 * canonical `iv:authTag:ciphertext` triplet, all base64-encoded.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Decrypts a value previously produced by `encryptSecret`. Throws on tamper
 * (authentication tag mismatch) or malformed input.
 */
export function decryptSecret(stored: string): string {
  const key = loadKey();
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted secret: expected iv:authTag:ciphertext.');
  }
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: ${iv.length}.`);
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(`Invalid auth tag length: ${authTag.length}.`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Test/dev helper to force the cached key to refresh — used in unit tests
 * that swap the env var. Not for production use.
 */
export function _resetSecretKeyCache(): void {
  cachedKey = null;
}
