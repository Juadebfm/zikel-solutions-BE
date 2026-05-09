import type { UserRole } from '../types/index.js';

// Phase 1 stub: super_admin role no longer exists on tenant users. Break-glass is
// being replaced by the Impersonation flow in Phase 5 (PlatformUser → tenant access
// with ticket reference + audit trail). Until that lands, these helpers no-op so
// existing callers in tenant-context.ts and audit.service.ts compile and behave
// safely (no tenant user can ever be in a break-glass session).

export async function reconcileExpiredBreakGlassAccess(args: {
  userId: string;
  userRole: UserRole;
  activeTenantId: string | null;
}) {
  return args.activeTenantId;
}

export async function getActiveBreakGlassSession(_args: {
  userId: string;
  userRole: UserRole;
  activeTenantId: string | null;
}) {
  return null;
}
