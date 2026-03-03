import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { logger } from './logger.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  // Runtime uses the pooled DATABASE_URL (PgBouncer on Neon).
  // Migrations use DIRECT_URL via prisma.config.ts instead.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);

  const client = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  client.$on('error', (e) => logger.error({ msg: 'Prisma error', ...e }));
  client.$on('warn', (e) => logger.warn({ msg: 'Prisma warning', ...e }));

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
