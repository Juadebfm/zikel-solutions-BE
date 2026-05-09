import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestAuditContext = {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  source: string | null;
  /**
   * Tenant scope for the current request. Set by `fastify.authenticate` after
   * decoding a tenant-audience JWT. Read by the Prisma client extension to
   * auto-inject `where: { tenantId }` filters on tenant-scoped models.
   *
   * Null for unauthenticated requests, public endpoints, and platform-audience
   * requests (which never read tenant data without explicit impersonation).
   */
  tenantId: string | null;
  /**
   * When true, the Prisma extension's tenant filter is bypassed for the
   * remainder of this AsyncLocalStorage frame. Use `withUnscopedTenant(...)`
   * to enter a bypass frame; never set this directly outside that helper.
   */
  unscopedTenant: boolean;
  /**
   * Phase 5: when an active impersonation token is decoded by the auth plugin,
   * this holds the platform user id of the actor. The audit-log enrichment
   * stamps it on every AuditLog.create call so the trail records "what
   * looked like userId X actually came from platform Y".
   */
  impersonatorId: string | null;
  /** Per-request cache — avoids redundant DB lookups within a single request. */
  cache: Map<string, unknown>;
};

const requestAuditContextStore = new AsyncLocalStorage<RequestAuditContext>();

export function setRequestAuditContext(context: Omit<RequestAuditContext, 'cache' | 'tenantId' | 'unscopedTenant' | 'impersonatorId'>) {
  requestAuditContextStore.enterWith({
    ...context,
    tenantId: null,
    unscopedTenant: false,
    impersonatorId: null,
    cache: new Map(),
  });
}

/** Set the impersonator (platform user id) for the current request frame. */
export function setRequestImpersonatorId(impersonatorId: string | null): void {
  const store = requestAuditContextStore.getStore();
  if (store) store.impersonatorId = impersonatorId;
}

/** Read the impersonator platform user id (null if not impersonating). */
export function getRequestImpersonatorId(): string | null {
  return requestAuditContextStore.getStore()?.impersonatorId ?? null;
}

export function getRequestAuditContext(): RequestAuditContext | null {
  return requestAuditContextStore.getStore() ?? null;
}

/** Set the active tenant id for the current request frame. */
export function setRequestTenantId(tenantId: string | null): void {
  const store = requestAuditContextStore.getStore();
  if (store) store.tenantId = tenantId;
}

/** Read the active tenant id (null if no tenant context). */
export function getRequestTenantId(): string | null {
  return requestAuditContextStore.getStore()?.tenantId ?? null;
}

/** Read whether the current frame has tenant auto-scoping disabled. */
export function isTenantScopingBypassed(): boolean {
  return requestAuditContextStore.getStore()?.unscopedTenant === true;
}

/**
 * Run a callback with tenant auto-scoping bypassed. Use sparingly — every call
 * site should be greppable for security review. Intended for:
 *   - Platform-audience operations that intentionally span tenants (impersonation)
 *   - System-level reads (cron jobs, audit log queries, system seeders)
 *
 * Logs the bypass via console.warn for audit trail outside of the request lifecycle.
 */
export async function withUnscopedTenant<T>(callback: () => Promise<T>): Promise<T> {
  const store = requestAuditContextStore.getStore();
  if (!store) {
    // No request context (e.g. a CLI script or background job) — just run.
    return callback();
  }
  const previous = store.unscopedTenant;
  store.unscopedTenant = true;
  try {
    return await callback();
  } finally {
    store.unscopedTenant = previous;
  }
}

/** Retrieve a cached value for the current request. */
export function getRequestCache<T>(key: string): T | undefined {
  const store = requestAuditContextStore.getStore();
  return store?.cache.get(key) as T | undefined;
}

/** Store a value in the current request's cache. */
export function setRequestCache<T>(key: string, value: T): void {
  const store = requestAuditContextStore.getStore();
  store?.cache.set(key, value);
}

