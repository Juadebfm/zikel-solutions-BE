import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestAuditContext = {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  source: string | null;
};

const requestAuditContextStore = new AsyncLocalStorage<RequestAuditContext>();

export function setRequestAuditContext(context: RequestAuditContext) {
  requestAuditContextStore.enterWith(context);
}

export function getRequestAuditContext(): RequestAuditContext | null {
  return requestAuditContextStore.getStore() ?? null;
}

