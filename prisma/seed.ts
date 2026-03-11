/**
 * Seed script — populates dev/staging with representative data.
 * Run with: npx tsx prisma/seed.ts
 */
import bcrypt from 'bcryptjs';
import {
  PrismaClient,
  UserRole,
  TaskStatus,
  TaskApprovalStatus,
  TaskPriority,
  Country,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const BCRYPT_COST = 12;

function daysBetween(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function atHour(base: Date, hour: number, minute = 0): Date {
  const dt = new Date(base);
  dt.setHours(hour, minute, 0, 0);
  return dt;
}

async function main() {
  console.log('Seeding database...');
  const now = new Date();
  const seedStart = new Date(now.getFullYear(), now.getMonth() - 1, 15, 0, 0, 0, 0);
  const allDays = daysBetween(seedStart, now);
  const defaultPasswordHash = await bcrypt.hash('Admin1234!', BCRYPT_COST);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@zikel.dev' },
    update: {
      passwordHash: defaultPasswordHash,
      firstName: 'Admin',
      lastName: 'User',
      role: UserRole.admin,
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
    create: {
      email: 'admin@zikel.dev',
      passwordHash: defaultPasswordHash,
      role: UserRole.admin,
      firstName: 'Admin',
      lastName: 'User',
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
  });

  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@zikel.dev' },
    update: {
      passwordHash: defaultPasswordHash,
      firstName: 'Martha',
      lastName: 'Manager',
      role: UserRole.manager,
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
    create: {
      email: 'manager@zikel.dev',
      passwordHash: defaultPasswordHash,
      role: UserRole.manager,
      firstName: 'Martha',
      lastName: 'Manager',
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
  });

  const staffNorthUser = await prisma.user.upsert({
    where: { email: 'staff.north@zikel.dev' },
    update: {
      passwordHash: defaultPasswordHash,
      firstName: 'Noah',
      lastName: 'North',
      role: UserRole.staff,
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
    create: {
      email: 'staff.north@zikel.dev',
      passwordHash: defaultPasswordHash,
      role: UserRole.staff,
      firstName: 'Noah',
      lastName: 'North',
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
  });

  const staffSouthUser = await prisma.user.upsert({
    where: { email: 'staff.south@zikel.dev' },
    update: {
      passwordHash: defaultPasswordHash,
      firstName: 'Sade',
      lastName: 'South',
      role: UserRole.staff,
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
    create: {
      email: 'staff.south@zikel.dev',
      passwordHash: defaultPasswordHash,
      role: UserRole.staff,
      firstName: 'Sade',
      lastName: 'South',
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
  });

  const careGroup = await prisma.careGroup.upsert({
    where: { name: 'Northern Region' },
    update: {},
    create: { name: 'Northern Region', description: 'Care homes in the northern region' },
  });

  const existingNorthHome = await prisma.home.findFirst({
    where: { careGroupId: careGroup.id, name: 'Sunrise House' },
  });
  const northHome =
    existingNorthHome ??
    (await prisma.home.create({
      data: {
        careGroupId: careGroup.id,
        name: 'Sunrise House',
        address: '1 Sunrise Road, Leeds, LS1 1AA',
        capacity: 6,
      },
    }));

  const existingSouthHome = await prisma.home.findFirst({
    where: { careGroupId: careGroup.id, name: 'Oakview House' },
  });
  const southHome =
    existingSouthHome ??
    (await prisma.home.create({
      data: {
        careGroupId: careGroup.id,
        name: 'Oakview House',
        address: '2 Oakview Lane, Manchester, M1 2AA',
        capacity: 8,
      },
    }));

  const managerEmployee = await prisma.employee.upsert({
    where: { userId: managerUser.id },
    update: {
      homeId: northHome.id,
      jobTitle: 'Home Manager',
      startDate: new Date('2025-11-01T09:00:00.000Z'),
    },
    create: {
      userId: managerUser.id,
      homeId: northHome.id,
      jobTitle: 'Home Manager',
      startDate: new Date('2025-11-01T09:00:00.000Z'),
    },
  });

  const northEmployee = await prisma.employee.upsert({
    where: { userId: staffNorthUser.id },
    update: {
      homeId: northHome.id,
      jobTitle: 'Support Worker',
      startDate: new Date('2026-01-15T09:00:00.000Z'),
    },
    create: {
      userId: staffNorthUser.id,
      homeId: northHome.id,
      jobTitle: 'Support Worker',
      startDate: new Date('2026-01-15T09:00:00.000Z'),
    },
  });

  const southEmployee = await prisma.employee.upsert({
    where: { userId: staffSouthUser.id },
    update: {
      homeId: southHome.id,
      jobTitle: 'Support Worker',
      startDate: new Date('2026-01-20T09:00:00.000Z'),
    },
    create: {
      userId: staffSouthUser.id,
      homeId: southHome.id,
      jobTitle: 'Support Worker',
      startDate: new Date('2026-01-20T09:00:00.000Z'),
    },
  });

  const ypNorth = await prisma.youngPerson.upsert({
    where: { referenceNo: 'YP-NORTH-001' },
    update: {
      homeId: northHome.id,
      firstName: 'Liam',
      lastName: 'Carter',
      isActive: true,
    },
    create: {
      homeId: northHome.id,
      firstName: 'Liam',
      lastName: 'Carter',
      referenceNo: 'YP-NORTH-001',
      isActive: true,
    },
  });

  const ypSouth = await prisma.youngPerson.upsert({
    where: { referenceNo: 'YP-SOUTH-001' },
    update: {
      homeId: southHome.id,
      firstName: 'Ava',
      lastName: 'Morris',
      isActive: true,
    },
    create: {
      homeId: southHome.id,
      firstName: 'Ava',
      lastName: 'Morris',
      referenceNo: 'YP-SOUTH-001',
      isActive: true,
    },
  });

  // Reset previous timeline seed data for a deterministic rerun.
  await prisma.employeeShift.deleteMany({
    where: {
      startTime: { gte: seedStart, lte: now },
      homeId: { in: [northHome.id, southHome.id] },
    },
  });
  await prisma.homeEvent.deleteMany({
    where: {
      startsAt: { gte: seedStart, lte: now },
      homeId: { in: [northHome.id, southHome.id] },
    },
  });
  await prisma.task.deleteMany({
    where: {
      createdById: adminUser.id,
      dueDate: { gte: seedStart, lte: now },
    },
  });

  const eventsData: Array<{
    homeId: string;
    title: string;
    description: string;
    startsAt: Date;
    endsAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  const shiftsData: Array<{
    homeId: string;
    employeeId: string;
    startTime: Date;
    endTime: Date;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  const tasksData: Array<{
    title: string;
    description: string;
    status: TaskStatus;
    approvalStatus: TaskApprovalStatus;
    priority: TaskPriority;
    dueDate: Date;
    completedAt: Date | null;
    rejectionReason: string | null;
    approvedAt: Date | null;
    assigneeId: string;
    approvedById: string | null;
    youngPersonId: string;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  allDays.forEach((day, index) => {
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const northEventStart = atHour(day, 9, isWeekend ? 30 : 0);
    const northEventEnd = atHour(day, 10, isWeekend ? 15 : 0);
    const southEventStart = atHour(day, 11, 0);
    const southEventEnd = atHour(day, 12, 0);

    eventsData.push(
      {
        homeId: northHome.id,
        title: isWeekend ? 'Weekend Wellbeing Session' : 'Morning Provision Planning',
        description: 'Daily support planning, risk checks, and priorities review.',
        startsAt: northEventStart,
        endsAt: northEventEnd,
        createdAt: northEventStart,
        updatedAt: northEventStart,
      },
      {
        homeId: southHome.id,
        title: isWeekend ? 'Community Activity Briefing' : 'Education & Care Coordination',
        description: 'Cross-team sync for education attendance and care delivery.',
        startsAt: southEventStart,
        endsAt: southEventEnd,
        createdAt: southEventStart,
        updatedAt: southEventStart,
      },
    );

    shiftsData.push(
      {
        homeId: northHome.id,
        employeeId: northEmployee.id,
        startTime: atHour(day, 7, 0),
        endTime: atHour(day, 15, 0),
        createdAt: atHour(day, 7, 0),
        updatedAt: atHour(day, 7, 0),
      },
      {
        homeId: northHome.id,
        employeeId: managerEmployee.id,
        startTime: atHour(day, 9, 0),
        endTime: atHour(day, 17, 0),
        createdAt: atHour(day, 9, 0),
        updatedAt: atHour(day, 9, 0),
      },
      {
        homeId: southHome.id,
        employeeId: southEmployee.id,
        startTime: atHour(day, 8, 0),
        endTime: atHour(day, 16, 0),
        createdAt: atHour(day, 8, 0),
        updatedAt: atHour(day, 8, 0),
      },
    );

    const northDue = atHour(day, 16, 0);
    const southDue = atHour(day, 17, 0);
    const statusPattern = index % 6;

    const northStatus = statusPattern === 0 ? TaskStatus.completed : TaskStatus.pending;
    const northApproval =
      statusPattern === 0
        ? TaskApprovalStatus.approved
        : statusPattern === 2
          ? TaskApprovalStatus.pending_approval
          : TaskApprovalStatus.not_required;

    tasksData.push({
      title: `North Home Daily Note ${index + 1}`,
      description: 'Update care notes and complete end-of-day summary.',
      status: northStatus,
      approvalStatus: northApproval,
      priority:
        statusPattern === 4
          ? TaskPriority.high
          : statusPattern === 5
            ? TaskPriority.urgent
            : TaskPriority.medium,
      dueDate: northDue,
      completedAt: northStatus === TaskStatus.completed ? atHour(day, 18, 0) : null,
      rejectionReason: null,
      approvedAt: northApproval === TaskApprovalStatus.approved ? atHour(day, 18, 30) : null,
      assigneeId: northEmployee.id,
      approvedById: northApproval === TaskApprovalStatus.approved ? managerEmployee.id : null,
      youngPersonId: ypNorth.id,
      createdById: adminUser.id,
      createdAt: atHour(day, 8, 0),
      updatedAt: atHour(day, 8, 0),
    });

    const southStatus = statusPattern === 3 ? TaskStatus.completed : TaskStatus.pending;
    const southApproval =
      statusPattern === 1
        ? TaskApprovalStatus.rejected
        : southStatus === TaskStatus.completed
          ? TaskApprovalStatus.approved
          : TaskApprovalStatus.not_required;

    tasksData.push({
      title: `South Home Daily Task ${index + 1}`,
      description: 'Prepare activity report and safeguarding checklist.',
      status: southStatus,
      approvalStatus: southApproval,
      priority: statusPattern === 1 ? TaskPriority.high : TaskPriority.medium,
      dueDate: southDue,
      completedAt: southStatus === TaskStatus.completed ? atHour(day, 19, 0) : null,
      rejectionReason:
        southApproval === TaskApprovalStatus.rejected
          ? 'Missing attachment in daily report.'
          : null,
      approvedAt:
        southApproval === TaskApprovalStatus.approved
          ? atHour(day, 19, 30)
          : null,
      assigneeId: southEmployee.id,
      approvedById:
        southApproval === TaskApprovalStatus.approved ||
        southApproval === TaskApprovalStatus.rejected
          ? managerEmployee.id
          : null,
      youngPersonId: ypSouth.id,
      createdById: adminUser.id,
      createdAt: atHour(day, 9, 0),
      updatedAt: atHour(day, 9, 0),
    });
  });

  await prisma.homeEvent.createMany({ data: eventsData });
  await prisma.employeeShift.createMany({ data: shiftsData });
  await prisma.task.createMany({ data: tasksData });

  console.log(
    `Seeded timeline ${seedStart.toISOString().slice(0, 10)} to ${now.toISOString().slice(0, 10)} `
    + `with ${eventsData.length} events, ${shiftsData.length} shifts, ${tasksData.length} tasks.`,
  );
  console.log(
    `Core entities: admin(${adminUser.id}), manager(${managerUser.id}), homes(${northHome.id}, ${southHome.id}).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
