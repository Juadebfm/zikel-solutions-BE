/**
 * Shared types + constants for tenant audit-log exports.
 *
 * Two surfaces export tenant audit logs:
 *   - Platform staff: GET /admin/audit/tenants/:id/export (cross-tenant, ticket-bound)
 *   - Tenant Owner/Admin: GET /api/v1/audit/export (self-serve for their own tenant)
 *
 * Both surfaces produce the SAME row shape and the SAME CSV column set. This
 * module is the single source of truth so the two surfaces never drift apart
 * (an inspector receiving an export should not need to know whether it was
 * pulled by Zikel staff or the tenant's own compliance lead).
 */

import type { AuditAction, Prisma } from '@prisma/client';

/**
 * Hard cap on a single export to keep payloads bounded. Compliance officers
 * who need more should run multiple date-bounded exports.
 */
export const TENANT_AUDIT_EXPORT_MAX_ROWS = 50_000;

/** Flat denormalized row written to CSV/JSON. Includes user + impersonator labels. */
export interface TenantAuditExportRow {
  id: string;
  tenantId: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  impersonatorId: string | null;
  impersonatorEmail: string | null;
  action: AuditAction;
  entityType: string | null;
  entityId: string | null;
  metadata: Prisma.JsonValue | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

/** CSV column order + headers. Stable contract; appended-only when fields grow. */
export const TENANT_AUDIT_CSV_COLUMNS: Array<{ key: keyof TenantAuditExportRow; header: string }> = [
  { key: 'id', header: 'AuditLogId' },
  { key: 'createdAt', header: 'CreatedAt' },
  { key: 'tenantId', header: 'TenantId' },
  { key: 'action', header: 'Action' },
  { key: 'userId', header: 'UserId' },
  { key: 'userEmail', header: 'UserEmail' },
  { key: 'userName', header: 'UserName' },
  { key: 'impersonatorId', header: 'ImpersonatorId' },
  { key: 'impersonatorEmail', header: 'ImpersonatorEmail' },
  { key: 'entityType', header: 'EntityType' },
  { key: 'entityId', header: 'EntityId' },
  { key: 'metadata', header: 'Metadata' },
  { key: 'ipAddress', header: 'IpAddress' },
  { key: 'userAgent', header: 'UserAgent' },
];

/** Build a download-friendly filename. ISO timestamp without colons (Windows-safe). */
export function buildAuditExportFilename(args: {
  tenantSlug: string;
  format: 'csv' | 'json';
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `audit-${args.tenantSlug}-${stamp}.${args.format}`;
}
