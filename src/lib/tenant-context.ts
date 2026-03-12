import { AuditAction, MembershipStatus, TenantRole, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { httpError } from './errors.js';

export interface TenantContext {
  tenantId: string;
  userRole: UserRole;
  tenantRole: TenantRole | null;
}

async function logCrossTenantBlock(args: {
  userId: string;
  tenantId?: string | null;
  reason: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: args.tenantId ?? null,
        userId: args.userId,
        action: AuditAction.permission_changed,
        entityType: 'cross_tenant_access_blocked',
        metadata: { reason: args.reason },
      },
    });
  } catch {
    // Security logging is best-effort and must not break core request handling.
  }
}

/**
 * Resolves and validates the active tenant context for an authenticated user.
 * Non-super-admin users must have an active membership in the active tenant.
 */
export async function requireTenantContext(userId: string): Promise<TenantContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      activeTenantId: true,
    },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  if (!user.activeTenantId) {
    await logCrossTenantBlock({
      userId,
      tenantId: null,
      reason: 'missing_active_tenant',
    });
    throw httpError(
      403,
      'TENANT_CONTEXT_REQUIRED',
      'No active tenant selected. Switch to a tenant before accessing this resource.',
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: user.activeTenantId },
    select: { id: true, isActive: true },
  });

  if (!tenant || !tenant.isActive) {
    await logCrossTenantBlock({
      userId,
      tenantId: user.activeTenantId,
      reason: 'inactive_or_missing_tenant',
    });
    throw httpError(403, 'TENANT_INACTIVE', 'Active tenant is not available.');
  }

  if (user.role === UserRole.super_admin) {
    return {
      tenantId: user.activeTenantId,
      userRole: user.role,
      tenantRole: null,
    };
  }

  const membership = await prisma.tenantMembership.findUnique({
    where: {
      tenantId_userId: {
        tenantId: user.activeTenantId,
        userId,
      },
    },
    select: {
      role: true,
      status: true,
    },
  });

  if (!membership || membership.status !== MembershipStatus.active) {
    await logCrossTenantBlock({
      userId,
      tenantId: user.activeTenantId,
      reason: 'inactive_membership',
    });
    throw httpError(
      403,
      'TENANT_ACCESS_DENIED',
      'You do not have active access to the selected tenant.',
    );
  }

  return {
    tenantId: user.activeTenantId,
    userRole: user.role,
    tenantRole: membership.role,
  };
}
