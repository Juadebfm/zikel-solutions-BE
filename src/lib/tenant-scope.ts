/**
 * Prisma extension that warns (in dev) when a query on a tenant-scoped model
 * is missing a tenantId filter.  This is a safety net — it does NOT inject
 * tenantId automatically (which would hide bugs), but it alerts you when a
 * query could accidentally leak data across tenants.
 *
 * In production the check is silent to avoid noise, but you can opt-in via
 * the TENANT_SCOPE_WARN_IN_PROD env var.
 */
import { Prisma } from '@prisma/client';
import { logger } from './logger.js';

/**
 * Models whose table has a required (non-nullable) tenantId column.
 * Queries on these models should always include a tenantId filter.
 *
 * Excluded: AuditLog, SecurityAlertDelivery, Notification (tenantId is optional).
 * Excluded: FormTemplate (global, not tenant-scoped).
 */
const TENANT_SCOPED_MODELS = new Set([
  'CareGroup',
  'Home',
  'Employee',
  'Role',
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
  'Widget',
  'SafeguardingRiskAlert',
  'SafeguardingRiskAlertNote',
  'SupportTicket',
  'WebhookEndpoint',
  'TenantMembership',
  'TenantInvite',
  'TenantInviteLink',
]);

/** Operations that read or mutate rows and should be scoped. */
const CHECKED_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

function hasTenantIdInWhere(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false;
  const w = where as Record<string, unknown>;

  // Direct tenantId filter
  if (w.tenantId !== undefined) return true;

  // Compound unique key that includes tenantId (e.g. tenantId_userId)
  for (const key of Object.keys(w)) {
    if (key.startsWith('tenantId_') || key.includes('_tenantId')) return true;
    // Check inside the compound key object
    const nested = w[key];
    if (nested && typeof nested === 'object' && (nested as Record<string, unknown>).tenantId !== undefined) {
      return true;
    }
  }

  // Check inside AND/OR arrays
  for (const logicalKey of ['AND', 'OR']) {
    const logical = w[logicalKey];
    if (Array.isArray(logical) && logical.some((clause) => hasTenantIdInWhere(clause))) {
      return true;
    }
  }

  return false;
}

const shouldWarn =
  process.env.NODE_ENV === 'development' || process.env.TENANT_SCOPE_WARN_IN_PROD === 'true';

/**
 * Prisma query extension that checks tenant scoping.
 * Attach via: `baseClient.$extends(tenantScopeExtension)`
 */
export const tenantScopeExtension = Prisma.defineExtension({
  query: {
    $allOperations({ model, operation, args, query }) {
      if (
        shouldWarn &&
        model &&
        TENANT_SCOPED_MODELS.has(model) &&
        CHECKED_OPERATIONS.has(operation)
      ) {
        const where = (args as { where?: unknown }).where;
        if (!hasTenantIdInWhere(where)) {
          logger.warn({
            msg: 'Tenant scope missing — query on tenant-scoped model without tenantId filter.',
            model,
            operation,
          });
        }
      }
      return query(args);
    },
  },
});
