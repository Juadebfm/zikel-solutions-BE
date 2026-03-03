import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * - `url` here is used by Prisma CLI (migrate, introspect, studio).
 *   We use DIRECT_URL so migrations bypass PgBouncer — required by Neon.
 *   Falls back to DATABASE_URL for environments without a separate direct URL (Railway, local).
 *
 * - Runtime queries use the pooled DATABASE_URL via the pg adapter in src/lib/prisma.ts.
 */
export default defineConfig({
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
});
