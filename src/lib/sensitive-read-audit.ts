import { AuditAction, type Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

type ReadScope = 'list' | 'detail';

type SensitiveReadAuditArgs = {
  actorUserId: string;
  tenantId: string | null;
  entityType: string;
  entityId?: string | null;
  source: string;
  scope: ReadScope;
  resultCount?: number;
  query?: Record<string, unknown>;
};

function summarizeQuery(query?: Record<string, unknown>): Prisma.JsonObject | null {
  if (!query) return null;

  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;

    if (typeof value === 'number' || typeof value === 'boolean') {
      summary[key] = value;
      continue;
    }

    if (typeof value === 'string') {
      if (key.toLowerCase().includes('search')) {
        summary[key] = { provided: true, length: value.length };
      } else {
        summary[key] = { provided: true };
      }
      continue;
    }

    summary[key] = { provided: true };
  }

  return Object.keys(summary).length > 0 ? (summary as Prisma.JsonObject) : null;
}

/**
 * Best-effort audit trail for sensitive read/access events.
 * Fire-and-forget — audit writes must never block or slow down user responses.
 */
export function logSensitiveReadAccess(args: SensitiveReadAuditArgs) {
  void prisma.auditLog
    .create({
      data: {
        tenantId: args.tenantId,
        userId: args.actorUserId,
        action: AuditAction.record_accessed,
        entityType: args.entityType,
        entityId: args.entityId ?? null,
        metadata: {
          source: args.source,
          scope: args.scope,
          resultCount: args.resultCount ?? null,
          query: summarizeQuery(args.query),
        },
      },
    })
    .catch((error) => {
      logger.warn({
        msg: 'Sensitive-read audit write failed.',
        source: args.source,
        entityType: args.entityType,
        actorUserId: args.actorUserId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
}

