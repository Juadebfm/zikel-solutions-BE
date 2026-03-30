#!/usr/bin/env node
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  PrismaClient,
  MembershipStatus,
  TenantRole,
  UserRole,
  TaskApprovalStatus,
  TaskPriority,
  TaskStatus,
  TaskCategory,
  TaskReferenceType,
  TaskReferenceEntityType,
} from '@prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_EMAIL = process.argv[2] ?? process.env.TARGET_EMAIL ?? 'izuobani@zikelsolutions.com';
const MARKER = '[seed:izu-rich-v1]';
const DEFAULT_PASSWORD_HASH = await bcrypt.hash('TempPass123!', 12);

function fullName(user) {
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
}

function nowPlusDays(days, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function signatureAvatar(seed) {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}

const CANONICAL_TASK_GROUP_LABELS = {
  [TaskCategory.task_log]: 'Task Log',
  [TaskCategory.document]: 'Document',
  [TaskCategory.system_link]: 'System Link',
  [TaskCategory.checklist]: 'Checklist',
  [TaskCategory.incident]: 'Incident',
  [TaskCategory.other]: 'General',
};

async function resolveTenantForUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeTenantId: true },
  });

  if (user?.activeTenantId) {
    const activeTenant = await prisma.tenant.findUnique({
      where: { id: user.activeTenantId },
      select: { id: true, name: true, slug: true },
    });
    if (activeTenant) return activeTenant;
  }

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      userId,
      status: MembershipStatus.active,
    },
    include: {
      tenant: {
        select: { id: true, name: true, slug: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return membership?.tenant ?? null;
}

async function ensureMembership(tenantId, userId, role, invitedById) {
  return prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId,
        userId,
      },
    },
    update: {
      role,
      status: MembershipStatus.active,
      invitedById,
    },
    create: {
      tenantId,
      userId,
      role,
      status: MembershipStatus.active,
      invitedById,
    },
  });
}

async function upsertHomeByName({ tenantId, careGroupId, name, address, capacity, avatarUrl, details }) {
  const existing = await prisma.home.findFirst({
    where: { tenantId, name },
    select: { id: true },
  });

  if (existing) {
    return prisma.home.update({
      where: { id: existing.id },
      data: {
        careGroupId,
        address,
        capacity,
        avatarUrl,
        details,
        isActive: true,
      },
    });
  }

  return prisma.home.create({
    data: {
      tenantId,
      careGroupId,
      name,
      address,
      capacity,
      avatarUrl,
      details,
      isActive: true,
    },
  });
}

