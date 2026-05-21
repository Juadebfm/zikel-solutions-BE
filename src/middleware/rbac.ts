import type { FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole, TenantRole, JwtPayload } from '../types/index.js';
import { requireTenantContext } from '../lib/tenant-context.js';
import type { Permission } from '../auth/permissions.js';

type ScopedRoleOptions = {
  globalRoles?: UserRole[];
  tenantRoles?: TenantRole[];
  // Per-call denial customisation so modules can emit their own error codes
  // (e.g. EXPORT_FORBIDDEN, SENSITIVE_DATA_FORBIDDEN) that the FE error map
  // can group, while reusing the same role-bundle check.
  errorCode?: string;
  errorMessage?: string;
};

function deny(reply: FastifyReply, errorCode?: string, errorMessage?: string) {
  return reply.status(403).send({
    success: false,
    error: {
      code: errorCode ?? 'FORBIDDEN',
      message: errorMessage ?? 'You do not have permission to access this resource.',
    },
  });
}

export function requireScopedRole(options: ScopedRoleOptions) {
  const globalRoles = options.globalRoles ?? [];
  const tenantRoles = options.tenantRoles ?? [];

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload | undefined;
    if (!user) return deny(reply, options.errorCode, options.errorMessage);

    if (globalRoles.includes(user.role)) return;
    if (user.tenantRole && tenantRoles.includes(user.tenantRole)) return;

    return deny(reply, options.errorCode, options.errorMessage);
  };
}

// ── Pre-baked role bundles to match the SEC-4 audit table ────────────────────
// Tenant Owner only — for org-wide settings that affect everyone.
export const OWNER_ONLY: ScopedRoleOptions = {
  globalRoles: [],
  tenantRoles: ['tenant_admin'],
};
// Forms / similar bundle — broad management roles allowed.
export const MANAGEMENT_ROLES: ScopedRoleOptions = {
  globalRoles: ['admin', 'manager'],
  tenantRoles: ['tenant_admin', 'sub_admin'],
};
// Admin tier — same as management but excludes platform `manager` global role
// where the audit explicitly leaves them out.
export const ADMIN_AND_OWNER: ScopedRoleOptions = {
  globalRoles: ['admin'],
  tenantRoles: ['tenant_admin'],
};
// Same as ADMIN_AND_OWNER but also allows the tenant Admin (`sub_admin`).
export const ADMIN_OWNER_OR_SUB_ADMIN: ScopedRoleOptions = {
  globalRoles: ['admin'],
  tenantRoles: ['tenant_admin', 'sub_admin'],
};
// Rotas: managers manage staff schedules, plus admin/Owner.
export const ROTA_MANAGEMENT: ScopedRoleOptions = {
  globalRoles: ['admin', 'manager'],
  tenantRoles: ['tenant_admin'],
};

/**
 * Returns a preHandler hook that enforces role-based access control.
 * Requires fastify.authenticate to have already run (or be chained before it).
 *
 * @example
 * fastify.get('/admin-only', { preHandler: [fastify.authenticate, requireRole('admin')] }, handler)
 */
export function requireRole(...roles: UserRole[]) {
  return requireScopedRole({ globalRoles: roles });
}

/**
 * Capability-based authorization. Resolves the active tenant membership and
 * verifies the user's role grants AT LEAST ONE of the required permissions.
 *
 * Tenant context (and therefore the permissions array) is cached per-request via
 * `requireTenantContext`, so chained `requirePermission` calls within one request
 * do not re-hit the DB.
 *
 * Requires `fastify.authenticate` (tenant audience) to have run first.
 *
 * @example
 *   fastify.get('/employees', {
 *     preHandler: [fastify.authenticate, requirePermission(P.EMPLOYEES_READ)],
 *     handler: async () => ...,
 *   });
 *
 *   // Multiple — match if user has ANY:
 *   requirePermission(P.SAFEGUARDING_READ, P.SAFEGUARDING_ESCALATE)
 */
export function requirePermission(...required: Permission[]) {
  if (required.length === 0) {
    throw new Error('requirePermission called with no permissions; this would always allow.');
  }

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtPayload | undefined;
    if (!user) return deny(reply);

    let tenantCtx;
    try {
      tenantCtx = await requireTenantContext(user.sub);
    } catch {
      return deny(reply);
    }

    const grantedSet = new Set(tenantCtx.permissions);
    const matched = required.some((perm) => grantedSet.has(perm));
    if (!matched) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You do not have permission to access this resource.',
          details: { required },
        },
      });
    }
  };
}
