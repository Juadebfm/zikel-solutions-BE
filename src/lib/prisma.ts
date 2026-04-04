import { PrismaClient, type AuditAction, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { logger } from './logger.js';
import { queueAndDispatchSecurityAlert } from './security-alert-pipeline.js';
import { getRequestAuditContext } from './request-context.js';
import { enrichAuditLogCreateData } from './audit-metadata.js';

function createPrismaClient() {
  // Runtime uses the pooled DATABASE_URL (PgBouncer on Neon).
  // Migrations use DIRECT_URL via prisma.config.ts instead.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Cap connections per instance so we never exhaust Neon's pool.
    // Fly.io machines are single-threaded Node; 10 concurrent DB connections is ample.
    max: 10,
    idleTimeoutMillis: 30_000,   // release idle connections after 30 s
    connectionTimeoutMillis: 5_000, // fail fast rather than queue indefinitely
  });
  const adapter = new PrismaPg(pool);

  const isDev = process.env.NODE_ENV === 'development';

  const baseClient = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
      // Enable query logging in dev to surface slow queries.
      ...(isDev ? [{ emit: 'event' as const, level: 'query' as const }] : []),
    ],
  });

  baseClient.$on('error', (e) => logger.error({ msg: 'Prisma error', ...e }));
  baseClient.$on('warn', (e) => logger.warn({ msg: 'Prisma warning', ...e }));
  if (isDev) {
    baseClient.$on('query', (e) => {
      if (e.duration > 100) {
        logger.warn({ msg: 'Slow query', duration: `${e.duration}ms`, query: e.query });
      }
    });
  }

  const client = baseClient.$extends({
    query: {
      auditLog: {
        async create({ args, query }) {
          const requestContext = getRequestAuditContext();
          const enrichedArgs = {
            ...args,
            data: enrichAuditLogCreateData(
              args.data as Prisma.AuditLogCreateInput | Prisma.AuditLogUncheckedCreateInput,
              requestContext,
            ),
          };

          const created = await query(enrichedArgs);

          const auditEvent = created as {
            id: string;
            tenantId: string | null;
            userId: string | null;
            action: AuditAction;
            entityType: string | null;
            entityId: string | null;
            metadata: Prisma.JsonValue | null;
            createdAt: Date;
          };

          void queueAndDispatchSecurityAlert(baseClient, auditEvent).catch((error) => {
            logger.error({
              msg: 'Security alert pipeline failed after audit log write.',
              auditLogId: auditEvent.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });
          return created;
        },
      },
    },
  });

  return client;
}

type AppPrismaClient = ReturnType<typeof createPrismaClient>;
const globalForPrisma = globalThis as unknown as { prisma?: AppPrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
