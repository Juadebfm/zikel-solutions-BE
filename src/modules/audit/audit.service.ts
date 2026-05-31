import { AuditAction, TenantRole, UserRole, type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import {
  TENANT_AUDIT_EXPORT_MAX_ROWS,
  type TenantAuditExportRow,
} from '../../lib/audit-export.js';
import type { ListAuditLogsQuery } from './audit.schema.js';

type AuditActorContext = {
  userId: string;
  userRole: UserRole;
  tenantRole: TenantRole | null;
  tenantId: string | null;
};

function isAuditViewer(actor: AuditActorContext) {
  if (actor.userRole === UserRole.admin || actor.userRole === UserRole.manager) return true;
  return actor.tenantRole === TenantRole.tenant_admin || actor.tenantRole === TenantRole.sub_admin;
}

function paginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function mapAuditLog(row: {
  id: string;
  tenantId: string | null;
  userId: string | null;
  action: AuditAction;
  entityType: string | null;
  entityId: string | null;
  metadata: Prisma.JsonValue | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

async function resolveAuditActorContext(actorUserId: string): Promise<AuditActorContext> {
  const user = await prisma.tenantUser.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true, activeTenantId: true },
  });
  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const tenant = await requireTenantContext(actorUserId);
  return {
    userId: user.id,
    userRole: user.role,
    tenantRole: tenant.tenantRole,
    tenantId: tenant.tenantId,
  };
}

function buildWhereInput(
  actor: AuditActorContext,
  query: ListAuditLogsQuery,
): Prisma.AuditLogWhereInput {
  const tenantIdScope: string | null = actor.tenantId;

  const andFilters: Prisma.AuditLogWhereInput[] = [];
  if (tenantIdScope) andFilters.push({ tenantId: tenantIdScope });
  if (query.action) andFilters.push({ action: query.action });
  if (query.entityType) andFilters.push({ entityType: query.entityType });
  if (query.userId) andFilters.push({ userId: query.userId });
  if (query.dateFrom || query.dateTo) {
    andFilters.push({
      createdAt: {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      },
    });
  }
  if (query.search) {
    andFilters.push({
      OR: [
        { entityType: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  return andFilters.length > 0 ? { AND: andFilters } : {};
}

export async function listAuditLogs(actorUserId: string, query: ListAuditLogsQuery) {
  const actor = await resolveAuditActorContext(actorUserId);
  if (!isAuditViewer(actor)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to view audit logs.');
  }

  const where = buildWhereInput(actor, query);
  const skip = (query.page - 1) * query.pageSize;
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  logSensitiveReadAccess({
    actorUserId,
    tenantId: actor.tenantId,
    entityType: 'audit_log',
    source: 'audit.list',
    scope: 'list',
    resultCount: rows.length,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      action: query.action ?? null,
      entityType: query.entityType ?? null,
      userId: query.userId ?? null,
      tenantId: query.tenantId ?? null,
      hasSearch: Boolean(query.search),
      hasDateRange: Boolean(query.dateFrom || query.dateTo),
    },
  });

  return {
    data: rows.map(mapAuditLog),
    meta: paginationMeta(total, query.page, query.pageSize),
  };
}

/**
 * Tenant-scoped audit log export. Mirrors the cross-tenant platform export
 * (src/modules/admin/admin-audit.service.ts:exportTenantAuditForPlatform) but
 * for the tenant's own Owner/Admin pulling their own data.
 *
 * Same row shape, same CSV column set, same 50k cap. The compliance officer
 * receiving the file should not be able to tell whether the export was pulled
 * by Zikel staff or by the tenant themselves — that's intentional.
 *
 * Chain-of-custody: every export writes a `tenant_audit_log_exported`
 * AuditLog row visible in the tenant's OWN audit trail. (Platform exports
 * write to PlatformAuditLog instead.)
 */
export async function exportTenantAudit(args: {
  actorUserId: string;
  format: 'csv' | 'json';
  action?: AuditAction;
  userId?: string;
  fromDate?: Date;
  toDate?: Date;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{
  tenant: { id: string; name: string; slug: string };
  rows: TenantAuditExportRow[];
  totalMatching: number;
  truncated: boolean;
  filters: {
    action?: AuditAction;
    userId?: string;
    fromDate?: Date;
    toDate?: Date;
  };
}> {
  const actor = await resolveAuditActorContext(args.actorUserId);
  if (!isAuditViewer(actor)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to export audit logs.');
  }
  if (!actor.tenantId) {
    throw httpError(403, 'NO_ACTIVE_TENANT', 'No active tenant context.');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: actor.tenantId },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) {
    throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  }

  const where: Prisma.AuditLogWhereInput = { tenantId: actor.tenantId };
  if (args.action) where.action = args.action;
  if (args.userId) where.userId = args.userId;
  if (args.fromDate || args.toDate) {
    where.createdAt = {};
    if (args.fromDate) where.createdAt.gte = args.fromDate;
    if (args.toDate) where.createdAt.lte = args.toDate;
  }

  const [totalMatching, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: TENANT_AUDIT_EXPORT_MAX_ROWS,
      select: {
        id: true,
        tenantId: true,
        userId: true,
        impersonatorId: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        user: { select: { email: true, firstName: true, lastName: true } },
        impersonator: { select: { email: true } },
      },
    }),
  ]);

  const flat: TenantAuditExportRow[] = rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    userEmail: r.user?.email ?? null,
    userName: r.user ? `${r.user.firstName} ${r.user.lastName}`.trim() : null,
    impersonatorId: r.impersonatorId,
    impersonatorEmail: r.impersonator?.email ?? null,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    metadata: r.metadata,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    createdAt: r.createdAt,
  }));

  const truncated = totalMatching > TENANT_AUDIT_EXPORT_MAX_ROWS;

  // Self-audit: every export writes an AuditLog row visible to the tenant.
  // Fire-and-forget so a transient AuditLog write doesn't fail the export
  // for the user — the data itself was already gathered and is about to ship.
  void prisma.auditLog
    .create({
      data: {
        tenantId: actor.tenantId,
        userId: args.actorUserId,
        action: AuditAction.record_accessed,
        entityType: 'tenant_audit_log_export',
        // entityId left null — the export covers many rows, not one entity.
        metadata: {
          event: 'tenant_audit_log_exported',
          format: args.format,
          rowsReturned: flat.length,
          totalMatching,
          truncated,
          ...(args.action ? { filterAction: args.action } : {}),
          ...(args.userId ? { filterUserId: args.userId } : {}),
          ...(args.fromDate ? { filterFromDate: args.fromDate.toISOString() } : {}),
          ...(args.toDate ? { filterToDate: args.toDate.toISOString() } : {}),
        } as Prisma.InputJsonValue,
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
      },
    })
    .catch(() => undefined);

  return {
    tenant,
    rows: flat,
    totalMatching,
    truncated,
    filters: {
      ...(args.action ? { action: args.action } : {}),
      ...(args.userId ? { userId: args.userId } : {}),
      ...(args.fromDate ? { fromDate: args.fromDate } : {}),
      ...(args.toDate ? { toDate: args.toDate } : {}),
    },
  };
}

