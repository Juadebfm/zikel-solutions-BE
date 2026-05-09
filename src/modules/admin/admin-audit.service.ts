import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { withUnscopedTenant } from '../../lib/request-context.js';

// ─── Tenant audit (cross-tenant read by platform staff) ─────────────────────

export interface ListTenantAuditArgs {
  platformUserId: string;
  tenantId: string;
  page: number;
  pageSize: number;
  action?: AuditAction;
  userId?: string;
  fromDate?: Date;
  toDate?: Date;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Reads a specific tenant's AuditLog rows on behalf of a platform user.
 * Cross-tenant by definition — must run inside `withUnscopedTenant`. The act
 * of reading is itself recorded in PlatformAuditLog (record_accessed) so we
 * have a chain of custody for who looked at what tenant's audit history.
 */
export async function listTenantAuditForPlatform(args: ListTenantAuditArgs) {
  return withUnscopedTenant(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { id: true, name: true, slug: true, isActive: true },
    });
    if (!tenant) {
      throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }

    const where: Prisma.AuditLogWhereInput = { tenantId: args.tenantId };
    if (args.action) where.action = args.action;
    if (args.userId) where.userId = args.userId;
    if (args.fromDate || args.toDate) {
      where.createdAt = {};
      if (args.fromDate) where.createdAt.gte = args.fromDate;
      if (args.toDate) where.createdAt.lte = args.toDate;
    }

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (args.page - 1) * args.pageSize,
        take: args.pageSize,
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
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          impersonator: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
    ]);

    // Audit-log the audit-read itself. Fire-and-forget: never block the read.
    void prisma.platformAuditLog
      .create({
        data: {
          platformUserId: args.platformUserId,
          action: AuditAction.record_accessed,
          targetTenantId: tenant.id,
          entityType: 'tenant_audit_log',
          metadata: {
            event: 'tenant_audit_read',
            page: args.page,
            pageSize: args.pageSize,
            ...(args.action ? { filterAction: args.action } : {}),
            ...(args.userId ? { filterUserId: args.userId } : {}),
            ...(args.ipAddress ? { ipAddress: args.ipAddress } : {}),
          } as Prisma.InputJsonValue,
          ipAddress: args.ipAddress ?? null,
          userAgent: args.userAgent ?? null,
        },
      })
      .catch(() => undefined);

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        isActive: tenant.isActive,
      },
      data: rows,
      meta: {
        total,
        page: args.page,
        pageSize: args.pageSize,
        totalPages: Math.max(1, Math.ceil(total / args.pageSize)),
      },
    };
  });
}

// ─── Export tenant audit (CSV / JSON) ───────────────────────────────────────

/**
 * Hard cap on a single export to keep payloads bounded. Compliance officers
 * who need more should run multiple date-bounded exports.
 */
export const TENANT_AUDIT_EXPORT_MAX_ROWS = 50_000;

export interface ExportTenantAuditArgs {
  platformUserId: string;
  tenantId: string;
  format: 'csv' | 'json';
  action?: AuditAction;
  userId?: string;
  fromDate?: Date;
  toDate?: Date;
  ipAddress?: string;
  userAgent?: string;
}

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

/**
 * Returns up to `TENANT_AUDIT_EXPORT_MAX_ROWS` audit rows for a target tenant,
 * matching the same filters as the list endpoint (action, userId, date range).
 * Records a PlatformAuditLog row tagged `tenant_audit_exported` so the export
 * is traceable to the platform user who pulled it.
 *
 * Caller (route layer) is responsible for serialising rows to CSV or JSON and
 * setting the appropriate HTTP headers (Content-Type, Content-Disposition).
 */
export async function exportTenantAuditForPlatform(args: ExportTenantAuditArgs): Promise<{
  tenant: { id: string; name: string; slug: string; isActive: boolean };
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
  return withUnscopedTenant(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { id: true, name: true, slug: true, isActive: true },
    });
    if (!tenant) {
      throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }

    const where: Prisma.AuditLogWhereInput = { tenantId: args.tenantId };
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

    // Chain-of-custody: every export is itself audited.
    void prisma.platformAuditLog
      .create({
        data: {
          platformUserId: args.platformUserId,
          action: AuditAction.record_accessed,
          targetTenantId: tenant.id,
          entityType: 'tenant_audit_log',
          metadata: {
            event: 'tenant_audit_exported',
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
  });
}

// ─── Platform audit (own + others) ──────────────────────────────────────────

export interface ListPlatformAuditArgs {
  page: number;
  pageSize: number;
  action?: AuditAction;
  platformUserId?: string;   // filter by who did the action
  targetTenantId?: string;   // filter by which tenant was the target
  fromDate?: Date;
  toDate?: Date;
}

export async function listPlatformAudit(args: ListPlatformAuditArgs) {
  const where: Prisma.PlatformAuditLogWhereInput = {};
  if (args.action) where.action = args.action;
  if (args.platformUserId) where.platformUserId = args.platformUserId;
  if (args.targetTenantId) where.targetTenantId = args.targetTenantId;
  if (args.fromDate || args.toDate) {
    where.createdAt = {};
    if (args.fromDate) where.createdAt.gte = args.fromDate;
    if (args.toDate) where.createdAt.lte = args.toDate;
  }

  const [total, rows] = await Promise.all([
    prisma.platformAuditLog.count({ where }),
    prisma.platformAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (args.page - 1) * args.pageSize,
      take: args.pageSize,
      select: {
        id: true,
        platformUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        targetTenantId: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        platformUser: {
          select: { id: true, email: true, firstName: true, lastName: true, role: true },
        },
      },
    }),
  ]);

  return {
    data: rows,
    meta: {
      total,
      page: args.page,
      pageSize: args.pageSize,
      totalPages: Math.max(1, Math.ceil(total / args.pageSize)),
    },
  };
}
