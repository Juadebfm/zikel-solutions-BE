/**
 * Prisma extension that auto-injects `tenantId` into queries on tenant-scoped
 * models, sourcing the active tenant from AsyncLocalStorage (set by
 * `fastify.authenticate`).
 *
 * Behaviour:
 *   1. If a request frame has a tenantId set AND the model is tenant-scoped:
 *      • find* / count / aggregate / groupBy → auto-inject `where: { tenantId }`
 *        when not already specified.
 *      • create / createMany → auto-inject `data: { tenantId }` when missing.
 *      • update* / delete* / upsert → auto-inject `where: { tenantId }` when missing.
 *      • findUnique* → left alone (unique-key constraint), but warned in dev.
 *   2. If `withUnscopedTenant(...)` is in scope → all auto-injection is bypassed.
 *      Use for cross-tenant platform operations that intentionally span tenants.
 *   3. If no tenantId is in scope (e.g. unauthenticated, public, or platform routes):
 *      • Tenant-scoped queries WITHOUT a tenantId filter are warned (dev) or
 *        denied (production with TENANT_SCOPE_FAIL_CLOSED=true).
 *
 * Excluded from auto-injection (because `tenantId` is nullable or absent):
 *   AuditLog, Role, Notification, TenantSession, RefreshToken, OtpCode,
 *   PlatformUser, PlatformRefreshToken, PlatformAuditLog, PlatformSession.
 *
 * Manual `where: { tenantId }` clauses in service code are intentionally kept
 * as defense-in-depth. The injector treats an already-present tenantId in
 * `where` as a no-op (see `hasTenantIdInWhere`), so nothing breaks if both are
 * present. Audit (May 2026): all manual tenant filters in src/modules/**.service.ts
 * source the tenantId from the request-resolved tenant context, never a hardcoded
 * or cross-tenant value, so they cannot diverge from the auto-injected scope.
 */
import { Prisma } from '@prisma/client';
import { logger } from './logger.js';
import { getRequestTenantId, isTenantScopingBypassed } from './request-context.js';

/**
 * Models whose table has a REQUIRED (non-nullable) tenantId column. Auto-injection
 * is safe because every row of these models MUST be tenant-scoped.
 */
const AUTO_SCOPED_MODELS = new Set([
  'CareGroup',
  'Home',
  'Employee',
  'HomeEvent',
  'EmployeeShift',
  'YoungPerson',
  'Vehicle',
  'Task',
  'TaskReviewEvent',
  'TaskReference',
  'UploadedFile',
  'DocumentRecord',
  'ExportJob',
  'TenantSettings',
  'Rota',
  'RotaTemplate',
  'Region',
  'RegionHome',
  'Grouping',
  'GroupingMember',
  'SensitiveDataRecord',
  'SensitiveDataAccessLog',
  'Announcement',
  'AnnouncementRead',
  'Widget',
  'SafeguardingRiskAlert',
  'SafeguardingRiskAlertNote',
  'SupportTicket',
  'TicketComment',
  'WebhookEndpoint',
  'WebhookDelivery',
  'TenantMembership',
  'TenantInvite',
  'TenantInviteLink',
]);

/** Read operations that should have tenantId injected into `where`. */
const READ_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

/** Mutation operations that have a `where` we should constrain. */
const WHERE_MUTATION_OPERATIONS = new Set(['updateMany', 'deleteMany']);

/** Single-row mutations that have BOTH where and possibly data. */
const TARGETED_MUTATION_OPERATIONS = new Set(['update', 'delete', 'upsert']);

/** Create operations that need tenantId injected into `data`. */
const CREATE_OPERATIONS = new Set(['create', 'createMany']);

/** Operations we leave alone (unique key constraint or already model-specific). */
const PASSTHROUGH_OPERATIONS = new Set(['findUnique', 'findUniqueOrThrow']);

const isDev = process.env.NODE_ENV === 'development';
const failClosed = process.env.TENANT_SCOPE_FAIL_CLOSED === 'true';
const shouldWarn = isDev || process.env.TENANT_SCOPE_WARN_IN_PROD === 'true';

