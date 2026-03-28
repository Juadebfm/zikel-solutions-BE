/**
 * Seed script — populates dev/staging with representative data.
 * Run with: npx tsx prisma/seed.ts
 */
import bcrypt from 'bcryptjs';
import {
  Prisma,
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

type SeedFormTemplate = {
  key: string;
  name: string;
  group: string;
  description: string;
  schemaJson: Prisma.InputJsonValue;
};

const seedApprovers = ['Sonia Akoto', 'Izu Obani', 'Kwadwo Opoku-Adomako', 'Matilda Howarth'];

function toTemplateKey(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\//g, ' ')
    .replace(/\(/g, ' ')
    .replace(/\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const rawFormTemplateCatalog: Array<{
  name: string;
  group: string;
  description: string;
}> = [
  { name: 'Activity', group: 'Daily Operations', description: 'Daily engagement and participation record.' },
  { name: 'Contact Form', group: 'Communication', description: 'Record contact and important discussion outcomes.' },
  { name: 'Daily Cleaning Schedule', group: 'Household Checks', description: 'Routine home cleaning checklist.' },
  { name: 'Daily Handover', group: 'Shift Handover', description: 'Critical handover notes for the next team.' },
  { name: 'Daily Ligature Check', group: 'Safety Checks', description: 'Routine ligature risk check log.' },
  { name: 'Daily Summary', group: 'Daily Operations', description: 'Daily overview of care, behaviour, and outcomes.' },
  { name: 'Education/Work', group: 'Education', description: 'Education/work attendance and support notes.' },
  { name: 'Incident', group: 'Incidents', description: 'Incident recording and follow-up details.' },
  { name: 'Incident Record Quality Assurance', group: 'Incidents', description: 'QA review for incident records.' },
  { name: 'Keyworker Session', group: 'Keywork', description: 'Structured keyworker session notes and actions.' },
  { name: 'Medication Prompt Audit', group: 'Medication', description: 'Medication prompt and compliance checks.' },
  { name: 'Placement Review', group: 'Placement', description: 'Placement objective progress and updates.' },
  { name: 'Room Safety', group: 'Safety Checks', description: 'Room safety walkthrough checks.' },
  { name: 'Support Plan Amendment Review', group: 'Care Planning', description: 'Review and approve support plan updates.' },
  { name: 'Weekly Activity Planner', group: 'Planning', description: 'Weekly activity planning and targets.' },
  { name: 'Weekly Coshh Check', group: 'Safety Checks', description: 'COSHH safety and stock checks.' },
  { name: 'Weekly Menu', group: 'Nutrition', description: 'Weekly meals and dietary planning details.' },
  { name: 'Weekly vehicle check', group: 'Transport', description: 'Vehicle safety and readiness checks.' },
  { name: 'Waking Night Summary', group: 'Shift Handover', description: 'Night-shift summary and actions.' },
  { name: 'Young Person Finance AM Check', group: 'Finance', description: 'Morning young person finance check.' },
  { name: 'Young Person Finance PM Check', group: 'Finance', description: 'Evening young person finance check.' },
  { name: 'Young Person(s) Meeting', group: 'Meetings', description: 'Young person meeting agenda and outcomes.' },
  { name: 'Daily PM sharps checks', group: 'Safety Checks', description: 'PM sharps safety check log.' },
  { name: 'Daily AM sharps check', group: 'Safety Checks', description: 'AM sharps safety check log.' },
  { name: 'Medication Error Follow-up', group: 'Medication', description: 'Follow-up record for medication errors.' },
  { name: 'Daily Cash Log Verification', group: 'Finance', description: 'Cash log verification record.' },
  { name: 'Daily Room Check Sign-off', group: 'Household Checks', description: 'Daily room checks and sign-off.' },
  { name: 'End Of Shift Handover Validation', group: 'Shift Handover', description: 'Validation checklist for handover quality.' },
  { name: 'Missing Signature Review', group: 'Compliance', description: 'Review and resolve missing signatures.' },
  { name: 'Behaviour Support', group: 'Care Planning', description: 'Behaviour support implementation notes.' },
  { name: 'Personal Care', group: 'Daily Operations', description: 'Personal care and hygiene support notes.' },
  { name: 'Contact Log', group: 'Communication', description: 'Contact preparation and outcome entries.' },
  { name: 'Risk Assessment (activity/task)', group: 'Risk', description: 'Activity/task risk assessment details.' },
  { name: 'Rewards Form', group: 'Rewards', description: 'Reward entries and justifications.' },
  { name: 'Safe and well check', group: 'Safety Checks', description: 'Safe and well checks for residents.' },
];

const seedFormTemplates: SeedFormTemplate[] = rawFormTemplateCatalog.map((entry) => ({
  key: toTemplateKey(entry.name),
  name: entry.name,
  group: entry.group,
  description: entry.description,
  schemaJson: {
    version: 1,
    renderer: 'dynamic',
    sections: [
      {
        key: 'details',
        title: `${entry.name} Details`,
        fields: [
          { key: 'date', label: 'Date', type: 'date', required: true },
          { key: 'notes', label: 'Notes', type: 'textarea', required: false },
          { key: 'signature', label: 'Signature', type: 'signature', required: false },
        ],
      },
    ],
  },
}));

const formTemplateByName = new Map(
  seedFormTemplates.map((template) => [template.name.toLowerCase(), template] as const),
);

function resolveTemplateByName(formName?: string | null) {
  if (!formName) return null;
  return formTemplateByName.get(formName.toLowerCase()) ?? null;
}

function buildWeeklyMenuPayload() {
  return {
    approverNames: seedApprovers,
    sections: [
      {
        title: 'Weekly Menu',
        fields: [
          { key: 'date', label: 'Date', type: 'date', value: '2026-03-21' },
          { key: 'recorded_time', label: 'Recorded Time', type: 'time', value: '09:16' },
          { key: 'monday_breakfast', label: 'Monday Breakfast', type: 'text', value: 'A bowl of corn flakes and smoothie' },
          { key: 'monday_lunch', label: 'Monday Lunch', type: 'text', value: 'Chicken wrap with fruit salad' },
          { key: 'monday_dinner', label: 'Monday Dinner', type: 'text', value: 'Baked salmon, rice, and vegetables' },
          { key: 'yp_input', label: 'Children/Young People have had an input in the menu', type: 'radio', value: 'No', options: ['Yes', 'No'] },
          {
            key: 'yp_input_notes',
            label: 'If No, Please provide details',
            type: 'textarea',
            value: 'Resident requested fewer spicy meals and more familiar comfort food this week.',
          },
        ],
      },
    ],
  } as const;
}

function buildDailyCleaningPayload() {
  return {
    approverNames: seedApprovers,
    sections: [
      {
        title: 'Daily Cleaning Schedule',
        fields: [
          { key: 'date', label: 'Date', type: 'date', value: '2026-03-21' },
          { key: 'time', label: 'Time', type: 'time', value: '08:31' },
          { key: 'vacuum_lounge', label: 'Vacuum Office, stairs, Lounge and Dining Area', type: 'select', value: 'Yes', options: ['Yes', 'No'] },
          { key: 'mop_kitchen', label: 'Mop Kitchen, Dining Area and Rear Entry', type: 'select', value: 'Yes', options: ['Yes', 'No'] },
          { key: 'bathrooms_cleaned', label: 'Clean all bathrooms and mop', type: 'select', value: 'Yes', options: ['Yes', 'No'] },
          { key: 'dishwasher', label: 'Dish washer empty and clean?', type: 'select', value: 'Yes', options: ['Yes', 'No'] },
          { key: 'maintenance_issue', label: 'Any issue to be reported as maintenance?', type: 'select', value: 'No', options: ['Yes', 'No'] },
          { key: 'signature', label: 'Signature', type: 'signature', value: 'data:image/png;base64,seed-signature-cleaning' },
        ],
      },
    ],
  } as const;
}

function buildLigaturePayload() {
  return {
    approverNames: seedApprovers,
    sections: [
      {
        title: 'Daily Ligature Check',
        fields: [
          { key: 'date', label: 'Date', type: 'date', value: '2026-03-21' },
          { key: 'time', label: 'Time', type: 'time', value: '08:18' },
          { key: 'ligature_cutter', label: 'Is there a ligature cutter present within the home?', type: 'radio', value: 'Yes', options: ['Yes', 'No'] },
          { key: 'hotspots', label: 'Areas checked', type: 'multiselect', value: ['Kitchen', 'Bathrooms', 'Bedrooms'], options: ['Kitchen', 'Bathrooms', 'Bedrooms', 'Garden', 'Office'] },
          { key: 'follow_up', label: 'Follow-up action required', type: 'textarea', value: 'No additional action required today.' },
          { key: 'signature', label: 'Signature', type: 'signature', value: 'data:image/png;base64,seed-signature-ligature' },
        ],
      },
    ],
  } as const;
}

function buildFinanceCheckPayload(amOrPm: 'AM' | 'PM') {
  return {
    approverNames: seedApprovers,
    sections: [
      {
        title: `Young Person Finance ${amOrPm} Check`,
        fields: [
          { key: 'date', label: 'Date', type: 'date', value: '2026-03-21' },
          { key: 'shift', label: 'Shift', type: 'text', value: amOrPm },
          { key: 'opening_balance', label: 'Opening Balance', type: 'currency', value: 42.5 },
          { key: 'transactions', label: 'Transactions', type: 'table', value: [
            { item: 'Travel top-up', amount: -5.0, recordedBy: 'Gabriel Femi' },
            { item: 'Pocket money', amount: -10.0, recordedBy: 'Amina Okafor' },
          ] },
          { key: 'closing_balance', label: 'Closing Balance', type: 'currency', value: 27.5 },
          { key: 'variance', label: 'Variance', type: 'currency', value: 0.0 },
          { key: 'signature', label: 'Signature', type: 'signature', value: `data:image/png;base64,seed-signature-finance-${amOrPm.toLowerCase()}` },
        ],
      },
    ],
  } as const;
}

function buildContactFormPayload() {
  return {
    approverNames: seedApprovers,
    sections: [
      {
        title: 'Contact Form',
        fields: [
          { key: 'date', label: 'Date', type: 'date', value: '2026-03-21' },
          { key: 'contact_type', label: 'Contact Type', type: 'select', value: 'Phone', options: ['Phone', 'Face to Face', 'Virtual'] },
          { key: 'participants', label: 'Participants', type: 'multiselect', value: ['Juadeb Gabriel', 'Social Worker', 'Keyworker'], options: ['Juadeb Gabriel', 'Social Worker', 'Keyworker', 'Parent/Carer'] },
          {
            key: 'discussion',
            label: 'Discussion Summary',
            type: 'textarea',
            value: 'Discussed progress in education attendance and agreed a revised evening routine.',
          },
          {
            key: 'actions',
            label: 'Action Items',
            type: 'repeater',
            value: [
              { owner: 'Gabriel Femi', action: 'Share attendance update by Monday', dueDate: '2026-03-23' },
              { owner: 'Social Worker', action: 'Confirm next review date', dueDate: '2026-03-25' },
            ],
          },
        ],
      },
    ],
  } as const;
}

function buildGenericPendingPayload(formName: string, notes: string) {
  return {
    approverNames: seedApprovers,
    sections: [
      {
        title: formName,
        fields: [
          { key: 'date', label: 'Date', type: 'date', value: '2026-03-21' },
          { key: 'summary', label: 'Summary', type: 'text', value: formName },
          { key: 'notes', label: 'Notes', type: 'textarea', value: notes },
          { key: 'signature', label: 'Signature', type: 'signature', value: 'data:image/png;base64,seed-signature-generic' },
        ],
      },
    ],
  } as const;
}

function withSampleReferenceLinks(
  payload: Prisma.InputJsonValue,
  formName: string,
): Prisma.InputJsonValue {
  const slug = toTemplateKey(formName) || 'general';
  const inferredCategory = /(policy|statement|procedure|document|guidance|manual)/i.test(formName)
    ? 'document'
    : 'task log';
  const base =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Prisma.JsonObject)
      : ({ value: payload } as Prisma.JsonObject);

  const referenceLinks = inferredCategory === 'document'
    ? [
        {
          id: `doc-${slug}`,
          type: 'document',
          label: `${formName} Reference (PDF)`,
          url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
          openInNewTab: true,
        },
      ]
    : [
        {
          id: `task-${slug}`,
          type: 'task',
          label: `${formName} Instructions`,
          // FE can map this to app routing directly.
          url: `/help/forms/${slug}`,
          openInNewTab: false,
        },
      ];

  const documentUrl = inferredCategory === 'document' ? referenceLinks[0].url : null;
  const taskUrl = inferredCategory === 'task log' ? referenceLinks[0].url : null;

  return {
    ...base,
    category: inferredCategory,
    referenceLinks,
    documentUrl,
    taskUrl,
  } as Prisma.InputJsonValue;
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

  for (const template of seedFormTemplates) {
    await prisma.formTemplate.upsert({
      where: { key: template.key },
      update: {
        name: template.name,
        group: template.group,
        description: template.description,
        schemaJson: template.schemaJson,
        isActive: true,
      },
      create: {
        key: template.key,
        name: template.name,
        group: template.group,
        description: template.description,
        schemaJson: template.schemaJson,
        isActive: true,
      },
    });
  }

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
    formTemplateKey: string | null;
    formName: string | null;
    formGroup: string | null;
    submissionPayload: Prisma.InputJsonValue | null;
    submittedAt: Date | null;
    submittedById: string | null;
    updatedById: string | null;
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
    formTemplateKey?: string | null;
    formName?: string | null;
    formGroup?: string | null;
    submissionPayload?: Prisma.InputJsonValue | null;
    submittedAt?: Date | null;
    submittedById?: string | null;
    updatedById?: string | null;
    title: string;
    details: string;
    dueDate: Date | null;
    createdAt: Date;
    updatedAt?: Date;
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
    const template = resolveTemplateByName(input.formName ?? input.formGroup);

    tasksData.push({
      tenantId: tenant.id,
      formTemplateKey: input.formTemplateKey ?? template?.key ?? null,
      formName: input.formName ?? input.formGroup ?? template?.name ?? null,
      formGroup: input.formGroup ?? input.formName ?? template?.name ?? null,
      submissionPayload: input.submissionPayload ?? null,
      submittedAt: input.submittedAt ?? null,
      submittedById: input.submittedById ?? null,
      updatedById: input.updatedById ?? null,
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
      updatedAt: input.updatedAt ?? input.createdAt,
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

  type ScheduledSeedTask = {
    title: string;
    formGroup: string;
    personId: string | null;
    assigneeId: string;
    details: string;
  };

  const pushScheduledBatch = (
    dayOffset: number,
    bucketLabel: string,
    batch: ScheduledSeedTask[],
  ) => {
    batch.forEach((task, index) => {
      const hour = 9 + Math.floor(index / 2);
      const minute = index % 2 === 0 ? 0 : 30;
      pushTask({
        title: task.title,
        details:
          `${bucketLabel}. Form Group: ${task.formGroup}. ${task.details}`,
        formName: task.formGroup,
        formGroup: task.formGroup,
        dueDate: atDay(now, dayOffset, hour, minute),
        createdAt: atDay(now, -1, 8 + (index % 4), 15),
        assigneeId: task.assigneeId,
        youngPersonId: task.personId,
        priority: index % 5 === 0 ? TaskPriority.high : TaskPriority.medium,
      });
    });
  };

  // Task explorer-like dated batches (10 today, 10 tomorrow, 10 next tomorrow).
  const dueTodayTasks: ScheduledSeedTask[] = [
    {
      title: 'Waking Night Cleaning Schedule',
      formGroup: 'Daily Cleaning Schedule',
      personId: null,
      assigneeId: southEmployee.id,
      details: 'Waking night cleaning checklist for Fortuna Homes.',
    },
    {
      title: 'Daily PM checks',
      formGroup: 'Daily PM sharps checks',
      personId: null,
      assigneeId: northEmployee.id,
      details: 'PM sharps and room risk checks.',
    },
    {
      title: 'Daily Handover',
      formGroup: 'Daily Handover',
      personId: ypSouth.id,
      assigneeId: northEmployee.id,
      details: 'End-of-shift handover quality notes.',
    },
    {
      title: 'Activity Planner',
      formGroup: 'Weekly Activity Planner',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Daily activity plan update and targets.',
    },
    {
      title: 'Weekly Menu Planner',
      formGroup: 'Weekly Menu',
      personId: ypSouth.id,
      assigneeId: northEmployee.id,
      details: 'Menu adjustments and dietary preference checks.',
    },
    {
      title: 'Young Person Meeting',
      formGroup: 'Young Person(s) Meeting',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Prepare and log young person meeting notes.',
    },
    {
      title: 'Daily Activity',
      formGroup: 'Activity',
      personId: ypSouth.id,
      assigneeId: northEmployee.id,
      details: 'Daily engagement and activity participation record.',
    },
    {
      title: 'Daily Keywork Session',
      formGroup: 'Keyworker Session',
      personId: ypNorth.id,
      assigneeId: southEmployee.id,
      details: 'Keywork session notes and action points.',
    },
    {
      title: 'Daily Education',
      formGroup: 'Education/Work',
      personId: ypSouth.id,
      assigneeId: northEmployee.id,
      details: 'Education/work attendance and support notes.',
    },
    {
      title: 'Daily Summary',
      formGroup: 'Daily Summary',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'End-of-day summary and wellbeing review.',
    },
  ];

  const dueTomorrowTasks: ScheduledSeedTask[] = [
    {
      title: 'Morning Medication Round',
      formGroup: 'Medication Prompt Audit',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Morning medication prompts and MAR audit.',
    },
    {
      title: 'Evening Keywork Session',
      formGroup: 'Keyworker Session',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Evening keywork follow-up and check-in.',
    },
    {
      title: 'Family Contact Prep',
      formGroup: 'Contact Log',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Prepare contact agenda and outcomes template.',
    },
    {
      title: 'Education Plan Review',
      formGroup: 'Education/Work',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Review next-step education support plan.',
    },
    {
      title: 'Activity Risk Assessment',
      formGroup: 'Activity',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Risk assess planned activities and transport.',
    },
    {
      title: 'Placement Plan Update',
      formGroup: 'Placement Review',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Update placement objectives and progress.',
    },
    {
      title: 'Daily Finance AM Check',
      formGroup: 'Young Person Finance AM Check',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Morning finance balance and receipt checks.',
    },
    {
      title: 'Daily Finance PM Check',
      formGroup: 'Young Person Finance PM Check',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Evening finance reconciliation check.',
    },
    {
      title: 'Vehicle Safety Spot-check',
      formGroup: 'Weekly vehicle check',
      personId: null,
      assigneeId: northEmployee.id,
      details: 'Vehicle safety and readiness spot-check.',
    },
    {
      title: 'Incident Documentation QA',
      formGroup: 'Incident Record Quality Assurance',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Review incident logs for completeness.',
    },
  ];

  const dueNextTomorrowTasks: ScheduledSeedTask[] = [
    {
      title: 'Daily Cleaning Compliance',
      formGroup: 'Daily Cleaning Schedule',
      personId: null,
      assigneeId: southEmployee.id,
      details: 'Compliance check for shared-area cleaning.',
    },
    {
      title: 'Nutrition Plan Check-in',
      formGroup: 'Weekly Menu',
      personId: ypNorth.id,
      assigneeId: northEmployee.id,
      details: 'Nutrition plan check-in and shopping updates.',
    },
    {
      title: 'Young Person Goal Review',
      formGroup: 'Young Person(s) Meeting',
      personId: ypSouth.id,
      assigneeId: southEmployee.id,
      details: 'Goal review and target-setting support.',
    },
    {
      title: 'Room Safety Walkthrough',
      formGroup: 'Room Safety',
      personId: null,
      assigneeId: northEmployee.id,
      details: 'Room-by-room safety walkthrough.',
    },
    {
      title: 'Education Attendance Follow-up',
      formGroup: 'Education/Work',
      personId: ypNorth.id,
      assigneeId: southEmployee.id,
      details: 'Follow-up on attendance and support actions.',
    },
    {
      title: 'Behaviour Support Notes',
      formGroup: 'Behaviour Support',
      personId: ypSouth.id,
      assigneeId: northEmployee.id,
      details: 'Complete behaviour support implementation notes.',
    },
    {
      title: 'Hygiene Support Record',
      formGroup: 'Personal Care',
      personId: ypNorth.id,
      assigneeId: southEmployee.id,
      details: 'Complete hygiene and personal care records.',
    },
    {
      title: 'Family Contact Outcome Notes',
      formGroup: 'Contact Log',
      personId: ypSouth.id,
      assigneeId: northEmployee.id,
      details: 'Record outcomes from recent family contact.',
    },
    {
      title: 'Daily Engagement Tracker',
      formGroup: 'Activity',
      personId: ypNorth.id,
      assigneeId: southEmployee.id,
      details: 'Track engagement and wellbeing indicators.',
    },
    {
      title: 'End-of-day Summary',
      formGroup: 'Daily Summary',
      personId: ypSouth.id,
      assigneeId: northEmployee.id,
      details: 'Complete end-of-day summary and handover notes.',
    },
  ];

  pushScheduledBatch(0, 'Due today', dueTodayTasks);
  pushScheduledBatch(1, 'Due tomorrow', dueTomorrowTasks);
  pushScheduledBatch(2, 'Due next tomorrow', dueNextTomorrowTasks);

  // Pending approval = 13 across mixed form types with dynamic payloads for list + detail drill-down.
  const pendingApprovalSeeds: Array<{
    title: string;
    formName: string;
    details: string;
    dueDate: Date;
    createdAt: Date;
    submittedAt: Date;
    updatedAt: Date;
    submittedById: string;
    updatedById: string;
    priority: TaskPriority;
    assigneeId: string;
    youngPersonId: string | null;
    payload: Prisma.InputJsonValue;
  }> = [
    {
      title: 'Weekly Menu - 21/03/2026',
      formName: 'Weekly Menu',
      details: 'Weekly menu entry submitted for manager approval.',
      dueDate: atDay(now, 0, 9, 16),
      createdAt: atDay(now, -1, 16, 18),
      submittedAt: atDay(now, 0, 16, 18),
      updatedAt: atDay(now, 0, 16, 18),
      submittedById: staffNorthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.high,
      assigneeId: northEmployee.id,
      youngPersonId: ypNorth.id,
      payload: buildWeeklyMenuPayload(),
    },
    {
      title: 'Daily Cleaning Schedule - 21/03/2026',
      formName: 'Daily Cleaning Schedule',
      details: 'Daily cleaning checklist submitted for review.',
      dueDate: atDay(now, 0, 8, 31),
      createdAt: atDay(now, -1, 12, 23),
      submittedAt: atDay(now, 0, 12, 23),
      updatedAt: atDay(now, 0, 12, 23),
      submittedById: staffSouthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.high,
      assigneeId: southEmployee.id,
      youngPersonId: null,
      payload: buildDailyCleaningPayload(),
    },
    {
      title: 'Young Person Finance Check PM 21/03/2026',
      formName: 'Young Person Finance PM Check',
      details: 'PM finance entry waiting for approval.',
      dueDate: atDay(now, 0, 18, 10),
      createdAt: atDay(now, -1, 10, 45),
      submittedAt: atDay(now, 0, 10, 45),
      updatedAt: atDay(now, 0, 12, 5),
      submittedById: staffNorthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.high,
      assigneeId: northEmployee.id,
      youngPersonId: ypSouth.id,
      payload: buildFinanceCheckPayload('PM'),
    },
    {
      title: 'Young Person Finance Check AM 21/03/2026',
      formName: 'Young Person Finance AM Check',
      details: 'AM finance entry waiting for approval.',
      dueDate: atDay(now, 0, 8, 5),
      createdAt: atDay(now, -1, 10, 15),
      submittedAt: atDay(now, 0, 10, 15),
      updatedAt: atDay(now, 0, 11, 50),
      submittedById: staffSouthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.high,
      assigneeId: southEmployee.id,
      youngPersonId: ypNorth.id,
      payload: buildFinanceCheckPayload('AM'),
    },
    {
      title: 'Daily Ligature Check 21/03/2026',
      formName: 'Daily Ligature Check',
      details: 'Ligature safety check submitted for approval.',
      dueDate: atDay(now, 0, 8, 18),
      createdAt: atDay(now, -1, 11, 2),
      submittedAt: atDay(now, 0, 11, 2),
      updatedAt: atDay(now, 0, 11, 30),
      submittedById: staffNorthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.high,
      assigneeId: northEmployee.id,
      youngPersonId: null,
      payload: buildLigaturePayload(),
    },
    {
      title: 'Contact Form - Supervised by social worker',
      formName: 'Contact Form',
      details: 'Contact log submitted and awaiting approval.',
      dueDate: atDay(now, -2, 11, 20),
      createdAt: atDay(now, -2, 10, 5),
      submittedAt: atDay(now, -2, 10, 10),
      updatedAt: atDay(now, 0, 9, 45),
      submittedById: staffSouthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.medium,
      assigneeId: southEmployee.id,
      youngPersonId: ypNorth.id,
      payload: buildContactFormPayload(),
    },
    {
      title: 'Waking Night Summary - 20/03/2026',
      formName: 'Waking Night Summary',
      details: 'Night summary submitted for manager review.',
      dueDate: atDay(now, -1, 6, 30),
      createdAt: atDay(now, -1, 7, 10),
      submittedAt: atDay(now, -1, 7, 30),
      updatedAt: atDay(now, 0, 10, 40),
      submittedById: staffNorthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.medium,
      assigneeId: northEmployee.id,
      youngPersonId: ypSouth.id,
      payload: buildGenericPendingPayload(
        'Waking Night Summary',
        'Night observations recorded. No incidents requiring escalation.',
      ),
    },
    {
      title: 'Daily AM sharps check 21/03/2026',
      formName: 'Daily AM sharps check',
      details: 'AM sharps checklist submitted for sign-off.',
      dueDate: atDay(now, 0, 9, 0),
      createdAt: atDay(now, -1, 8, 45),
      submittedAt: atDay(now, 0, 8, 50),
      updatedAt: atDay(now, 0, 10, 5),
      submittedById: staffSouthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.medium,
      assigneeId: southEmployee.id,
      youngPersonId: null,
      payload: buildGenericPendingPayload(
        'Daily AM sharps check',
        'Sharps in designated locations checked and verified as secure.',
      ),
    },
    {
      title: 'Keyworker Session 20/03/2026',
      formName: 'Keyworker Session',
      details: 'Keyworker session entry awaiting approval.',
      dueDate: atDay(now, -1, 15, 30),
      createdAt: atDay(now, -1, 15, 40),
      submittedAt: atDay(now, -1, 15, 41),
      updatedAt: atDay(now, 0, 9, 5),
      submittedById: staffNorthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.medium,
      assigneeId: northEmployee.id,
      youngPersonId: ypSouth.id,
      payload: buildGenericPendingPayload(
        'Keyworker Session',
        'Discussed school anxiety triggers and agreed calming routine.',
      ),
    },
    {
      title: 'Weekly Coshh Check 15/03/2026',
      formName: 'Weekly Coshh Check',
      details: 'COSHH check submitted and awaiting review.',
      dueDate: atDay(now, -6, 10, 0),
      createdAt: atDay(now, -6, 10, 10),
      submittedAt: atDay(now, -6, 10, 20),
      updatedAt: atDay(now, 0, 8, 20),
      submittedById: staffSouthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.medium,
      assigneeId: southEmployee.id,
      youngPersonId: null,
      payload: buildGenericPendingPayload(
        'Weekly Coshh Check',
        'All cleaning agents accounted for and safely locked.',
      ),
    },
    {
      title: 'End Of Shift Handover Validation',
      formName: 'End Of Shift Handover Validation',
      details: 'Shift handover validation submitted for review.',
      dueDate: atDay(now, 1, 9, 30),
      createdAt: atDay(now, -1, 21, 0),
      submittedAt: atDay(now, -1, 21, 5),
      updatedAt: atDay(now, 0, 13, 0),
      submittedById: staffNorthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.medium,
      assigneeId: northEmployee.id,
      youngPersonId: null,
      payload: buildGenericPendingPayload(
        'End Of Shift Handover Validation',
        'Handover confirmed complete with risk and medication updates.',
      ),
    },
    {
      title: 'Support Plan Amendment Review',
      formName: 'Support Plan Amendment Review',
      details: 'Support plan amendment submitted for approval.',
      dueDate: atDay(now, 2, 14, 0),
      createdAt: atDay(now, -1, 17, 20),
      submittedAt: atDay(now, -1, 17, 25),
      updatedAt: atDay(now, 0, 14, 5),
      submittedById: staffSouthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.high,
      assigneeId: southEmployee.id,
      youngPersonId: ypNorth.id,
      payload: buildGenericPendingPayload(
        'Support Plan Amendment Review',
        'Updated evening routine and de-escalation prompts submitted.',
      ),
    },
    {
      title: 'Daily Room Check Sign-off',
      formName: 'Daily Room Check Sign-off',
      details: 'Room checks completed and submitted for approval.',
      dueDate: atDay(now, 3, 10, 45),
      createdAt: atDay(now, -1, 19, 10),
      submittedAt: atDay(now, -1, 19, 20),
      updatedAt: atDay(now, 0, 15, 30),
      submittedById: staffNorthUser.id,
      updatedById: managerUser.id,
      priority: TaskPriority.medium,
      assigneeId: northEmployee.id,
      youngPersonId: ypSouth.id,
      payload: buildGenericPendingPayload(
        'Daily Room Check Sign-off',
        'Bedrooms and common areas inspected; no hazards identified.',
      ),
    },
  ];

  pendingApprovalSeeds.forEach((task) => {
    pushTask({
      title: task.title,
      details: task.details,
      formName: task.formName,
      formGroup: task.formName,
      submissionPayload: withSampleReferenceLinks(task.payload, task.formName),
      dueDate: task.dueDate,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      submittedAt: task.submittedAt,
      submittedById: task.submittedById,
      updatedById: task.updatedById,
      createdById: adminUser.id,
      approvalStatus: TaskApprovalStatus.pending_approval,
      priority: task.priority,
      assigneeId: task.assigneeId,
      youngPersonId: task.youngPersonId,
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
  console.log(`Form templates upserted: ${seedFormTemplates.length}.`);
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