async function main() {
  const target = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  });

  if (!target) {
    throw new Error(`Target user not found for ${TARGET_EMAIL}.`);
  }

  const tenant = await resolveTenantForUser(target.id);
  if (!tenant) {
    throw new Error(`No active tenant found for ${TARGET_EMAIL}.`);
  }

  const reviewerName = fullName(target) || target.email;

  await prisma.user.update({
    where: { id: target.id },
    data: {
      activeTenantId: tenant.id,
      role: target.role === UserRole.super_admin ? UserRole.super_admin : UserRole.admin,
    },
  });

  await ensureMembership(tenant.id, target.id, TenantRole.tenant_admin, target.id);

  const careGroupNorth = await prisma.careGroup.upsert({
    where: {
      tenantId_name: {
        tenantId: tenant.id,
        name: 'Izu Care Group North',
      },
    },
    update: {
      description: `${MARKER} Northern operations group for approval workflow QA.`,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      name: 'Izu Care Group North',
      description: `${MARKER} Northern operations group for approval workflow QA.`,
      isActive: true,
    },
  });

  const careGroupSouth = await prisma.careGroup.upsert({
    where: {
      tenantId_name: {
        tenantId: tenant.id,
        name: 'Izu Care Group South',
      },
    },
    update: {
      description: `${MARKER} Southern operations group for approval workflow QA.`,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      name: 'Izu Care Group South',
      description: `${MARKER} Southern operations group for approval workflow QA.`,
      isActive: true,
    },
  });

  const homeOne = await upsertHomeByName({
    tenantId: tenant.id,
    careGroupId: careGroupNorth.id,
    name: 'Northbridge Home',
    address: '21 Northbridge Road, Manchester M4 8QA',
    capacity: 12,
    avatarUrl: signatureAvatar('northbridge-home'),
    details: {
      homeCode: 'NBH-01',
      type: 'residential',
      managerPhone: '+44 161 000 1001',
      safeguardingLead: 'Miriam Cole',
    },
  });

  const homeTwo = await upsertHomeByName({
    tenantId: tenant.id,
    careGroupId: careGroupSouth.id,
    name: 'Lakeside Home',
    address: '9 Lakeside Avenue, Birmingham B2 4RX',
    capacity: 9,
    avatarUrl: signatureAvatar('lakeside-home'),
    details: {
      homeCode: 'LSH-02',
      type: 'residential',
      managerPhone: '+44 121 000 1002',
      safeguardingLead: 'Daniel Omari',
    },
  });

  const staffUsers = [
    {
      email: 'seed.staff.one@zikelsolutions.com',
      firstName: 'Kemi',
      lastName: 'Adeyemi',
      role: UserRole.staff,
      homeId: homeOne.id,
      title: 'Senior Support Worker',
    },
    {
      email: 'seed.staff.two@zikelsolutions.com',
      firstName: 'Liam',
      lastName: 'Okoro',
      role: UserRole.staff,
      homeId: homeTwo.id,
      title: 'Night Supervisor',
    },
    {
      email: 'seed.staff.three@zikelsolutions.com',
      firstName: 'Nadia',
      lastName: 'Mensah',
      role: UserRole.manager,
      homeId: homeOne.id,
      title: 'Compliance Lead',
    },
  ];

  const seededUsers = [];
  for (const entry of staffUsers) {
    const user = await prisma.user.upsert({
      where: { email: entry.email },
      update: {
        firstName: entry.firstName,
        lastName: entry.lastName,
        role: entry.role,
        emailVerified: true,
        acceptedTerms: true,
        isActive: true,
        activeTenantId: tenant.id,
        avatarUrl: signatureAvatar(entry.email),
      },
      create: {
        email: entry.email,
        passwordHash: DEFAULT_PASSWORD_HASH,
        firstName: entry.firstName,
        lastName: entry.lastName,
        role: entry.role,
        emailVerified: true,
        acceptedTerms: true,
        isActive: true,
        activeTenantId: tenant.id,
        avatarUrl: signatureAvatar(entry.email),
      },
    });

    await ensureMembership(tenant.id, user.id, TenantRole.staff, target.id);

    const employee = await prisma.employee.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id,
        },
      },
      update: {
        homeId: entry.homeId,
        jobTitle: entry.title,
        isActive: true,
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        homeId: entry.homeId,
        jobTitle: entry.title,
        isActive: true,
      },
    });

    seededUsers.push({ user, employee });
  }

  const youngPeople = [
    {
      referenceNo: 'IZU-YP-001',
      firstName: 'Ethan',
      lastName: 'Mills',
      homeId: homeOne.id,
    },
    {
      referenceNo: 'IZU-YP-002',
      firstName: 'Maya',
      lastName: 'Daniels',
      homeId: homeTwo.id,
    },
  ];

  const seededYoungPeople = [];
  for (const yp of youngPeople) {
    const item = await prisma.youngPerson.upsert({
      where: {
        tenantId_referenceNo: {
          tenantId: tenant.id,
          referenceNo: yp.referenceNo,
        },
      },
      update: {
        firstName: yp.firstName,
        lastName: yp.lastName,
        homeId: yp.homeId,
        isActive: true,
      },
      create: {
        tenantId: tenant.id,
        referenceNo: yp.referenceNo,
        firstName: yp.firstName,
        lastName: yp.lastName,
        homeId: yp.homeId,
        isActive: true,
      },
    });
    seededYoungPeople.push(item);
  }

  const vehicles = [
    {
      registration: 'IZU-VC-001',
      make: 'Ford',
      model: 'Transit Custom',
      year: 2021,
      colour: 'White',
      homeId: homeOne.id,
      avatarUrl: signatureAvatar('IZU-VC-001'),
      details: {
        fleetNumber: 'FLEET-NB-01',
        seatingCapacity: 8,
        fuelType: 'diesel',
      },
    },
    {
      registration: 'IZU-VC-002',
      make: 'Mercedes',
      model: 'Vito',
      year: 2022,
      colour: 'Silver',
      homeId: homeTwo.id,
      avatarUrl: signatureAvatar('IZU-VC-002'),
      details: {
        fleetNumber: 'FLEET-LS-02',
        seatingCapacity: 7,
        fuelType: 'diesel',
      },
    },
  ];

  const seededVehicles = [];
  for (const vehicle of vehicles) {
    const item = await prisma.vehicle.upsert({
      where: { registration: vehicle.registration },
      update: {
        tenantId: tenant.id,
        homeId: vehicle.homeId,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        colour: vehicle.colour,
        isActive: true,
        avatarUrl: vehicle.avatarUrl,
        details: vehicle.details,
        nextServiceDue: nowPlusDays(35, 9, 0),
        motDue: nowPlusDays(60, 9, 0),
      },
      create: {
        tenantId: tenant.id,
        homeId: vehicle.homeId,
        registration: vehicle.registration,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        colour: vehicle.colour,
        isActive: true,
        avatarUrl: vehicle.avatarUrl,
        details: vehicle.details,
        nextServiceDue: nowPlusDays(35, 9, 0),
        motDue: nowPlusDays(60, 9, 0),
      },
    });
    seededVehicles.push(item);
  }

  await prisma.task.deleteMany({
    where: {
      tenantId: tenant.id,
      description: { startsWith: MARKER },
    },
  });

  const taskSeeds = [
    {
      title: 'Overdue Child Protection Policy Acknowledgement',
      category: TaskCategory.document,
      domain: 'Compliance',
      requestId: '9921',
      dueInDays: -2,
      priority: TaskPriority.urgent,
      home: homeOne,
      vehicle: null,
      youngPerson: seededYoungPeople[0],
      assignee: seededUsers[2].employee,
      creator: seededUsers[2].user,
      documentUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      routeUrl: '/policies/child-protection',
      notes: 'Review child protection policy revision and sign-off before dashboard access.',
      previewFields: [
        { label: 'Requested By', value: 'Sarah Jenkins' },
        { label: 'Policy Version', value: 'v3.2' },
      ],
    },
    {
      title: 'Overdue Fleet Safety Checklist Sign-off',
      category: TaskCategory.task_log,
      domain: 'Operations',
      requestId: '9945',
      dueInDays: -1,
      priority: TaskPriority.high,
      home: homeTwo,
      vehicle: seededVehicles[1],
      youngPerson: null,
      assignee: seededUsers[1].employee,
      creator: seededUsers[1].user,
      documentUrl: null,
      routeUrl: '/tasks/fleet/IZU-VC-002/safety-check',
      notes: 'Complete vehicle safety checklist and confirm odometer readings.',
      previewFields: [
        { label: 'Vehicle', value: 'Mercedes Vito IZU-VC-002' },
        { label: 'Mileage', value: '84,120 mi' },
      ],
    },
    {
      title: 'Due Soon Medication Incident Review',
      category: TaskCategory.incident,
      domain: 'Clinical',
      requestId: '9952',
      dueInDays: 1,
      priority: TaskPriority.high,
      home: homeOne,
      vehicle: null,
      youngPerson: seededYoungPeople[0],
      assignee: seededUsers[0].employee,
      creator: seededUsers[0].user,
      documentUrl: null,
      routeUrl: '/incidents/review/medication',
      notes: 'Medication discrepancy follow-up; pending manager approval.',
      previewFields: [
        { label: 'Severity', value: 'Medium' },
        { label: 'Location', value: 'Northbridge Home' },
      ],
    },
    {
      title: 'Upcoming Home Compliance Checklist',
      category: TaskCategory.checklist,
      domain: 'Compliance',
      requestId: '9970',
      dueInDays: 3,
      priority: TaskPriority.medium,
      home: homeTwo,
      vehicle: null,
      youngPerson: seededYoungPeople[1],
      assignee: seededUsers[2].employee,
      creator: seededUsers[2].user,
      documentUrl: null,
      routeUrl: '/homes/compliance/lakeside',
      notes: 'Monthly home compliance checklist due in three days.',
      previewFields: [
        { label: 'Checklist Window', value: 'March 2026' },
        { label: 'Home', value: 'Lakeside Home' },
      ],
    },
    {
      title: 'Document Review: Whistleblowing Procedure',
      category: TaskCategory.document,
      domain: 'Staffing',
      requestId: '9988',
      dueInDays: 2,
      priority: TaskPriority.medium,
      home: homeOne,
      vehicle: null,
      youngPerson: null,
      assignee: seededUsers[0].employee,
      creator: seededUsers[2].user,
      documentUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      routeUrl: '/policies/whistleblowing',
      notes: 'Procedure update distributed to all tenant admins.',
      previewFields: [
        { label: 'Owner', value: 'People Operations' },
        { label: 'Effective Date', value: '2026-04-01' },
      ],
    },
  ];

  const createdTasks = [];

  for (const taskSeed of taskSeeds) {
    const dueDate = nowPlusDays(taskSeed.dueInDays, 10, 30);
    const submissionPayload = {
      approverNames: [reviewerName],
      domain: taskSeed.domain,
      requestId: taskSeed.requestId,
      summary: taskSeed.notes,
      previewFields: taskSeed.previewFields,
      summaryMetrics: Object.fromEntries(taskSeed.previewFields.map((item) => [item.label, item.value])),
      sections: [
        {
          title: taskSeed.title,
          fields: [
            { key: 'summary', label: 'Summary', type: 'textarea', value: taskSeed.notes },
            { key: 'dueDate', label: 'Due date', type: 'date', value: dueDate.toISOString().slice(0, 10) },
          ],
        },
      ],
    };

    const created = await prisma.task.create({
      data: {
        tenantId: tenant.id,
        title: taskSeed.title,
        description: `${MARKER} ${taskSeed.notes}`,
        category: taskSeed.category,
        status: TaskStatus.pending,
        approvalStatus: TaskApprovalStatus.pending_approval,
        priority: taskSeed.priority,
        dueDate,
        formName: taskSeed.title,
        formGroup: CANONICAL_TASK_GROUP_LABELS[taskSeed.category] ?? 'General',
        submissionPayload,
        submittedAt: new Date(),
        submittedById: taskSeed.creator.id,
        updatedById: taskSeed.creator.id,
        createdById: taskSeed.creator.id,
        assigneeId: taskSeed.assignee.id,
        homeId: taskSeed.home.id,
        vehicleId: taskSeed.vehicle?.id ?? null,
        youngPersonId: taskSeed.youngPerson?.id ?? null,
        references: {
          create: [
            {
              tenantId: tenant.id,
              type: TaskReferenceType.entity,
              entityType: TaskReferenceEntityType.home,
              entityId: taskSeed.home.id,
              label: taskSeed.home.name,
            },
            ...(taskSeed.youngPerson
              ? [
                  {
                    tenantId: tenant.id,
                    type: TaskReferenceType.entity,
                    entityType: TaskReferenceEntityType.young_person,
                    entityId: taskSeed.youngPerson.id,
                    label: `${taskSeed.youngPerson.firstName} ${taskSeed.youngPerson.lastName}`,
                  },
                ]
              : []),
            ...(taskSeed.vehicle
              ? [
                  {
                    tenantId: tenant.id,
                    type: TaskReferenceType.entity,
                    entityType: TaskReferenceEntityType.vehicle,
                    entityId: taskSeed.vehicle.id,
                    label: taskSeed.vehicle.registration,
                  },
                ]
              : []),
            {
              tenantId: tenant.id,
              type: TaskReferenceType.internal_route,
              url: taskSeed.routeUrl,
              label: 'Open in system',
            },
            ...(taskSeed.documentUrl
              ? [
                  {
                    tenantId: tenant.id,
                    type: TaskReferenceType.document_url,
                    url: taskSeed.documentUrl,
                    label: 'Supporting document',
                  },
                ]
              : []),
          ],
        },
      },
      include: {
        references: true,
      },
    });

    createdTasks.push(created);
  }

  const pendingAll = await prisma.task.count({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      approvalStatus: TaskApprovalStatus.pending_approval,
    },
  });

  const overdueGate = await prisma.task.count({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      approvalStatus: TaskApprovalStatus.pending_approval,
      dueDate: { lt: nowPlusDays(0, 0, 0) },
    },
  });

  const popupCount = await prisma.task.count({
    where: {
      tenantId: tenant.id,
      deletedAt: null,
      approvalStatus: TaskApprovalStatus.pending_approval,
      OR: [{ dueDate: null }, { dueDate: { gte: nowPlusDays(0, 0, 0) } }],
    },
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        targetEmail: TARGET_EMAIL,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
        },
        seeded: {
          staffUsers: seededUsers.length,
          homes: 2,
          vehicles: seededVehicles.length,
          youngPeople: seededYoungPeople.length,
          tasksCreated: createdTasks.length,
        },
        pendingApproval: {
          all: pendingAll,
          gate: overdueGate,
          popup: popupCount,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
