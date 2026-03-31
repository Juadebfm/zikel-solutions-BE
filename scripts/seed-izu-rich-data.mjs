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

async function upsertHomeByName(data) {
  const { tenantId, careGroupId, name, ...rest } = data;
  const existing = await prisma.home.findFirst({
    where: { tenantId, name },
    select: { id: true },
  });

  if (existing) {
    return prisma.home.update({
      where: { id: existing.id },
      data: { careGroupId, ...rest, isActive: true },
    });
  }

  return prisma.home.create({
    data: { tenantId, careGroupId, name, ...rest, isActive: true },
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
    description: 'Specialist residential care home for young people aged 8-17 with complex needs.',
    address: '21 Northbridge Road, Manchester M4 8QA',
    postCode: 'M4 8QA',
    capacity: 12,
    category: "Children's Home",
    region: 'North West',
    status: 'current',
    phoneNumber: '+44 161 000 1001',
    email: 'northbridge@thresidentialservice.co.uk',
    startDate: new Date('2025-11-18'),
    isSecure: false,
    shortTermStays: false,
    minAgeGroup: 8,
    maxAgeGroup: 17,
    ofstedUrn: 'SC500123',
    avatarUrl: signatureAvatar('northbridge-home'),
    compliance: {
      patDate: null,
      electricalCertificate: null,
      gasCertificate: null,
      dayFireDrill: null,
      nightFireDrill: null,
      healthSafetyRiskDate: null,
      healthSafetyPremisesCheckDate: null,
      fireRiskDate: null,
      fireServiceVisitDate: null,
      environmentalHealthVisitDate: null,
      environmentalHealthOutcome: null,
      employersLiabilityInsuranceDate: null,
    },
    details: {
      homeCode: 'NBH-01',
      type: 'residential',
      safeguardingLead: 'Miriam Cole',
      ofsted: {
        fullRating: null,
        ratingDate: null,
        numberOfRequirements: 0,
        regulationNumbersForRequirements: null,
        numberOfRecommendations: 0,
        regulationNumbersForRecommendations: null,
        interimRating: null,
        interimRatingDate: null,
      },
    },
  });

  const homeTwo = await upsertHomeByName({
    tenantId: tenant.id,
    careGroupId: careGroupSouth.id,
    name: 'Lakeside Home',
    description: 'Two-bed solo/dual placement home for young people requiring intensive support.',
    address: '9 Lakeside Avenue, Birmingham B2 4RX',
    postCode: 'B2 4RX',
    capacity: 4,
    category: "Children's Home",
    region: 'West Midlands',
    status: 'current',
    phoneNumber: '+44 121 000 1002',
    email: 'lakeside@thresidentialservice.co.uk',
    startDate: new Date('2025-06-01'),
    isSecure: false,
    shortTermStays: true,
    minAgeGroup: 10,
    maxAgeGroup: 18,
    ofstedUrn: 'SC500456',
    avatarUrl: signatureAvatar('lakeside-home'),
    compliance: {
      patDate: '2025-09-15',
      electricalCertificate: '2025-08-20',
      gasCertificate: '2025-07-10',
      dayFireDrill: '2026-01-15',
      nightFireDrill: '2026-02-10',
      healthSafetyRiskDate: '2025-12-01',
      healthSafetyPremisesCheckDate: null,
      fireRiskDate: '2025-11-20',
      fireServiceVisitDate: null,
      environmentalHealthVisitDate: null,
      environmentalHealthOutcome: null,
      employersLiabilityInsuranceDate: '2026-06-30',
    },
    details: {
      homeCode: 'LSH-02',
      type: 'residential',
      safeguardingLead: 'Daniel Omari',
      ofsted: {
        fullRating: 'Good',
        ratingDate: '2025-10-01',
        numberOfRequirements: 1,
        regulationNumbersForRequirements: 'Reg 12',
        numberOfRecommendations: 2,
        regulationNumbersForRecommendations: 'Reg 34, Reg 35',
        interimRating: null,
        interimRatingDate: null,
      },
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
      preferredName: 'Ethan',
      homeId: homeOne.id,
      dateOfBirth: new Date('2010-03-15'),
      gender: 'Male',
      ethnicity: 'White British',
      status: 'current',
      type: 'Fulltime Resident',
      admissionDate: new Date('2025-11-24'),
      roomNumber: 'Room 3',
      socialWorkerName: 'Hazel Kapfunde',
      placingAuthority: 'Northamptonshire County Council',
      legalStatus: 'Section 20',
      isEmergencyPlacement: false,
      isAsylumSeeker: false,
      contact: {
        currentAddress: '1 Sunderland Street NN5 5ES',
        previousAddress: null,
        dischargeType: null,
        dischargeAddress: null,
        dischargePostcode: null,
        email: null,
        mobile: null,
        socialMedia: null,
      },
      health: {
        nhsNumber: null,
        therapist: null,
        doctorOnAdmission: null,
        currentDoctor: null,
        hospital: null,
        optician: null,
        dentist: null,
        medicalNeeds: null,
        knownAllergies: null,
        personResponsibleForEmergencyTreatment: null,
        registeredDisabled: false,
        otherHealthDetails: null,
      },
      education: {
        universalPupilNumber: null,
        schoolAttended: null,
        attendsSchoolRunByCareGroup: false,
        senStatement: false,
        inFullTimeEducation: false,
      },
    },
    {
      referenceNo: 'IZU-YP-002',
      firstName: 'Maya',
      lastName: 'Daniels',
      preferredName: 'Maya',
      homeId: homeTwo.id,
      dateOfBirth: new Date('2009-07-22'),
      gender: 'Female',
      ethnicity: 'Mixed — White and Black Caribbean',
      status: 'current',
      type: 'Fulltime Resident',
      admissionDate: new Date('2026-01-07'),
      roomNumber: 'Room 1',
      socialWorkerName: 'James Okoye',
      placingAuthority: 'Birmingham City Council',
      legalStatus: 'Section 31',
      isEmergencyPlacement: false,
      isAsylumSeeker: false,
      contact: {
        currentAddress: '9 Lakeside Avenue B2 4RX',
        previousAddress: '45 Birch Lane B12 8HQ',
        email: null,
        mobile: null,
      },
      health: {
        nhsNumber: '943 123 4567',
        currentDoctor: 'Dr Patel',
        dentist: 'Lakeside Dental',
        medicalNeeds: 'Asthma — uses inhaler PRN',
        knownAllergies: 'Peanuts',
        registeredDisabled: false,
      },
      education: {
        universalPupilNumber: 'H801200001234',
        schoolAttended: 'Lakeside Academy',
        attendsSchoolRunByCareGroup: false,
        senStatement: true,
        inFullTimeEducation: true,
      },
    },
    {
      referenceNo: 'IZU-YP-003',
      firstName: 'Jayden',
      lastName: 'Clarke',
      preferredName: 'Jay',
      homeId: homeOne.id,
      dateOfBirth: new Date('2011-11-02'),
      gender: 'Male',
      ethnicity: 'Black British — African',
      status: 'current',
      type: 'Fulltime Resident',
      admissionDate: new Date('2026-02-15'),
      roomNumber: 'Room 5',
      socialWorkerName: 'Rebecca Stone',
      placingAuthority: 'Greater Manchester Combined Authority',
      legalStatus: 'Section 20',
      isEmergencyPlacement: true,
      isAsylumSeeker: false,
      contact: { currentAddress: '21 Northbridge Road M4 8QA' },
      health: { registeredDisabled: false },
      education: { inFullTimeEducation: true, schoolAttended: 'Northbridge Academy' },
    },
  ];

  const seededYoungPeople = [];
  for (const yp of youngPeople) {
    const { referenceNo, homeId, ...ypData } = yp;
    const item = await prisma.youngPerson.upsert({
      where: {
        tenantId_referenceNo: {
          tenantId: tenant.id,
          referenceNo,
        },
      },
      update: {
        ...ypData,
        homeId,
        isActive: true,
      },
      create: {
        tenantId: tenant.id,
        referenceNo,
        homeId,
        ...ypData,
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
      description: 'Primary transport vehicle for Northbridge Home.',
      status: 'current',
      vin: 'WF0XXXGCDX1234567',
      fuelType: 'Diesel',
      ownership: 'Purchased',
      purchaseDate: new Date('2021-03-15'),
      startDate: new Date('2021-04-01'),
      contactPhone: '+44 7483 420596',
      homeId: homeOne.id,
      avatarUrl: signatureAvatar('IZU-VC-001'),
      details: { fleetNumber: 'FLEET-NB-01', seatingCapacity: 8 },
    },
    {
      registration: 'IZU-VC-002',
      make: 'Mercedes',
      model: 'Vito',
      year: 2022,
      colour: 'Silver',
      description: 'Lakeside Home shared transport.',
      status: 'current',
      vin: 'FRLAREWJ11UEAR-F-A',
      fuelType: 'Diesel',
      ownership: 'Leased',
      leaseStartDate: new Date('2022-01-01'),
      leaseEndDate: new Date('2027-01-01'),
      startDate: new Date('2022-01-07'),
      contactPhone: '+44 7483 420596',
      homeId: homeTwo.id,
      avatarUrl: signatureAvatar('IZU-VC-002'),
      details: { fleetNumber: 'FLEET-LS-02', seatingCapacity: 7 },
    },
    {
      registration: 'IZU-VC-003',
      make: 'Nissan',
      model: 'Qashqai',
      year: 2023,
      colour: 'Red',
      description: 'Staff pool car.',
      status: 'current',
      fuelType: 'Petrol',
      ownership: 'Purchased',
      purchaseDate: new Date('2023-06-10'),
      startDate: new Date('2023-07-01'),
      homeId: homeOne.id,
      avatarUrl: signatureAvatar('IZU-VC-003'),
      details: { fleetNumber: 'FLEET-NB-03', seatingCapacity: 5 },
    },
  ];

  const seededVehicles = [];
  for (const vehicle of vehicles) {
    const { registration, homeId, ...vData } = vehicle;
    const item = await prisma.vehicle.upsert({
      where: { registration },
      update: {
        tenantId: tenant.id,
        homeId,
        ...vData,
        isActive: true,
        nextServiceDue: nowPlusDays(35, 9, 0),
        motDue: nowPlusDays(60, 9, 0),
      },
      create: {
        tenantId: tenant.id,
        homeId,
        registration,
        ...vData,
        isActive: true,
        nextServiceDue: nowPlusDays(35, 9, 0),
        motDue: nowPlusDays(60, 9, 0),
      },
    });
    seededVehicles.push(item);
  }

  // ─── Roles ──────────────────────────────────────────────────────────────────

  const defaultRoles = [
    { name: 'Administrator', description: 'Main system administrator', permissions: { systemAdmin: 'read_write', userAdmin: 'read_write', tasks: 'read_write', sensitiveData: 'read_write', canDeleteTasks: true, hasDashboard: true, hasSummary: true, hasReports: true, canCreateYoungPerson: true, canCreateEmployees: true, canCreateVehicles: true, canExportData: true } },
    { name: 'Registered Manager', description: 'Home manager', permissions: { tasks: 'read_write', sensitiveData: 'read_write', dailyLogs: 'read_write', formsProcedures: 'read_write', canDeleteTasks: true, hasDashboard: true, hasSummary: true, hasReports: true, canCreateYoungPerson: true, canCreateEmployees: true, billingApproval: false } },
    { name: 'Deputy Manager', description: 'Deputy home manager', permissions: { tasks: 'read_write', sensitiveData: 'read_write', dailyLogs: 'read_write', formsProcedures: 'read_write', canDeleteTasks: false, hasDashboard: true, hasSummary: true, hasReports: true } },
    { name: 'Reg 44 Inspector', description: 'Ofsted Reg 44 Inspector', permissions: { tasks: 'read', sensitiveData: 'read', dailyLogs: 'read', hasReports: true, hasSummary: true } },
    { name: 'Residential Care Worker', description: 'Delivery of care', permissions: { tasks: 'read_write', dailyLogs: 'read_write', formsProcedures: 'read_write', hasSummary: true, canDeleteTasks: false, canExportData: false } },
    { name: 'Team Leader', description: 'Care team leader', permissions: { tasks: 'read_write', dailyLogs: 'read_write', formsProcedures: 'read_write', sensitiveData: 'read', hasDashboard: true, hasSummary: true, canDeleteTasks: false } },
    { name: 'Young Person', description: 'Young Person personal login', permissions: { tasks: 'no_access', dailyLogs: 'no_access', rewards: 'read', hasSummary: false, hasDashboard: false } },
  ];

  const seededRoles = [];
  for (const role of defaultRoles) {
    const item = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: role.name } },
      update: { description: role.description, permissions: role.permissions, isActive: true, isSystemGenerated: true },
      create: { tenantId: tenant.id, name: role.name, description: role.description, permissions: role.permissions, isActive: true, isSystemGenerated: true },
    });
    seededRoles.push(item);
  }
  console.log(`Seeded ${seededRoles.length} roles.`);

  // Assign roles to employees
  const roleMap = Object.fromEntries(seededRoles.map((r) => [r.name, r.id]));
  if (seededUsers.length >= 3) {
    await prisma.employee.update({ where: { id: seededUsers[0].employee.id }, data: { roleId: roleMap['Residential Care Worker'], status: 'current', contractType: 'Full-time', dbsNumber: 'DBS-001-2025', dbsDate: new Date('2025-06-15') } });
    await prisma.employee.update({ where: { id: seededUsers[1].employee.id }, data: { roleId: roleMap['Team Leader'], status: 'current', contractType: 'Full-time', dbsNumber: 'DBS-002-2025', dbsDate: new Date('2025-04-20') } });
    await prisma.employee.update({ where: { id: seededUsers[2].employee.id }, data: { roleId: roleMap['Deputy Manager'], status: 'current', contractType: 'Full-time', dbsNumber: 'DBS-003-2024', dbsDate: new Date('2024-11-10') } });
  }

  // ─── Home Events ───────────────────────────────────────────────────────────

  await prisma.homeEvent.deleteMany({ where: { tenantId: tenant.id, description: { startsWith: MARKER } } });

  const eventData = [
    { homeId: homeOne.id, title: 'Reg 44 Visit', description: `${MARKER} Monthly Reg 44 inspection visit.`, startsAt: nowPlusDays(3, 10, 0), endsAt: nowPlusDays(3, 12, 0) },
    { homeId: homeOne.id, title: 'Fire Drill (Day)', description: `${MARKER} Planned daytime fire drill.`, startsAt: nowPlusDays(5, 11, 0), endsAt: nowPlusDays(5, 11, 30) },
    { homeId: homeOne.id, title: 'Staff Meeting', description: `${MARKER} Weekly team meeting.`, startsAt: nowPlusDays(1, 14, 0), endsAt: nowPlusDays(1, 15, 0) },
    { homeId: homeOne.id, title: 'LAC Review — Ethan Mills', description: `${MARKER} Looked After Child review.`, startsAt: nowPlusDays(7, 10, 0), endsAt: nowPlusDays(7, 12, 0) },
    { homeId: homeTwo.id, title: 'Social Worker Visit — Maya', description: `${MARKER} Scheduled social worker visit.`, startsAt: nowPlusDays(2, 14, 0), endsAt: nowPlusDays(2, 15, 0) },
    { homeId: homeTwo.id, title: 'Vehicle Safety Check', description: `${MARKER} Quarterly vehicle inspection.`, startsAt: nowPlusDays(10, 9, 0), endsAt: nowPlusDays(10, 10, 0) },
    { homeId: homeTwo.id, title: 'Ofsted Preparation', description: `${MARKER} Internal readiness check.`, startsAt: nowPlusDays(14, 9, 0), endsAt: nowPlusDays(14, 16, 0) },
    { homeId: homeOne.id, title: 'Parent Contact — Jayden', description: `${MARKER} Supervised phone call.`, startsAt: nowPlusDays(0, 17, 0), endsAt: nowPlusDays(0, 17, 30) },
  ];

  await prisma.homeEvent.createMany({
    data: eventData.map((e) => ({ tenantId: tenant.id, ...e })),
  });
  console.log(`Seeded ${eventData.length} home events.`);

  // ─── Employee Shifts ───────────────────────────────────────────────────────

  await prisma.employeeShift.deleteMany({
    where: {
      tenantId: tenant.id,
      employee: { userId: { in: seededUsers.map((s) => s.user.id) } },
    },
  });

  const shiftData = [];
  for (let day = -3; day <= 7; day++) {
    // Staff 1 (Kemi) — day shifts at Northbridge
    if (seededUsers[0]) {
      shiftData.push({ tenantId: tenant.id, homeId: homeOne.id, employeeId: seededUsers[0].employee.id, startTime: nowPlusDays(day, 7, 0), endTime: nowPlusDays(day, 15, 0) });
    }
    // Staff 2 (Liam) — evening/night shifts at Lakeside
    if (seededUsers[1]) {
      shiftData.push({ tenantId: tenant.id, homeId: homeTwo.id, employeeId: seededUsers[1].employee.id, startTime: nowPlusDays(day, 15, 0), endTime: nowPlusDays(day, 23, 0) });
    }
    // Staff 3 (Nadia) — day shifts at Northbridge, Mon-Fri only
    if (seededUsers[2] && nowPlusDays(day, 0, 0).getDay() >= 1 && nowPlusDays(day, 0, 0).getDay() <= 5) {
      shiftData.push({ tenantId: tenant.id, homeId: homeOne.id, employeeId: seededUsers[2].employee.id, startTime: nowPlusDays(day, 8, 0), endTime: nowPlusDays(day, 16, 30) });
    }
  }

  await prisma.employeeShift.createMany({ data: shiftData });
  console.log(`Seeded ${shiftData.length} employee shifts.`);

  // ─── Assign key workers to YPs ─────────────────────────────────────────────

  if (seededUsers[0] && seededYoungPeople[0]) {
    await prisma.youngPerson.update({ where: { id: seededYoungPeople[0].id }, data: { keyWorkerId: seededUsers[0].employee.id, adminUserId: target.id } });
  }
  if (seededUsers[1] && seededYoungPeople[1]) {
    await prisma.youngPerson.update({ where: { id: seededYoungPeople[1].id }, data: { keyWorkerId: seededUsers[1].employee.id, adminUserId: target.id } });
  }

  // ─── Set home admin/responsible people ─────────────────────────────────────

  await prisma.home.update({ where: { id: homeOne.id }, data: { adminUserId: target.id, personInChargeId: target.id, responsibleIndividualId: target.id } });
  await prisma.home.update({ where: { id: homeTwo.id }, data: { adminUserId: target.id, personInChargeId: target.id, responsibleIndividualId: target.id } });

  // ─── Clean up old tasks ────────────────────────────────────────────────────

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

  // ─── Daily Log seed data ──────────────────────────────────────────────────

  // Clean up previous daily log seeds
  await prisma.task.deleteMany({
    where: {
      tenantId: tenant.id,
      category: TaskCategory.daily_log,
      description: { startsWith: MARKER },
    },
  });

  const dailyLogCategories = ['General', 'Incident', 'Medication', 'Behaviour', 'Education', 'Personal Care', 'Contact', 'Safeguarding'];
  const homes = [homeOne, homeTwo];
  const allCreators = [target, ...seededUsers.map((s) => s.user)];
  const allEmployees = seededUsers.map((s) => s.employee);

  const dailyLogNotes = {
    General: (home) => `${MARKER} <p>${home.name} — general daily observations. Residents settled well today. Activities included art session in the morning and group cooking in the afternoon. All routines followed as planned.</p>`,
    Incident: (home) => `${MARKER} <p>Minor incident reported at ${home.name}. A resident became upset during transition to evening routine. De-escalation techniques used successfully. No injuries. Staff debriefed.</p>`,
    Medication: (home) => `${MARKER} <p>Medication round completed at ${home.name}. All medications administered as prescribed. One resident required prompting for evening dose. MAR chart updated and signed.</p>`,
    Behaviour: (home) => `${MARKER} <p>Behavioural observations for ${home.name}. Positive engagement observed during structured activities. Reward points awarded for cooperative behaviour during mealtimes.</p>`,
    Education: (home) => `${MARKER} <p>Education update for ${home.name}. School attendance confirmed — full day with no absences. Homework support provided after school. Teacher feedback was positive.</p>`,
    'Personal Care': (home) => `${MARKER} <p>Personal care log for ${home.name}. All residents supported with morning routines. Laundry done and rooms tidied. No issues reported.</p>`,
    Contact: (home) => `${MARKER} <p>Contact log for ${home.name}. Phone call with social worker — discussed upcoming LAC review and placement objectives. Next review scheduled for next month.</p>`,
    Safeguarding: (home) => `${MARKER} <p>Safeguarding note for ${home.name}. Routine checks completed. All ligature points checked, doors and windows secure. No concerns identified.</p>`,
  };

  const triggerKeys = [null, 'daily-handover', 'daily-summary', null, 'contact-form', null, 'incident', null, 'keyworker-session', null];

  const dailyLogsData = [];
  for (let i = 0; i < 20; i++) {
    const dayOffset = -Math.floor(i * 0.7);
    const hour = 7 + (i % 12);
    const home = homes[i % homes.length];
    const cat = dailyLogCategories[i % dailyLogCategories.length];
    const noteDate = nowPlusDays(dayOffset, hour, (i * 7) % 60);
    const creator = allCreators[i % allCreators.length];
    const employee = allEmployees.length > 0 ? allEmployees[i % allEmployees.length] : null;
    const yp = seededYoungPeople.length > 0 ? seededYoungPeople[i % seededYoungPeople.length] : null;
    const triggerKey = triggerKeys[i % triggerKeys.length];
    const noteFn = dailyLogNotes[cat] ?? dailyLogNotes.General;

    dailyLogsData.push({
      tenantId: tenant.id,
      title: `Daily Log — ${home.name} — ${noteDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      description: noteFn(home),
      category: TaskCategory.daily_log,
      status: i < 15 ? TaskStatus.completed : TaskStatus.pending,
      approvalStatus: i < 10 ? TaskApprovalStatus.approved : i < 15 ? TaskApprovalStatus.not_required : TaskApprovalStatus.pending_approval,
      priority: cat === 'Incident' || cat === 'Safeguarding' ? TaskPriority.high : TaskPriority.medium,
      dueDate: null,
      homeId: home.id,
      youngPersonId: yp?.id ?? null,
      vehicleId: null,
      assigneeId: employee?.id ?? null,
      approvedById: i < 10 && allEmployees.length > 0 ? allEmployees[0].id : null,
      approvedAt: i < 10 ? nowPlusDays(dayOffset, hour + 2) : null,
      completedAt: i < 15 ? nowPlusDays(dayOffset, hour + 1) : null,
      rejectionReason: null,
      createdById: creator.id,
      submittedAt: noteDate,
      submittedById: creator.id,
      updatedById: null,
      formTemplateKey: triggerKey,
      formName: null,
      formGroup: null,
      submissionPayload: {
        dailyLogCategory: cat,
        noteDate: noteDate.toISOString(),
        relatesTo: yp ? { type: 'young_person', id: yp.id } : null,
        triggerTaskFormKey: triggerKey,
      },
      createdAt: noteDate,
      updatedAt: noteDate,
    });
  }

  await prisma.task.createMany({ data: dailyLogsData });
  console.log(`Seeded ${dailyLogsData.length} daily logs for tenant ${tenant.slug}.`);

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
