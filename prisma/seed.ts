/**
 * Seed script — populates dev/staging with representative data.
 * Run with: npx tsx prisma/seed.ts
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Simple placeholder hash — replace with bcrypt in real seeding
const fakeHash = (plain: string) => createHash('sha256').update(plain).digest('hex');

async function main() {
  console.log('Seeding database...');

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@zikel.dev' },
    update: {},
    create: {
      email: 'admin@zikel.dev',
      passwordHash: fakeHash('Admin1234!'),
      role: UserRole.admin,
      firstName: 'Admin',
      lastName: 'User',
      emailVerified: true,
    },
  });

  const careGroup = await prisma.careGroup.upsert({
    where: { name: 'Northern Region' },
    update: {},
    create: { name: 'Northern Region', description: 'Care homes in the northern region' },
  });

  const home = await prisma.home.create({
    data: {
      careGroupId: careGroup.id,
      name: 'Sunrise House',
      address: '1 Sunrise Road, Leeds, LS1 1AA',
      capacity: 6,
    },
  });

  console.log(`Seeded: admin(${adminUser.id}), careGroup(${careGroup.id}), home(${home.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
