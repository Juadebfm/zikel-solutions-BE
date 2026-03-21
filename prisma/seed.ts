/**
 * Seed script — populates dev/staging with representative data.
 * Run with: npx tsx prisma/seed.ts
 */
import bcrypt from 'bcryptjs';
import {
  PrismaClient,
  UserRole,
  TenantRole,
  MembershipStatus,
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

function atDay(base: Date, dayOffset: number, hour: number, minute = 0): Date {
  const dt = new Date(base);
  dt.setDate(dt.getDate() + dayOffset);
  dt.setHours(hour, minute, 0, 0);
  return dt;
}

async function main() {
  console.log('Seeding database...');
  const now = new Date();
  const seedStart = new Date(now.getFullYear(), now.getMonth() - 1, 15, 0, 0, 0, 0);
  const seedMarker = '[seed:summary-showcase]';
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
      firstName: 'Izu',
      lastName: 'Obani',
      role: UserRole.manager,
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
    create: {
      email: 'manager@zikel.dev',
      passwordHash: defaultPasswordHash,
      role: UserRole.manager,
      firstName: 'Izu',
      lastName: 'Obani',
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
  });

  const staffNorthUser = await prisma.user.upsert({
    where: { email: 'staff.north@zikel.dev' },
    update: {
      passwordHash: defaultPasswordHash,
      firstName: 'Gabriel',
      lastName: 'Femi',
      role: UserRole.staff,
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
    create: {
      email: 'staff.north@zikel.dev',
      passwordHash: defaultPasswordHash,
      role: UserRole.staff,
      firstName: 'Gabriel',
      lastName: 'Femi',
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
  });

  const staffSouthUser = await prisma.user.upsert({
    where: { email: 'staff.south@zikel.dev' },
    update: {
      passwordHash: defaultPasswordHash,
      firstName: 'Amina',
      lastName: 'Okafor',
      role: UserRole.staff,
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
    create: {
      email: 'staff.south@zikel.dev',
      passwordHash: defaultPasswordHash,
      role: UserRole.staff,
      firstName: 'Amina',
      lastName: 'Okafor',
      country: Country.UK,
      emailVerified: true,
      acceptedTerms: true,
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'zikel-dev' },
    update: {
      name: 'Zikel Dev Tenant',
      country: Country.UK,
      isActive: true,
    },
    create: {
      name: 'Zikel Dev Tenant',
      slug: 'zikel-dev',
      country: Country.UK,
      isActive: true,
    },
  });

  await prisma.user.updateMany({
    where: { id: { in: [adminUser.id, managerUser.id, staffNorthUser.id, staffSouthUser.id] } },
    data: { activeTenantId: tenant.id },
  });

  const ensureMembership = async (userId: string, role: TenantRole) => {
    await prisma.tenantMembership.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId,
        },
      },
      update: {
        role,
        status: MembershipStatus.active,
      },
      create: {
        tenantId: tenant.id,
        userId,
        role,
        status: MembershipStatus.active,
        invitedById: adminUser.id,
      },
    });
  };

  await ensureMembership(adminUser.id, TenantRole.tenant_admin);
  await ensureMembership(managerUser.id, TenantRole.sub_admin);
  await ensureMembership(staffNorthUser.id, TenantRole.staff);
  await ensureMembership(staffSouthUser.id, TenantRole.staff);

  const careGroup = await prisma.careGroup.upsert({
    where: {
      tenantId_name: {
        tenantId: tenant.id,
        name: 'Northern Region',
      },
    },
    update: {
      description: 'Primary operational region for summary showcase data',
    },
    create: {
      tenantId: tenant.id,
      name: 'Northern Region',
      description: 'Primary operational region for summary showcase data',
    },
  });

  const existingNorthHome = await prisma.home.findFirst({
    where: {
      tenantId: tenant.id,
      careGroupId: careGroup.id,
      OR: [{ name: 'Fortuna Homes' }, { name: 'The Homeland' }, { name: 'Sunrise House' }],
    },
  });
  const northHome = existingNorthHome
    ? await prisma.home.update({
        where: { id: existingNorthHome.id },
        data: {
          careGroupId: careGroup.id,
          name: 'Fortuna Homes',
          address: '1 Fortuna Way, Leeds, LS1 1AA',
          capacity: 10,
          isActive: true,
        },
      })
    : await prisma.home.create({
        data: {
          tenantId: tenant.id,
          careGroupId: careGroup.id,
          name: 'Fortuna Homes',
          address: '1 Fortuna Way, Leeds, LS1 1AA',
          capacity: 10,
        },
      });

  const existingSouthHome = await prisma.home.findFirst({
    where: { tenantId: tenant.id, careGroupId: careGroup.id, name: 'Oakview House' },
  });
  const southHome = existingSouthHome
    ? await prisma.home.update({
        where: { id: existingSouthHome.id },
        data: {
          careGroupId: careGroup.id,
          isActive: false,
        },
      })
    : await prisma.home.create({
        data: {
          tenantId: tenant.id,
          careGroupId: careGroup.id,
          name: 'Oakview House',
          address: '2 Oakview Lane, Manchester, M1 2AA',
          capacity: 8,
          isActive: false,
        },
      });

  const managerEmployee = await prisma.employee.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: managerUser.id,
      },
    },
    update: {
      homeId: northHome.id,
      jobTitle: 'Home Manager',
      startDate: new Date('2025-11-01T09:00:00.000Z'),
    },
    create: {
      tenantId: tenant.id,
      userId: managerUser.id,
      homeId: northHome.id,
      jobTitle: 'Home Manager',
      startDate: new Date('2025-11-01T09:00:00.000Z'),
    },
  });

  const northEmployee = await prisma.employee.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: staffNorthUser.id,
      },
    },
    update: {
      homeId: northHome.id,
      jobTitle: 'Support Worker',
      startDate: new Date('2026-01-15T09:00:00.000Z'),
    },
    create: {
      tenantId: tenant.id,
      userId: staffNorthUser.id,
      homeId: northHome.id,
      jobTitle: 'Support Worker',
      startDate: new Date('2026-01-15T09:00:00.000Z'),
    },
  });

  const southEmployee = await prisma.employee.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: staffSouthUser.id,
      },
    },
    update: {
      homeId: northHome.id,
      jobTitle: 'Support Worker',
      startDate: new Date('2026-01-20T09:00:00.000Z'),
    },
    create: {
      tenantId: tenant.id,
      userId: staffSouthUser.id,
      homeId: northHome.id,
      jobTitle: 'Support Worker',
      startDate: new Date('2026-01-20T09:00:00.000Z'),
    },
  });

  const ypNorth = await prisma.youngPerson.upsert({
    where: {
      tenantId_referenceNo: {
        tenantId: tenant.id,
        referenceNo: 'YP-NORTH-001',
      },
    },
    update: {
      homeId: northHome.id,
      firstName: 'Juadeb',
      lastName: 'Gabriel',
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      homeId: northHome.id,
      firstName: 'Juadeb',
      lastName: 'Gabriel',
      referenceNo: 'YP-NORTH-001',
      isActive: true,
    },
  });

  const ypSouth = await prisma.youngPerson.upsert({
    where: {
      tenantId_referenceNo: {
        tenantId: tenant.id,
        referenceNo: 'YP-SOUTH-001',
      },
    },
    update: {
      homeId: northHome.id,
      firstName: 'Gabriel',
      lastName: 'Femi',
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      homeId: northHome.id,
      firstName: 'Gabriel',
      lastName: 'Femi',
      referenceNo: 'YP-SOUTH-001',
      isActive: true,
    },
  });

  // Reset previous showcase seed data for a deterministic rerun.
  await prisma.employeeShift.deleteMany({
    where: {
      tenantId: tenant.id,
      employeeId: { in: [managerEmployee.id, northEmployee.id, southEmployee.id] },
      startTime: { gte: seedStart },
    },
  });
  await prisma.homeEvent.deleteMany({
    where: {
      tenantId: tenant.id,
      homeId: { in: [northHome.id, southHome.id] },
      startsAt: { gte: seedStart },
    },
  });
  await prisma.task.deleteMany({
    where: {
      tenantId: tenant.id,
      OR: [
        {
          createdById: adminUser.id,
          OR: [
            { title: { startsWith: 'North Home Daily Note' } },
            { title: { startsWith: 'South Home Daily Task' } },
          ],
        },
        {
          createdById: { in: [adminUser.id, managerUser.id] },
          description: { startsWith: seedMarker },
        },
        {
          createdById: { in: [adminUser.id, managerUser.id] },
          OR: [
            { title: { startsWith: 'Seed Summary:' } },
            { title: { startsWith: '[Seed Summary]' } },
          ],
        },
      ],
    },
  });

  const eventsData: Array<{
    tenantId: string;
    homeId: string;
    title: string;
    description: string | null;
    startsAt: Date;
    endsAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [
    {
      tenantId: tenant.id,
      homeId: northHome.id,
      title: 'Optician, Appointment 3:00PM - 4:00PM',
      description:
        `${seedMarker} Type: Young Person | Assigned To: Gabriel Femi | Assignees: Any`,
      startsAt: atDay(now, 0, 15, 0),
      endsAt: atDay(now, 0, 16, 0),
      createdAt: atDay(now, 0, 9, 0),
      updatedAt: atDay(now, 0, 9, 0),
    },
    {
      tenantId: tenant.id,
      homeId: northHome.id,
      title: 'Weekend Family Contact Window',
      description: `${seedMarker} Planned support check-in and safeguarding follow-up.`,
      startsAt: atDay(now, 1, 11, 30),
      endsAt: atDay(now, 1, 12, 30),
      createdAt: atDay(now, 0, 9, 15),
      updatedAt: atDay(now, 0, 9, 15),
    },
  ];

  // Keep today intentionally empty to match the "No Shifts For Today" showcase.
  const shiftsData: Array<{
    tenantId: string;
    homeId: string;
    employeeId: string;
    startTime: Date;
    endTime: Date;
    createdAt: Date;
    updatedAt: Date;
  }> = [
    {
      tenantId: tenant.id,
      homeId: northHome.id,
      employeeId: northEmployee.id,
      startTime: atDay(now, 1, 8, 0),
      endTime: atDay(now, 1, 16, 0),
      createdAt: atDay(now, 0, 10, 0),
      updatedAt: atDay(now, 0, 10, 0),
    },
    {
      tenantId: tenant.id,
      homeId: northHome.id,
      employeeId: southEmployee.id,
      startTime: atDay(now, 2, 8, 0),
      endTime: atDay(now, 2, 16, 0),
      createdAt: atDay(now, 0, 10, 30),
      updatedAt: atDay(now, 0, 10, 30),
    },
  ];

  const tasksData: Array<{
    tenantId: string;
    title: string;
    description: string;
    status: TaskStatus;
    approvalStatus: TaskApprovalStatus;
    priority: TaskPriority;
    dueDate: Date | null;
    completedAt: Date | null;
    rejectionReason: string | null;
    approvedAt: Date | null;
    assigneeId: string | null;
    approvedById: string | null;
    youngPersonId: string | null;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  const pushTask = (input: {
    title: string;
    details: string;
    dueDate: Date | null;
    createdAt: Date;
    createdById?: string;
    status?: TaskStatus;
    approvalStatus?: TaskApprovalStatus;
    priority?: TaskPriority;
    assigneeId?: string | null;
    youngPersonId?: string | null;
    approvedById?: string | null;
    approvedAt?: Date | null;
    rejectionReason?: string | null;
  }) => {
    tasksData.push({
      tenantId: tenant.id,
      title: input.title,
      description: `${seedMarker} ${input.details}`,
      status: input.status ?? TaskStatus.pending,
      approvalStatus: input.approvalStatus ?? TaskApprovalStatus.not_required,
      priority: input.priority ?? TaskPriority.medium,
      dueDate: input.dueDate,
      completedAt: null,
      rejectionReason: input.rejectionReason ?? null,
      approvedAt: input.approvedAt ?? null,
      assigneeId: input.assigneeId ?? northEmployee.id,
      approvedById: input.approvedById ?? null,
      youngPersonId: input.youngPersonId ?? ypNorth.id,
      createdById: input.createdById ?? managerUser.id,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  };

  // Overdue = 2 (manager scope)
  pushTask({
    title: 'Overdue Safeguarding Follow-up',
    details: 'Outstanding safeguarding follow-up from previous handover.',
    dueDate: atDay(now, -2, 16, 30),
    createdAt: atDay(now, -3, 9, 0),
    priority: TaskPriority.high,
    youngPersonId: ypNorth.id,
  });
  pushTask({
    title: 'Overdue Incident Documentation',
    details: 'Late incident documentation requiring manager attention.',
    dueDate: atDay(now, -1, 17, 0),
    createdAt: atDay(now, -2, 9, 30),
    priority: TaskPriority.urgent,
    youngPersonId: ypSouth.id,
    assigneeId: southEmployee.id,
  });

  // Due today = 16 (manager scope)
  const dueTodayTasks: Array<{
    title: string;
    personId: string | null;
    assigneeId: string;
    details: string;
  }> = [
    {
      title: 'Daily Summary For JUADEB GABRIEL',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Daily summary and support review for Juadeb Gabriel.',
    },
    {
      title: 'Weekly Menu Planner For JUADEB GABRIEL',
      personId: ypNorth.id,
      assigneeId: southEmployee.id,
      details: 'Menu planning update and dietary check.',
    },
    {
      title: 'Activity Planner For JUADEB GABRIEL',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Activity planning and engagement goals.',
    },
    {
      title: 'Young Person Meeting For JUADEB GABRIEL',
      personId: ypNorth.id,
      assigneeId: southEmployee.id,
      details: 'Weekly young person meeting prep notes.',
    },
    {
      title: 'Daily Education For JUADEB GABRIEL',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Education attendance and progress capture.',
    },
    {
      title: 'Daily Placement Review For JUADEB GABRIEL',
      personId: ypNorth.id,
      assigneeId: southEmployee.id,
      details: 'Placement review and welfare checks.',
    },
    {
      title: 'Contact Family Update For JUADEB GABRIEL',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Family communication log update.',
    },
    {
      title: 'Daily Note For GABRIEL FEMI',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Daily note and emotional wellbeing update.',
    },
    {
      title: 'Education Attendance Check For GABRIEL FEMI',
      personId: ypSouth.id,
      assigneeId: northEmployee.id,
      details: 'Attendance confirmation with follow-up actions.',
    },
    {
      title: 'Room Safety Walkthrough',
      personId: null,
      assigneeId: southEmployee.id,
      details: 'Room safety spot-check across Fortuna Homes.',
    },
    {
      title: 'Nutrition Plan Review',
      personId: null,
      assigneeId: northEmployee.id,
      details: 'Nutrition planning checkpoint and shopping list review.',
    },
    {
      title: 'Medication Prompt Audit',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Medication prompts and MAR note checks.',
    },
    {
      title: 'Daily Behaviour Support Notes',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Behaviour support implementation notes.',
    },
    {
      title: 'Daily Hygiene Support Record',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Personal care support record completion.',
    },
    {
      title: 'Daily Engagement Tracker',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Engagement tracker and wellbeing check.',
    },
    {
      title: 'Family Contact Outcome Notes',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Outcome notes from family contact window.',
    },
  ];

  dueTodayTasks.forEach((task, index) => {
    const hour = 9 + Math.floor(index / 2);
    const minute = index % 2 === 0 ? 0 : 30;
    pushTask({
      title: task.title,
      details: task.details,
      dueDate: atDay(now, 0, hour, minute),
      createdAt: atDay(now, -1, 8 + (index % 4), 15),
      assigneeId: task.assigneeId,
      youngPersonId: task.personId,
      priority: index % 5 === 0 ? TaskPriority.high : TaskPriority.medium,
    });
  });

  // Pending approval = 13 (tenant-wide queue, seeded from admin so they stay in approval column)
  const pendingApprovalTitles = [
    'Daily Cleaning Schedule',
    'Young Person Finance PM Check',
    'Young Person Finance AM Check',
    'Young Person Finance AM Check',
    'Daily Ligature Check',
    'Medication Error Follow-up',
    'End Of Shift Handover Validation',
    'Missing Signature Review',
    'Daily Cash Log Verification',
    'Incident Record Quality Assurance',
    'Support Plan Amendment Review',
    'Daily Room Check Sign-off',
    'Contact Log Approval',
  ];

  pendingApprovalTitles.forEach((title, index) => {
    const isToday = index < 5;
    pushTask({
      title,
      details: isToday
        ? 'Pending manager approval for today.'
        : 'Pending manager approval scheduled ahead.',
      dueDate: isToday ? atDay(now, 0, 14 + index, 0) : atDay(now, index - 3, 10, 30),
      createdAt: atDay(now, -1, 11, index),
      createdById: adminUser.id,
      approvalStatus: TaskApprovalStatus.pending_approval,
      priority: index < 5 ? TaskPriority.high : TaskPriority.medium,
      assigneeId: index % 2 === 0 ? northEmployee.id : southEmployee.id,
      youngPersonId: index % 3 === 0 ? null : index % 2 === 0 ? ypSouth.id : ypNorth.id,
    });
  });

  // Rejected = 11 (manager scope)
  for (let index = 0; index < 11; index += 1) {
    pushTask({
      title: `Rejected Follow-up ${index + 1}`,
      details: 'Task rejected pending additional documentation.',
      dueDate: atDay(now, 14 + index, 11, 0),
      createdAt: atDay(now, 0, 8, index),
      approvalStatus: TaskApprovalStatus.rejected,
      priority: index % 3 === 0 ? TaskPriority.high : TaskPriority.medium,
      assigneeId: index % 2 === 0 ? northEmployee.id : southEmployee.id,
      youngPersonId: index % 2 === 0 ? ypNorth.id : ypSouth.id,
      approvedById: managerEmployee.id,
      approvedAt: atDay(now, 0, 18, 0),
      rejectionReason: 'Missing attachment in supporting evidence.',
    });
  }

  // Future = 83 in manager scope; 11 above are rejected, so add 72 not_required tasks.
  for (let index = 0; index < 72; index += 1) {
    const dueDayOffset = 1 + index;
    pushTask({
      title: `Future Care Task ${String(index + 1).padStart(2, '0')}`,
      details: 'Scheduled forward task for workload forecasting.',
      dueDate: atDay(now, dueDayOffset, 9 + (index % 6), 0),
      createdAt: atDay(now, -(index % 5), 7 + (index % 3), 20),
      priority:
        index % 12 === 0
          ? TaskPriority.urgent
          : index % 5 === 0
            ? TaskPriority.high
            : TaskPriority.medium,
      assigneeId: index % 2 === 0 ? northEmployee.id : southEmployee.id,
      youngPersonId: index % 2 === 0 ? ypNorth.id : ypSouth.id,
    });
  }

  // Draft = 8 (pending + no dueDate)
  for (let index = 0; index < 8; index += 1) {
    pushTask({
      title: `Draft Task ${index + 1}`,
      details: 'Draft item waiting for scheduling.',
      dueDate: null,
      createdAt: atDay(now, -index, 12, 0),
      assigneeId: index % 2 === 0 ? northEmployee.id : southEmployee.id,
      youngPersonId: index % 2 === 0 ? ypNorth.id : ypSouth.id,
      priority: TaskPriority.medium,
    });
  }

  await prisma.homeEvent.createMany({ data: eventsData });
  await prisma.employeeShift.createMany({ data: shiftsData });
  await prisma.task.createMany({ data: tasksData });

  console.log(
    `Seeded showcase timeline from ${seedStart.toISOString().slice(0, 10)} `
    + `with ${eventsData.length} events, ${shiftsData.length} shifts, ${tasksData.length} tasks.`,
  );
  console.log(
    `Core entities: tenant(${tenant.id}), admin(${adminUser.id}), manager(${managerUser.id}), homes(${northHome.id}, ${southHome.id}).`,
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