export async function getAuditLog(actorUserId: string, auditLogId: string, requestedTenantId?: string) {
  const actor = await resolveAuditActorContext(actorUserId);
  if (!isAuditViewer(actor)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to view audit logs.');
  }

  const query: ListAuditLogsQuery = {
    page: 1,
    pageSize: 1,
    tenantId: requestedTenantId,
  };
  const scopeWhere = buildWhereInput(actor, query);
  const record = await prisma.auditLog.findFirst({
    where: {
      AND: [scopeWhere, { id: auditLogId }],
    },
  });

  if (!record) {
    throw httpError(404, 'AUDIT_LOG_NOT_FOUND', 'Audit log entry not found.');
  }

  logSensitiveReadAccess({
    actorUserId,
    tenantId: actor.tenantId,
    entityType: 'audit_log',
    entityId: auditLogId,
    source: 'audit.get',
    scope: 'detail',
    resultCount: 1,
    query: {
      tenantId: requestedTenantId ?? null,
    },
  });

  return mapAuditLog(record);
}

export async function listSecurityAlerts(actorUserId: string, lookbackHours: number) {
  const actor = await resolveAuditActorContext(actorUserId);
  if (!isAuditViewer(actor)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have permission to view security alerts.');
  }

  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1_000);
  const where: Prisma.AuditLogWhereInput = {
    ...(actor.tenantId ? { tenantId: actor.tenantId } : {}),
    createdAt: { gte: since },
  };

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      action: true,
      entityType: true,
      userId: true,
      tenantId: true,
      createdAt: true,
      metadata: true,
    },
  });

  const alerts: Array<{
    type: 'repeated_auth_failures' | 'cross_tenant_attempts' | 'admin_changes' | 'break_glass_access';
    severity: 'medium' | 'high';
    count: number;
    lastSeenAt: Date;
    details: string;
  }> = [];

  const failedLoginByUser = new Map<string, { count: number; lastSeenAt: Date }>();
  for (const row of rows) {
    if (row.action !== AuditAction.login || row.entityType !== 'auth_login_failed') continue;
    const key = row.userId ?? 'unknown';
    const existing = failedLoginByUser.get(key);
    if (!existing) {
      failedLoginByUser.set(key, { count: 1, lastSeenAt: row.createdAt });
      continue;
    }
    existing.count += 1;
    if (row.createdAt > existing.lastSeenAt) existing.lastSeenAt = row.createdAt;
  }

  for (const [userId, value] of failedLoginByUser.entries()) {
    if (value.count < 5) continue;
    alerts.push({
      type: 'repeated_auth_failures',
      severity: 'high',
      count: value.count,
      lastSeenAt: value.lastSeenAt,
      details: `User ${userId} has ${value.count} failed login attempts in the lookback window.`,
    });
  }

  const crossTenantAttempts = rows.filter((row) => row.entityType === 'cross_tenant_access_blocked');
  if (crossTenantAttempts.length > 0) {
    alerts.push({
      type: 'cross_tenant_attempts',
      severity: 'high',
      count: crossTenantAttempts.length,
      lastSeenAt: crossTenantAttempts[0].createdAt,
      details: `${crossTenantAttempts.length} blocked cross-tenant access attempts were detected.`,
    });
  }

  const adminChanges = rows.filter((row) => row.action === AuditAction.permission_changed);
  if (adminChanges.length > 0) {
    alerts.push({
      type: 'admin_changes',
      severity: 'medium',
      count: adminChanges.length,
      lastSeenAt: adminChanges[0].createdAt,
      details: `${adminChanges.length} permission changes were recorded.`,
    });
  }

  const breakGlassEvents = rows.filter((row) => row.entityType === 'break_glass_access');
  if (breakGlassEvents.length > 0) {
    alerts.push({
      type: 'break_glass_access',
      severity: 'high',
      count: breakGlassEvents.length,
      lastSeenAt: breakGlassEvents[0].createdAt,
      details: `${breakGlassEvents.length} break-glass access events occurred.`,
    });
  }

  logSensitiveReadAccess({
    actorUserId,
    tenantId: actor.tenantId,
    entityType: 'security_alert',
    source: 'audit.security-alerts',
    scope: 'list',
    resultCount: alerts.length,
    query: {
      lookbackHours,
    },
  });

  return alerts;
}
