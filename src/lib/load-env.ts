/**
 * Layered .env loading.
 *
 * Loads .env.local FIRST (so its values win), then .env fills in everything
 * else. dotenv's default is "first set wins" — vars already in process.env
 * from the first call are not overwritten by the second.
 *
 * Standard Next.js / Vite convention: .env.local is the local override file,
 * gitignored, never committed. The repo's .env may point at production for
 * genuine ops needs; per-developer overrides live in .env.local.
 *
 * Import this as a side-effect import AT THE VERY TOP of every entry point
 * (server, seed scripts, etc.) — BEFORE any module that reads process.env
 * at import-time (config/env.ts validates env via Zod the moment it's
 * imported, so order matters).
 *
 *   import './lib/load-env.js';   // must be first
 *   import { env } from './config/env.js';
 *
 * Prisma CLI has its own separate dotenv load — see prisma.config.ts for the
 * mirror of this pattern.
 */
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();
