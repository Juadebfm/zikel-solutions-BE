import type { Prisma } from '@prisma/client';
import type { RequestAuditContext } from './request-context.js';

type MutableAuditCreateData = Prisma.AuditLogCreateInput | Prisma.AuditLogUncheckedCreateInput;

function normalizeMetadata(metadata: unknown): Prisma.InputJsonObject {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return { ...(metadata as Record<string, Prisma.InputJsonValue>) };
  }

  if (metadata === null || metadata === undefined) {
    return {};
  }

  return { detail: metadata as Prisma.InputJsonValue };
}

export function enrichAuditLogCreateData<T extends MutableAuditCreateData>(
  data: T,
  context: RequestAuditContext | null,
): T {
  const nextData = { ...data } as T;
  const mutable = nextData as T & {
    metadata?: Prisma.InputJsonValue | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  };

  if ((mutable.ipAddress === undefined || mutable.ipAddress === null || mutable.ipAddress === '') && context?.ipAddress) {
    mutable.ipAddress = context.ipAddress;
  }
  if ((mutable.userAgent === undefined || mutable.userAgent === null || mutable.userAgent === '') && context?.userAgent) {
    mutable.userAgent = context.userAgent;
  }

  const metadata = {
    ...normalizeMetadata(mutable.metadata),
  } as Record<string, Prisma.InputJsonValue>;
  if (metadata.requestId === undefined && context?.requestId) {
    metadata.requestId = context.requestId;
  }
  if (metadata.source === undefined) {
    metadata.source = context?.source ?? 'system';
  }

  mutable.metadata = metadata as Prisma.InputJsonObject;
  return nextData;
}
