import type { TenantRole, UserRole } from '@prisma/client';

export type ConfidentialityScope = 'standard' | 'restricted';

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b(?:\+?\d[\d\s().-]{7,}\d)\b/g;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LONG_HEX_PATTERN = /\b[a-f0-9]{24,}\b/gi;
const CUID_PATTERN = /\bc[a-z0-9]{20,}\b/gi;

function normalizeKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseSensitiveKeySet(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((token) => normalizeKey(token.trim()))
      .filter(Boolean),
  );
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(PHONE_PATTERN, '[redacted-phone]')
    .replace(UUID_PATTERN, '[redacted-id]')
    .replace(CUID_PATTERN, '[redacted-id]')
    .replace(LONG_HEX_PATTERN, '[redacted-token]')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function maskIdentifier(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  if (value.length <= 6) return '[redacted-id]';
  return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function initialsFromName(input: string): string {
  const parts = input
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'Redacted person';
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').filter(Boolean).join('.');
  return initials ? `${initials}.` : 'Redacted person';
}

export function redactPersonName(input: string | null | undefined, scope: ConfidentialityScope): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  if (scope === 'restricted') return value;
  return initialsFromName(value);
}

export function canUseRestrictedConfidentialityScope(args: {
  userRole: UserRole;
  tenantRole: TenantRole | null;
}) {
  if (args.userRole === 'super_admin' || args.userRole === 'admin' || args.userRole === 'manager') {
    return true;
  }
  return args.tenantRole === 'tenant_admin' || args.tenantRole === 'sub_admin';
}

function shouldRedactKey(key: string, sensitiveKeys: Set<string>): boolean {
  if (sensitiveKeys.size === 0) return false;
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  if (sensitiveKeys.has(normalized)) return true;

  for (const candidate of sensitiveKeys) {
    if (candidate.length >= 4 && normalized.includes(candidate)) {
      return true;
    }
  }
  return false;
}

export function redactStructuredValue(args: {
  value: unknown;
  scope: ConfidentialityScope;
  sensitiveKeys: Set<string>;
  maxDepth?: number;
  depth?: number;
}): unknown {
  const maxDepth = args.maxDepth ?? 5;
  const depth = args.depth ?? 0;
  if (depth > maxDepth) return '[redacted-depth-limit]';

  if (typeof args.value === 'string') {
    return args.scope === 'restricted' ? args.value : redactSensitiveText(args.value);
  }

  if (Array.isArray(args.value)) {
    return args.value.map((entry) =>
      redactStructuredValue({
        value: entry,
        scope: args.scope,
        sensitiveKeys: args.sensitiveKeys,
        maxDepth,
        depth: depth + 1,
      }));
  }

  if (!args.value || typeof args.value !== 'object') {
    return args.value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.value as Record<string, unknown>)) {
    if (args.scope === 'standard' && shouldRedactKey(key, args.sensitiveKeys)) {
      output[key] = '[redacted]';
      continue;
    }

    output[key] = redactStructuredValue({
      value,
      scope: args.scope,
      sensitiveKeys: args.sensitiveKeys,
      maxDepth,
      depth: depth + 1,
    });
  }
  return output;
}
