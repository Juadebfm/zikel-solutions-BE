/**
 * Minimal bootstrap: creates ONE PlatformUser so smoke tests can hit /admin/auth/login.
 *
 * The full prisma/seed.ts is pre-Phase-1 and broken (references deleted
 * `prisma.user` + `super_admin` role); rewriting it is a separate task. This
 * script only does what's needed to unblock the smoke-test runbook.
 *
 * Run: npx tsx prisma/seed-platform-admin.ts
 *
 * Idempotent — safe to run multiple times. Email/password are hard-coded
 * because this is local-only seed data; do NOT run against production.
 */
import 'dotenv/config';
import { PlatformRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';

const EMAIL = 'admin@zikelsolutions.com';
const PASSWORD = 'PlatformAdmin123!';

async function main() {
  const passwordHash = await hashPassword(PASSWORD);

  const user = await prisma.platformUser.upsert({
    where: { email: EMAIL },
    update: { passwordHash, isActive: true },
    create: {
      email: EMAIL,
      passwordHash,
      firstName: 'Platform',
      lastName: 'Admin',
      role: PlatformRole.platform_admin,
      isActive: true,
    },
    select: { id: true, email: true, role: true, createdAt: true },
  });

  console.log('Platform admin ready:');
  console.log(`  email:    ${user.email}`);
  console.log(`  password: ${PASSWORD}`);
  console.log(`  role:     ${user.role}`);
  console.log(`  id:       ${user.id}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
