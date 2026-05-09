import { AuditAction, MembershipStatus, TenantRole, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { httpError } from './errors.js';
import { getRequestCache, setRequestCache } from './request-context.js';

export interface TenantContext {
  tenantId: string;
  userRole: UserRole;
  tenantRole: TenantRole | null; // Legacy; use roleName/permissions instead.
  roleName: string | null;
  permissions: string[];
}

function legacyTenantRoleFromName(name: string): TenantRole {
  if (name === 'Owner') return TenantRole.tenant_admin;
  if (name === 'Admin') return TenantRole.sub_admin;
  return TenantRole.staff;
}

function logCrossTenantBlock(args: {
  userId: string;
  tenantId?: string | null;
  reason: string;
}) {
  // Fire-and-forget — security logging must not block or break core request handling.
  void prisma.auditLog
    .create({
      data: {
        tenantId: args.tenantId ?? null,
        userId: args.userId,
        action: AuditAction.permission_changed,
        entityType: 'cross_tenant_access_blocked',
        metadata: { reason: args.reason },
      },
    })
    .catch(() => {});
}

/**
 * Resolves and validates the active tenant context for an authenticated user.
 * Every tenant user must have an active membership in the active tenant.
 *
 * Optimised path: fetches user with tenant + membership in a single query to
 * avoid sequential DB round-trips (saves ~200-600 ms on Neon).
 */
export async function requireTenantContext(userId: string): Promise<TenantContext> {
  // Return cached result if this request already resolved the tenant context.
  const cacheKey = `tenantCtx:${userId}`;
  const cached = getRequestCache<TenantContext>(cacheKey);
  if (cached) return cached;

  // Single query: fetch user together with active tenant and membership.
  const user = await prisma.tenantUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      activeTenantId: true,
      activeTenant: { select: { id: true, isActive: true } },
      tenantMemberships: {
        where: { userId },
        select: {
          tenantId: true,
          status: true,
          role: { select: { name: true, permissions: true } },
        },
      },
    },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const activeTenantId = user.activeTenantId;

  if (!activeTenantId) {
    logCrossTenantBlock({ userId, tenantId: null, reason: 'missing_active_tenant' });
    throw httpError(
      403,
      'TENANT_CONTEXT_REQUIRED',
      'No active tenant selected. Switch to a tenant before accessing this resource.',
    );
  }

  const tenant = user.activeTenant;

  if (!tenant || !tenant.isActive) {
    logCrossTenantBlock({ userId, tenantId: activeTenantId, reason: 'inactive_or_missing_tenant' });
    throw httpError(403, 'TENANT_INACTIVE', 'Active tenant is not available.');
  }

  // Use the already-fetched membership instead of a second query.
  const membership = user.tenantMemberships.find((m) => m.tenantId === activeTenantId);

  if (!membership || membership.status !== MembershipStatus.active) {
    logCrossTenantBlock({ userId, tenantId: activeTenantId, reason: 'inactive_membership' });
    throw httpError(
      403,
      'TENANT_ACCESS_DENIED',
      'You do not have active access to the selected tenant.',
    );
  }

  const ctx: TenantContext = {
    tenantId: activeTenantId,
    userRole: user.role,
    tenantRole: legacyTenantRoleFromName(membership.role.name),
    roleName: membership.role.name,
    permissions: membership.role.permissions,
  };
  setRequestCache(cacheKey, ctx);
  return ctx;
}
