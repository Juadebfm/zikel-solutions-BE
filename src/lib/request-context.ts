import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestAuditContext = {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  source: string | null;
  /** Per-request cache — avoids redundant DB lookups within a single request. */
  cache: Map<string, unknown>;
};

const requestAuditContextStore = new AsyncLocalStorage<RequestAuditContext>();

export function setRequestAuditContext(context: Omit<RequestAuditContext, 'cache'>) {
  requestAuditContextStore.enterWith({ ...context, cache: new Map() });
}

export function getRequestAuditContext(): RequestAuditContext | null {
  return requestAuditContextStore.getStore() ?? null;
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

