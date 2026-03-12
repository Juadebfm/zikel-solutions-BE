import { AuditAction, TenantRole, UserRole, type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import {
  getActiveBreakGlassSession,
  reconcileExpiredBreakGlassAccess,
} from '../../lib/break-glass.js';
import type {
  BreakGlassAccessBody,
  BreakGlassReleaseBody,
  ListAuditLogsQuery,
} from './audit.schema.js';

type AuditActorContext = {
  userId: string;
  userRole: UserRole;
  tenantRole: TenantRole | null;
  tenantId: string | null;
};

function isAuditViewer(actor: AuditActorContext) {
  if (actor.userRole === UserRole.super_admin) return true;
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
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true, activeTenantId: true },
  });
  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const activeTenantId = await reconcileExpiredBreakGlassAccess({
    userId: user.id,
    userRole: user.role,
    activeTenantId: user.activeTenantId,
  });

  if (user.role === UserRole.super_admin) {
    return {
      userId: user.id,
      userRole: user.role,
      tenantRole: null,
      tenantId: activeTenantId,
    };
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
  let tenantIdScope: string | null = actor.tenantId;

  if (actor.userRole === UserRole.super_admin && query.tenantId) {
    if (!actor.tenantId || actor.tenantId !== query.tenantId) {
      throw httpError(
        403,
        'BREAK_GLASS_REQUIRED',
        'Switch tenant via break-glass endpoint before reading this tenant audit scope.',
      );
    }
    tenantIdScope = query.tenantId;
  }

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

  await logSensitiveReadAccess({
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

  await logSensitiveReadAccess({
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

export async function breakGlassAccess(
  actorUserId: string,
  body: BreakGlassAccessBody,
  requestMeta: { ipAddress?: string | undefined; userAgent?: string | undefined },
) {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true, activeTenantId: true },
  });

  if (!actor) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }
  if (actor.role !== UserRole.super_admin) {
    throw httpError(403, 'FORBIDDEN', 'Only super-admins can perform break-glass access.');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: body.tenantId },
    select: { id: true, isActive: true, name: true },
  });
  if (!tenant || !tenant.isActive) {
    throw httpError(404, 'TENANT_NOT_FOUND', 'Target tenant not found or inactive.');
  }

  const expiresAt = new Date(Date.now() + body.expiresInMinutes * 60_000);
  const reconciledActiveTenantId = await reconcileExpiredBreakGlassAccess({
    userId: actor.id,
    userRole: actor.role,
    activeTenantId: actor.activeTenantId,
  });
  const previousTenantId = reconciledActiveTenantId ?? null;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: actor.id },
      data: { activeTenantId: tenant.id },
    }),
    prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: actor.id,
        action: AuditAction.permission_changed,
        entityType: 'break_glass_access',
        entityId: tenant.id,
        metadata: {
          reason: body.reason,
          previousTenantId,
          targetTenantId: tenant.id,
          expiresAt: expiresAt.toISOString(),
          immutable: true,
        },
        ipAddress: requestMeta.ipAddress ?? null,
        userAgent: requestMeta.userAgent ?? null,
      },
    }),
  ]);

  return {
    message: `Break-glass access granted for tenant ${tenant.name}.`,
    activeTenantId: tenant.id,
    previousTenantId,
    expiresAt,
  };
}

export async function breakGlassRelease(
  actorUserId: string,
  body: BreakGlassReleaseBody,
  requestMeta: { ipAddress?: string | undefined; userAgent?: string | undefined },
) {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true, activeTenantId: true },
  });

  if (!actor) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }
  if (actor.role !== UserRole.super_admin) {
    throw httpError(403, 'FORBIDDEN', 'Only super-admins can release break-glass access.');
  }

  const reconciledActiveTenantId = await reconcileExpiredBreakGlassAccess({
    userId: actor.id,
    userRole: actor.role,
    activeTenantId: actor.activeTenantId,
  });

  const activeSession = await getActiveBreakGlassSession({
    userId: actor.id,
    userRole: actor.role,
    activeTenantId: reconciledActiveTenantId,
  });

  if (!activeSession) {
    throw httpError(
      409,
      'BREAK_GLASS_NOT_ACTIVE',
      'No active break-glass tenant context to release.',
    );
  }

  const releasedAt = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: actor.id },
      data: { activeTenantId: activeSession.previousTenantId },
    }),
    prisma.auditLog.create({
      data: {
        tenantId: activeSession.targetTenantId,
        userId: actor.id,
        action: AuditAction.permission_changed,
        entityType: 'break_glass_access',
        entityId: activeSession.targetTenantId,
        metadata: {
          type: 'released',
          reason: body.reason ?? 'Manual break-glass release by super-admin.',
          previousTenantId: activeSession.previousTenantId,
          targetTenantId: activeSession.targetTenantId,
          expiresAt: activeSession.expiresAt.toISOString(),
          releasedAt: releasedAt.toISOString(),
          source: 'super_admin',
          immutable: true,
        },
        ipAddress: requestMeta.ipAddress ?? null,
        userAgent: requestMeta.userAgent ?? null,
      },
    }),
  ]);

  return {
    message: 'Break-glass access released successfully.',
    activeTenantId: activeSession.previousTenantId,
    releasedTenantId: activeSession.targetTenantId,
    releasedAt,
  };
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

  await logSensitiveReadAccess({
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
