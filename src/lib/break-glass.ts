import { AuditAction, UserRole, type Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

type BreakGlassMetadata = {
  type: string | null;
  targetTenantId: string;
  previousTenantId: string | null;
  expiresAt: Date;
};

function asObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseBreakGlassMetadata(value: Prisma.JsonValue | null): BreakGlassMetadata | null {
  const obj = asObject(value);
  if (!obj) return null;

  const targetTenantId = typeof obj.targetTenantId === 'string' ? obj.targetTenantId : null;
  const expiresAtRaw = typeof obj.expiresAt === 'string' ? obj.expiresAt : null;
  if (!targetTenantId || !expiresAtRaw) return null;

  const expiresAt = new Date(expiresAtRaw);
  if (Number.isNaN(expiresAt.getTime())) return null;

  const previousTenantId =
    typeof obj.previousTenantId === 'string' ? obj.previousTenantId : null;
  const type = typeof obj.type === 'string' ? obj.type : null;

  return {
    type,
    targetTenantId,
    previousTenantId,
    expiresAt,
  };
}

function isInactiveBreakGlassType(type: string | null) {
  return type === 'released' || type === 'expired_auto_reverted';
}

/**
 * Reconciles expired break-glass sessions for super-admin users.
 * If the active break-glass window is expired, it reverts activeTenantId and
 * appends an immutable audit event for the automatic rollback.
 */
export async function reconcileExpiredBreakGlassAccess(args: {
  userId: string;
  userRole: UserRole;
  activeTenantId: string | null;
}) {
  if (args.userRole !== UserRole.super_admin || !args.activeTenantId) {
    return args.activeTenantId;
  }

  const latestBreakGlass = await prisma.auditLog.findFirst({
    where: {
      userId: args.userId,
      action: AuditAction.permission_changed,
      entityType: 'break_glass_access',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      metadata: true,
    },
  });

  const metadata = parseBreakGlassMetadata(latestBreakGlass?.metadata ?? null);
  if (!metadata || isInactiveBreakGlassType(metadata.type)) {
    return args.activeTenantId;
  }

  if (args.activeTenantId !== metadata.targetTenantId) {
    return args.activeTenantId;
  }

  if (metadata.expiresAt > new Date()) {
    return args.activeTenantId;
  }

  const reconciledAt = new Date().toISOString();
  const updateCount = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.user.updateMany({
      where: {
        id: args.userId,
        activeTenantId: metadata.targetTenantId,
      },
      data: {
        activeTenantId: metadata.previousTenantId,
      },
    });

    if (updateResult.count === 0) {
      return 0;
    }

    await tx.auditLog.create({
      data: {
        tenantId: metadata.targetTenantId,
        userId: args.userId,
        action: AuditAction.permission_changed,
        entityType: 'break_glass_access',
        entityId: metadata.targetTenantId,
        metadata: {
          type: 'expired_auto_reverted',
          previousTenantId: metadata.previousTenantId,
          targetTenantId: metadata.targetTenantId,
          expiredAt: metadata.expiresAt.toISOString(),
          reconciledAt,
          source: 'system',
          immutable: true,
        },
      },
    });

    return updateResult.count;
  });

  if (updateCount > 0) {
    return metadata.previousTenantId;
  }

  return args.activeTenantId;
}

export async function getActiveBreakGlassSession(args: {
  userId: string;
  userRole: UserRole;
  activeTenantId: string | null;
}) {
  if (args.userRole !== UserRole.super_admin || !args.activeTenantId) {
    return null;
  }

  const latestBreakGlass = await prisma.auditLog.findFirst({
    where: {
      userId: args.userId,
      action: AuditAction.permission_changed,
      entityType: 'break_glass_access',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      metadata: true,
    },
  });

  const metadata = parseBreakGlassMetadata(latestBreakGlass?.metadata ?? null);
  if (!metadata || isInactiveBreakGlassType(metadata.type)) {
    return null;
  }

  if (args.activeTenantId !== metadata.targetTenantId) {
    return null;
  }

  if (metadata.expiresAt <= new Date()) {
    return null;
  }

  return metadata;
}
