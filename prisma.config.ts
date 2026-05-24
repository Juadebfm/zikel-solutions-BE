import dotenv from 'dotenv';
// Layered env loading: load .env.local FIRST so its values win, then .env
// fills in everything else. dotenv's default behaviour is "first set wins" —
// vars already in process.env from the first call are not overwritten by the
// second. This makes .env.local a true local override file (the standard
// Next.js / Vite convention) for Prisma CLI commands too, not just runtime.
dotenv.config({ path: '.env.local' });
dotenv.config();

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