function warn(message: string, meta: Record<string, unknown>): void {
  if (shouldWarn) {
    logger.warn({ msg: `[tenant-scope] ${message}`, ...meta });
  }
}

function hasTenantIdInWhere(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false;
  const w = where as Record<string, unknown>;
  if (w.tenantId !== undefined) return true;
  for (const key of Object.keys(w)) {
    if (key.startsWith('tenantId_') || key.includes('_tenantId')) return true;
    const nested = w[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      if ((nested as Record<string, unknown>).tenantId !== undefined) return true;
    }
  }
  for (const logicalKey of ['AND', 'OR'] as const) {
    const logical = w[logicalKey];
    if (Array.isArray(logical) && logical.some((clause) => hasTenantIdInWhere(clause))) {
      return true;
    }
  }
  return false;
}

function injectTenantIntoWhere(where: unknown, tenantId: string): Record<string, unknown> {
  const base = (where && typeof where === 'object' ? (where as Record<string, unknown>) : {});
  if (hasTenantIdInWhere(base)) return base;
  return { ...base, tenantId };
}

function injectTenantIntoData(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => injectTenantIntoData(row, tenantId));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (obj.tenantId !== undefined) return obj;
    return { ...obj, tenantId };
  }
  return data;
}

export const tenantScopeExtension = Prisma.defineExtension({
  query: {
    $allOperations({ model, operation, args, query }) {
      if (!model || !AUTO_SCOPED_MODELS.has(model)) {
        return query(args);
      }

      // Bypass: explicit unscoped frame (impersonation, system jobs, etc.)
      if (isTenantScopingBypassed()) {
        return query(args);
      }

      const ctxTenantId = getRequestTenantId();

      if (!ctxTenantId) {
        // No tenant context available: either unauthenticated, public, or
        // a platform request. The query MUST already supply tenantId, otherwise
        // it could leak across tenants.
        const where = (args as { where?: unknown }).where;
        const dataForCreate =
          CREATE_OPERATIONS.has(operation) ? (args as { data?: unknown }).data : undefined;
        const dataHasTenantId =
          dataForCreate &&
          (Array.isArray(dataForCreate)
            ? dataForCreate.every((d) => d && typeof d === 'object' && (d as Record<string, unknown>).tenantId !== undefined)
            : (dataForCreate as Record<string, unknown>).tenantId !== undefined);

        const explicitlyScoped = hasTenantIdInWhere(where) || dataHasTenantId;

        if (!explicitlyScoped && !PASSTHROUGH_OPERATIONS.has(operation)) {
          warn('No tenant context and no explicit tenantId — possible cross-tenant leak.', {
            model,
            operation,
          });
          if (failClosed) {
            throw new Error(
              `[tenant-scope] Refusing to run ${model}.${operation} without tenant context. ` +
                `Either authenticate the request or wrap in withUnscopedTenant().`,
            );
          }
        }
        return query(args);
      }

      // We have a tenant context — auto-inject.
      const next: Record<string, unknown> = { ...(args as Record<string, unknown>) };

      if (READ_OPERATIONS.has(operation) || WHERE_MUTATION_OPERATIONS.has(operation)) {
        next.where = injectTenantIntoWhere((args as { where?: unknown }).where, ctxTenantId);
      } else if (TARGETED_MUTATION_OPERATIONS.has(operation)) {
        // For update/delete/upsert, the unique key in `where` may not include
        // tenantId. We add it as an extra clause when no compound key matches.
        const where = (args as { where?: unknown }).where;
        if (!hasTenantIdInWhere(where)) {
          next.where = { ...(where as Record<string, unknown>), tenantId: ctxTenantId };
        }
      } else if (CREATE_OPERATIONS.has(operation)) {
        next.data = injectTenantIntoData((args as { data?: unknown }).data, ctxTenantId);
      }

      return query(next as typeof args);
    },
  },
});
