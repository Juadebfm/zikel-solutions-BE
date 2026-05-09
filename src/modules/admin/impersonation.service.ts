import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

const DEFAULT_GRANT_DURATION_MINUTES = 60;       // 1 hour
const MAX_GRANT_DURATION_MINUTES = 4 * 60;       // 4 hours

async function logPlatformAudit(args: {
  platformUserId: string;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  targetTenantId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  try {
    await prisma.platformAuditLog.create({
      data: {
        platformUserId: args.platformUserId,
        action: args.action,
        entityType: args.entityType ?? null,
        entityId: args.entityId ?? null,
        targetTenantId: args.targetTenantId ?? null,
        metadata: args.metadata ?? Prisma.JsonNull,
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
      },
    });
  } catch (err) {
    logger.warn({ msg: 'Failed to write platform audit log', err: err instanceof Error ? err.message : 'unknown' });
  }
}

// ─── Create grant + finalise impersonation token ────────────────────────────

/**
 * Creates an `ImpersonationGrant` for the given platform user → tenant pair.
 * Refuses if the platform user already has an active grant (one-at-a-time
 * policy), the tenant is inactive, or the tenant has no Owner to impersonate as.
 *
 * Returns the grant + the resolved Owner user id (the JWT's `sub` will be
 * the Owner so tenant routes can look up a real user record).
 */
export async function createImpersonationGrant(args: {
  platformUserId: string;
  targetTenantId: string;
  ticketReference: string;
  reason: string;
  durationMinutes?: number;
  // Optional second platform user who approved this grant. Recorded for
  // separation-of-duties / four-eyes audit trails. Must differ from
  // platformUserId — self-approval is rejected.
  grantedByUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const duration = Math.min(
    args.durationMinutes ?? DEFAULT_GRANT_DURATION_MINUTES,
    MAX_GRANT_DURATION_MINUTES,
  );
  if (duration <= 0) {
    throw httpError(422, 'INVALID_DURATION', 'durationMinutes must be a positive integer.');
  }

  if (!args.ticketReference || args.ticketReference.trim().length === 0) {
    throw httpError(422, 'TICKET_REQUIRED', 'A support-ticket reference is required.');
  }
  if (!args.reason || args.reason.trim().length < 10) {
    throw httpError(422, 'REASON_REQUIRED', 'Reason must be at least 10 characters explaining why access is needed.');
  }
  if (args.grantedByUserId && args.grantedByUserId === args.platformUserId) {
    throw httpError(
      422,
      'SELF_APPROVAL_REJECTED',
      'Impersonation grants cannot be self-approved; the approver must be a different platform user.',
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: args.targetTenantId },
    select: { id: true, isActive: true, name: true },
  });
  if (!tenant) {
    throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  }
  if (!tenant.isActive) {
    throw httpError(409, 'TENANT_INACTIVE', 'Cannot impersonate into an inactive tenant.');
  }

  // Find the tenant Owner; we sign the JWT with the Owner's userId so any
  // legacy `prisma.tenantUser.findUnique({ where: { id: actorId }})` calls
  // resolve cleanly. Audit-log impersonatorId records the real actor.
  const ownerMembership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: tenant.id,
      status: 'active',
      role: { name: 'Owner' },
    },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      role: { select: { id: true, name: true, permissions: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!ownerMembership) {
    throw httpError(409, 'NO_OWNER', 'Target tenant has no active Owner to impersonate as.');
  }

  // Refuse to stack grants — one active grant per platform user at a time.
  const existing = await prisma.impersonationGrant.findFirst({
    where: {
      platformUserId: args.platformUserId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, targetTenantId: true },
  });
  if (existing) {
    throw httpError(
      409,
      'IMPERSONATION_ACTIVE',
      'You already have an active impersonation grant. Release it first via DELETE /admin/impersonation/active.',
    );
  }

  const expiresAt = new Date(Date.now() + duration * 60 * 1000);
  const grant = await prisma.impersonationGrant.create({
    data: {
      platformUserId: args.platformUserId,
      targetTenantId: tenant.id,
      targetUserId: ownerMembership.user.id,
      ticketReference: args.ticketReference.trim(),
      reason: args.reason.trim(),
      expiresAt,
      grantedByUserId: args.grantedByUserId ?? null,
    },
  });

  void logPlatformAudit({
    platformUserId: args.platformUserId,
    action: AuditAction.permission_changed,
    entityType: 'impersonation_grant',
    entityId: grant.id,
    targetTenantId: tenant.id,
    metadata: {
      event: 'impersonation_started',
      ticketReference: grant.ticketReference,
      reason: grant.reason,
      targetUserId: ownerMembership.user.id,
      expiresAt: grant.expiresAt.toISOString(),
      grantedByUserId: grant.grantedByUserId,
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return {
    grant,
    tenant,
    ownerUser: ownerMembership.user,
    ownerRole: ownerMembership.role,
  };
}

// ─── Revoke ──────────────────────────────────────────────────────────────────

export async function revokeActiveImpersonation(args: {
  platformUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const grant = await prisma.impersonationGrant.findFirst({
    where: {
      platformUserId: args.platformUserId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!grant) return { revoked: false };

  await prisma.impersonationGrant.update({
    where: { id: grant.id },
    data: { revokedAt: new Date() },
  });

  void logPlatformAudit({
    platformUserId: args.platformUserId,
    action: AuditAction.permission_changed,
    entityType: 'impersonation_grant',
    entityId: grant.id,
    targetTenantId: grant.targetTenantId,
    metadata: { event: 'impersonation_revoked' },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return { revoked: true, grantId: grant.id };
}

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/**
 * Returns true iff the grant is still valid (not revoked, not expired).
 * Called by the auth plugin on impersonation tokens to fail-fast on revoked grants.
 */
export async function isImpersonationGrantActive(grantId: string): Promise<boolean> {
  const grant = await prisma.impersonationGrant.findUnique({
    where: { id: grantId },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!grant) return false;
  if (grant.revokedAt !== null) return false;
  if (grant.expiresAt <= new Date()) return false;
  return true;
}

export async function listImpersonationGrants(args: {
  platformUserId?: string;
  targetTenantId?: string;
  ticketReference?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.ImpersonationGrantWhereInput = {};
  if (args.platformUserId) where.platformUserId = args.platformUserId;
  if (args.targetTenantId) where.targetTenantId = args.targetTenantId;
  if (args.ticketReference) where.ticketReference = args.ticketReference;

  const skip = (args.page - 1) * args.pageSize;
  const [total, rows] = await Promise.all([
    prisma.impersonationGrant.count({ where }),
    prisma.impersonationGrant.findMany({
      where,
      orderBy: { grantedAt: 'desc' },
      skip,
      take: args.pageSize,
      include: {
        platformUser: { select: { id: true, email: true, firstName: true, lastName: true } },
        targetTenant: { select: { id: true, name: true, slug: true } },
        grantedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  const now = new Date();
  return {
    data: rows.map((row) => ({
      id: row.id,
      platformUser: row.platformUser,
      targetTenant: row.targetTenant,
      targetUserId: row.targetUserId,
      ticketReference: row.ticketReference,
      reason: row.reason,
      grantedAt: row.grantedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      grantedBy: row.grantedBy,
      isActive: row.revokedAt === null && row.expiresAt > now,
    })),
    meta: {
      total,
      page: args.page,
      pageSize: args.pageSize,
      totalPages: Math.max(1, Math.ceil(total / args.pageSize)),
    },
  };
}
