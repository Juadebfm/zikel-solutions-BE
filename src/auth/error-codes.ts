/**
 * Canonical error codes used across the auth/identity layer. Centralised so
 * frontend handlers, audit reports, and integration tests can reference a
 * single source of truth instead of stringly-typed literals scattered across
 * services and routes.
 *
 * Adding a code: add it here AND give it a short human-readable description.
 * Removing or renaming a code is a breaking change for clients — coordinate
 * with the FE before doing so.
 */

export const AuthErrorCode = {
  // ─── Plain authentication failures ─────────────────────────────────────────
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  FORBIDDEN: 'FORBIDDEN',

  // ─── Audience / token shape ────────────────────────────────────────────────
  TENANT_TOKEN_REJECTED: 'TENANT_TOKEN_REJECTED',
  PLATFORM_TOKEN_REJECTED: 'PLATFORM_TOKEN_REJECTED',
  PLATFORM_ONLY: 'PLATFORM_ONLY',

  // ─── Refresh + session ─────────────────────────────────────────────────────
  NO_REFRESH_TOKEN: 'NO_REFRESH_TOKEN',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_IDLE_EXPIRED: 'SESSION_IDLE_EXPIRED',
  SESSION_ABSOLUTE_EXPIRED: 'SESSION_ABSOLUTE_EXPIRED',

  // ─── Tenant context / membership ───────────────────────────────────────────
  TENANT_CONTEXT_REQUIRED: 'TENANT_CONTEXT_REQUIRED',
  TENANT_ACCESS_DENIED: 'TENANT_ACCESS_DENIED',
  TENANT_INACTIVE: 'TENANT_INACTIVE',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',

  // ─── Capability authorization ──────────────────────────────────────────────
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // ─── MFA gating ────────────────────────────────────────────────────────────
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_NOT_FOUND: 'MFA_NOT_FOUND',
  MFA_ALREADY_CONFIRMED: 'MFA_ALREADY_CONFIRMED',
  MFA_CODE_INVALID: 'MFA_CODE_INVALID',
  MFA_BACKUP_INVALID: 'MFA_BACKUP_INVALID',
  MFA_CHALLENGE_INVALID: 'MFA_CHALLENGE_INVALID',
  MFA_CHALLENGE_AUDIENCE: 'MFA_CHALLENGE_AUDIENCE',

  // ─── OTP (email verification, password reset) ──────────────────────────────
  OTP_INVALID: 'OTP_INVALID',

  // ─── Impersonation ─────────────────────────────────────────────────────────
  IMPERSONATION_ACTIVE: 'IMPERSONATION_ACTIVE',
  IMPERSONATION_REVOKED: 'IMPERSONATION_REVOKED',
  INVALID_DURATION: 'INVALID_DURATION',

  // ─── Generic shape ─────────────────────────────────────────────────────────
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
