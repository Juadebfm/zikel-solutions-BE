import { AuditAction, MembershipStatus, TenantRole, UserRole } from '@prisma/client';
import { prisma } from './prisma.js';
import { httpError } from './errors.js';
import { reconcileExpiredBreakGlassAccess } from './break-glass.js';
import { getRequestCache, setRequestCache } from './request-context.js';

export interface TenantContext {
  tenantId: string;
  userRole: UserRole;
  tenantRole: TenantRole | null;
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
 * Non-super-admin users must have an active membership in the active tenant.
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      activeTenantId: true,
      activeTenant: { select: { id: true, isActive: true } },
      tenantMemberships: {
        where: { userId },
        select: { tenantId: true, role: true, status: true },
      },
    },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  // Break-glass reconciliation only applies to super_admin users.
  // For all other users we skip it entirely — no extra DB query.
  let activeTenantId = user.activeTenantId;
  if (user.role === UserRole.super_admin) {
    activeTenantId = await reconcileExpiredBreakGlassAccess({
      userId: user.id,
      userRole: user.role,
      activeTenantId: user.activeTenantId,
    });
  }

  if (!activeTenantId) {
    logCrossTenantBlock({ userId, tenantId: null, reason: 'missing_active_tenant' });
    throw httpError(
      403,
      'TENANT_CONTEXT_REQUIRED',
      'No active tenant selected. Switch to a tenant before accessing this resource.',
    );
  }

  // Use the already-fetched tenant if the activeTenantId hasn't changed
  // (i.e. break-glass didn't revert it). Otherwise fall back to a lookup.
  let tenant = user.activeTenant;
  if (tenant && tenant.id !== activeTenantId) {
    tenant = await prisma.tenant.findUnique({
      where: { id: activeTenantId },
      select: { id: true, isActive: true },
    });
  }

  if (!tenant || !tenant.isActive) {
    logCrossTenantBlock({ userId, tenantId: activeTenantId, reason: 'inactive_or_missing_tenant' });
    throw httpError(403, 'TENANT_INACTIVE', 'Active tenant is not available.');
  }

  if (user.role === UserRole.super_admin) {
    const ctx: TenantContext = { tenantId: activeTenantId, userRole: user.role, tenantRole: null };
    setRequestCache(cacheKey, ctx);
    return ctx;
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

  const ctx: TenantContext = { tenantId: activeTenantId, userRole: user.role, tenantRole: membership.role };
  setRequestCache(cacheKey, ctx);
  return ctx;
}
