import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { assertUploadedFilesBelongToTenant } from '../uploads/uploads.service.js';
import type { CreateHomeBody, ListHomesQuery, UpdateHomeBody } from './homes.schema.js';

type HomeRow = Prisma.HomeGetPayload<{
  include: {
    careGroup: { select: { id: true; name: true } };
    admin: { select: { id: true; firstName: true; lastName: true } };
    personInCharge: { select: { id: true; firstName: true; lastName: true } };
    responsibleIndividual: { select: { id: true; firstName: true; lastName: true } };
    _count: { select: { employees: true; youngPeople: true; vehicles: true; tasks: true } };
  };
}>;

const HOME_INCLUDE = {
  careGroup: { select: { id: true, name: true } },
  admin: { select: { id: true, firstName: true, lastName: true } },
  personInCharge: { select: { id: true, firstName: true, lastName: true } },
  responsibleIndividual: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { employees: true, youngPeople: true, vehicles: true, tasks: true } },
} as const;

function userName(user: { firstName: string; lastName: string } | null | undefined): string | null {
  if (!user) return null;
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || null;
}

function mapHome(home: HomeRow) {
  return {
    id: home.id,
    careGroupId: home.careGroupId,
    careGroupName: home.careGroup?.name ?? null,
    name: home.name,
    description: home.description,
    address: home.address,
    postCode: home.postCode,
    capacity: home.capacity,
    category: home.category,
    region: home.region,
    status: home.status,
    phoneNumber: home.phoneNumber,
    email: home.email,
    avatarFileId: home.avatarFileId,
    avatarUrl: home.avatarUrl,
    admin: home.admin ? { id: home.admin.id, name: userName(home.admin) } : null,
    personInCharge: home.personInCharge ? { id: home.personInCharge.id, name: userName(home.personInCharge) } : null,
    responsibleIndividual: home.responsibleIndividual ? { id: home.responsibleIndividual.id, name: userName(home.responsibleIndividual) } : null,
    startDate: home.startDate,
    endDate: home.endDate,
    isSecure: home.isSecure,
    shortTermStays: home.shortTermStays,
    minAgeGroup: home.minAgeGroup,
    maxAgeGroup: home.maxAgeGroup,
    ofstedUrn: home.ofstedUrn,
    compliance: home.compliance,
    details: home.details,
    counts: {
      employees: home._count.employees,
      youngPeople: home._count.youngPeople,
      vehicles: home._count.vehicles,
      tasks: home._count.tasks,
    },
    isActive: home.isActive,
    createdAt: home.createdAt,
    updatedAt: home.updatedAt,
  };
}

async function ensureCareGroupExists(careGroupId: string, tenantId: string) {
  const exists = await prisma.careGroup.findFirst({
    where: { id: careGroupId, tenantId },
    select: { id: true },
  });
  if (!exists) {
    throw httpError(404, 'CARE_GROUP_NOT_FOUND', 'Care group not found.');
  }
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listHomes(actorId: string, query: ListHomesQuery) {
  const tenant = await requireTenantContext(actorId);
  const skip = (query.page - 1) * query.pageSize;
  const where: Prisma.HomeWhereInput = {
    tenantId: tenant.tenantId,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { address: { contains: query.search, mode: 'insensitive' } },
            { postCode: { contains: query.search, mode: 'insensitive' } },
            { category: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.careGroupId ? { careGroupId: query.careGroupId } : {}),
    ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.home.count({ where }),
    prisma.home.findMany({
      where,
      include: HOME_INCLUDE,
      orderBy: { name: 'asc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  await logSensitiveReadAccess({
    actorUserId: actorId,
    tenantId: tenant.tenantId,
    entityType: 'home',
    source: 'homes.list',
    scope: 'list',
    resultCount: rows.length,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      careGroupId: query.careGroupId ?? null,
      status: query.status ?? null,
      hasSearch: Boolean(query.search),
      isActive: query.isActive ?? null,
    },
  });

  return {
    data: rows.map(mapHome),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

// ─── Get ─────────────────────────────────────────────────────────────────────

export async function getHome(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: HOME_INCLUDE,
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }

  await logSensitiveReadAccess({
    actorUserId: actorId,
    tenantId: tenant.tenantId,
    entityType: 'home',
    entityId: id,
    source: 'homes.get',
    scope: 'detail',
    resultCount: 1,
  });

  return mapHome(home);
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createHome(actorId: string, body: CreateHomeBody) {
  const tenant = await requireTenantContext(actorId);
  await ensureCareGroupExists(body.careGroupId, tenant.tenantId);
  if (body.avatarFileId) {
    await assertUploadedFilesBelongToTenant(tenant.tenantId, [body.avatarFileId]);
  }

  const home = await prisma.home.create({
    data: {
      tenantId: tenant.tenantId,
      careGroupId: body.careGroupId,
      name: body.name,
      description: body.description ?? null,
      address: body.address ?? null,
      postCode: body.postCode ?? null,
      capacity: body.capacity ?? null,
      category: body.category ?? null,
      region: body.region ?? null,
      status: body.status ?? 'current',
      phoneNumber: body.phoneNumber ?? null,
      email: body.email ?? null,
      avatarUrl: body.avatarUrl ?? null,
      ...(body.avatarFileId ? { avatarFileId: body.avatarFileId } : {}),
      ...(body.adminUserId ? { adminUserId: body.adminUserId } : {}),
      ...(body.personInChargeId ? { personInChargeId: body.personInChargeId } : {}),
      ...(body.responsibleIndividualId ? { responsibleIndividualId: body.responsibleIndividualId } : {}),
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      isSecure: body.isSecure ?? false,
      shortTermStays: body.shortTermStays ?? false,
      minAgeGroup: body.minAgeGroup ?? null,
      maxAgeGroup: body.maxAgeGroup ?? null,
      ofstedUrn: body.ofstedUrn ?? null,
      compliance: (body.compliance ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
      details: (body.details ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
    },
    include: HOME_INCLUDE,
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_created,
      entityType: 'home',
      entityId: home.id,
    },
  });

  return mapHome(home);
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateHome(actorId: string, id: string, body: UpdateHomeBody) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.home.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }

  if (body.careGroupId !== undefined) {
    await ensureCareGroupExists(body.careGroupId, tenant.tenantId);
  }
  if (body.avatarFileId) {
    await assertUploadedFilesBelongToTenant(tenant.tenantId, [body.avatarFileId]);
  }

  const updateData: Prisma.HomeUpdateInput = {};

  // Core fields
  if (body.careGroupId !== undefined) updateData.careGroup = { connect: { id: body.careGroupId } };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.postCode !== undefined) updateData.postCode = body.postCode;
  if (body.capacity !== undefined) updateData.capacity = body.capacity;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.region !== undefined) updateData.region = body.region;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.phoneNumber !== undefined) updateData.phoneNumber = body.phoneNumber;
  if (body.email !== undefined) updateData.email = body.email;

  // Avatar
  if (body.avatarFileId !== undefined) {
    updateData.avatarFile = body.avatarFileId === null
      ? { disconnect: true }
      : { connect: { id: body.avatarFileId } };
  }
  if (body.avatarUrl !== undefined) updateData.avatarUrl = body.avatarUrl;

  // People
  if (body.adminUserId !== undefined) {
    updateData.admin = body.adminUserId === null ? { disconnect: true } : { connect: { id: body.adminUserId } };
  }
  if (body.personInChargeId !== undefined) {
    updateData.personInCharge = body.personInChargeId === null ? { disconnect: true } : { connect: { id: body.personInChargeId } };
  }
  if (body.responsibleIndividualId !== undefined) {
    updateData.responsibleIndividual = body.responsibleIndividualId === null ? { disconnect: true } : { connect: { id: body.responsibleIndividualId } };
  }

  // Dates & compliance
  if (body.startDate !== undefined) updateData.startDate = body.startDate;
  if (body.endDate !== undefined) updateData.endDate = body.endDate;
  if (body.isSecure !== undefined) updateData.isSecure = body.isSecure;
  if (body.shortTermStays !== undefined) updateData.shortTermStays = body.shortTermStays;
  if (body.minAgeGroup !== undefined) updateData.minAgeGroup = body.minAgeGroup;
  if (body.maxAgeGroup !== undefined) updateData.maxAgeGroup = body.maxAgeGroup;
  if (body.ofstedUrn !== undefined) updateData.ofstedUrn = body.ofstedUrn;
  if (body.compliance !== undefined) {
    updateData.compliance = (body.compliance ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  }
  if (body.details !== undefined) {
    updateData.details = (body.details ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  }
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const updated = await prisma.home.update({
    where: { id },
    data: updateData,
    include: HOME_INCLUDE,
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_updated,
      entityType: 'home',
      entityId: id,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapHome(updated);
}

// ─── Home Events ─────────────────────────────────────────────────────────────

export async function listHomeEvents(actorId: string, homeId: string, query: { page: number; pageSize: number }) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const skip = (query.page - 1) * query.pageSize;
  const where = { tenantId: tenant.tenantId, homeId };

  const [total, rows] = await Promise.all([
    prisma.homeEvent.count({ where }),
    prisma.homeEvent.findMany({ where, orderBy: { startsAt: 'desc' }, skip, take: query.pageSize }),
  ]);

  return { data: rows, meta: { total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } };
}

export async function createHomeEvent(actorId: string, homeId: string, body: { title: string; description?: string; startsAt: string; endsAt?: string }) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const event = await prisma.homeEvent.create({
    data: {
      tenantId: tenant.tenantId,
      homeId,
      title: body.title,
      description: body.description ?? null,
      startsAt: new Date(body.startsAt),
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
    },
  });

  await prisma.auditLog.create({ data: { tenantId: tenant.tenantId, userId: actorId, action: AuditAction.record_created, entityType: 'home_event', entityId: event.id } });
  return event;
}

export async function updateHomeEvent(actorId: string, homeId: string, eventId: string, body: { title?: string; description?: string | null; startsAt?: string; endsAt?: string | null }) {
  const tenant = await requireTenantContext(actorId);
  const event = await prisma.homeEvent.findFirst({ where: { id: eventId, homeId, tenantId: tenant.tenantId } });
  if (!event) throw httpError(404, 'EVENT_NOT_FOUND', 'Event not found.');

  const updateData: Prisma.HomeEventUpdateInput = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.startsAt !== undefined) updateData.startsAt = new Date(body.startsAt);
  if (body.endsAt !== undefined) updateData.endsAt = body.endsAt ? new Date(body.endsAt) : null;

  const updated = await prisma.homeEvent.update({ where: { id: eventId }, data: updateData });
  await prisma.auditLog.create({ data: { tenantId: tenant.tenantId, userId: actorId, action: AuditAction.record_updated, entityType: 'home_event', entityId: eventId, metadata: { fields: Object.keys(body) } } });
  return updated;
}

export async function deleteHomeEvent(actorId: string, homeId: string, eventId: string) {
  const tenant = await requireTenantContext(actorId);
  const event = await prisma.homeEvent.findFirst({ where: { id: eventId, homeId, tenantId: tenant.tenantId } });
  if (!event) throw httpError(404, 'EVENT_NOT_FOUND', 'Event not found.');

  await prisma.homeEvent.delete({ where: { id: eventId } });
  await prisma.auditLog.create({ data: { tenantId: tenant.tenantId, userId: actorId, action: AuditAction.record_deleted, entityType: 'home_event', entityId: eventId } });
  return { message: 'Event deleted.' };
}

// ─── Employee Shifts ─────────────────────────────────────────────────────────

export async function listHomeShifts(actorId: string, homeId: string, query: { page: number; pageSize: number }) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const skip = (query.page - 1) * query.pageSize;
  const where = { tenantId: tenant.tenantId, homeId };

  const [total, rows] = await Promise.all([
    prisma.employeeShift.count({ where }),
    prisma.employeeShift.findMany({
      where,
      include: { employee: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { startTime: 'desc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  const data = rows.map((s) => ({
    id: s.id,
    homeId: s.homeId,
    employeeId: s.employeeId,
    employeeName: `${s.employee.user.firstName ?? ''} ${s.employee.user.lastName ?? ''}`.trim(),
    startTime: s.startTime,
    endTime: s.endTime,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  return { data, meta: { total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } };
}

export async function createHomeShift(actorId: string, homeId: string, body: { employeeId: string; startTime: string; endTime: string }) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const shift = await prisma.employeeShift.create({
    data: {
      tenantId: tenant.tenantId,
      homeId,
      employeeId: body.employeeId,
      startTime: new Date(body.startTime),
      endTime: new Date(body.endTime),
    },
    include: { employee: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } },
  });

  await prisma.auditLog.create({ data: { tenantId: tenant.tenantId, userId: actorId, action: AuditAction.record_created, entityType: 'employee_shift', entityId: shift.id } });

  return {
    id: shift.id,
    homeId: shift.homeId,
    employeeId: shift.employeeId,
    employeeName: `${shift.employee.user.firstName ?? ''} ${shift.employee.user.lastName ?? ''}`.trim(),
    startTime: shift.startTime,
    endTime: shift.endTime,
    createdAt: shift.createdAt,
    updatedAt: shift.updatedAt,
  };
}

export async function updateHomeShift(actorId: string, homeId: string, shiftId: string, body: { employeeId?: string; startTime?: string; endTime?: string }) {
  const tenant = await requireTenantContext(actorId);
  const shift = await prisma.employeeShift.findFirst({ where: { id: shiftId, homeId, tenantId: tenant.tenantId } });
  if (!shift) throw httpError(404, 'SHIFT_NOT_FOUND', 'Shift not found.');

  const updateData: Prisma.EmployeeShiftUpdateInput = {};
  if (body.employeeId !== undefined) updateData.employee = { connect: { id: body.employeeId } };
  if (body.startTime !== undefined) updateData.startTime = new Date(body.startTime);
  if (body.endTime !== undefined) updateData.endTime = new Date(body.endTime);

  const updated = await prisma.employeeShift.update({
    where: { id: shiftId },
    data: updateData,
    include: { employee: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } },
  });

  await prisma.auditLog.create({ data: { tenantId: tenant.tenantId, userId: actorId, action: AuditAction.record_updated, entityType: 'employee_shift', entityId: shiftId, metadata: { fields: Object.keys(body) } } });

  return {
    id: updated.id,
    homeId: updated.homeId,
    employeeId: updated.employeeId,
    employeeName: `${updated.employee.user.firstName ?? ''} ${updated.employee.user.lastName ?? ''}`.trim(),
    startTime: updated.startTime,
    endTime: updated.endTime,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

export async function deleteHomeShift(actorId: string, homeId: string, shiftId: string) {
  const tenant = await requireTenantContext(actorId);
  const shift = await prisma.employeeShift.findFirst({ where: { id: shiftId, homeId, tenantId: tenant.tenantId } });
  if (!shift) throw httpError(404, 'SHIFT_NOT_FOUND', 'Shift not found.');

  await prisma.employeeShift.delete({ where: { id: shiftId } });
  await prisma.auditLog.create({ data: { tenantId: tenant.tenantId, userId: actorId, action: AuditAction.record_deleted, entityType: 'employee_shift', entityId: shiftId } });
  return { message: 'Shift deleted.' };
}

// ─── Home Summary (aggregated detail) ────────────────────────────────────────

export async function getHomeSummary(actorId: string, homeId: string) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({
    where: { id: homeId, tenantId: tenant.tenantId },
    include: {
      ...HOME_INCLUDE,
      youngPeople: { where: { isActive: true }, select: { id: true, firstName: true, lastName: true, status: true, type: true, roomNumber: true }, orderBy: { lastName: 'asc' } },
      employees: { where: { isActive: true }, include: { user: { select: { firstName: true, lastName: true } }, role: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      vehicles: { where: { isActive: true }, select: { id: true, registration: true, make: true, model: true, status: true }, orderBy: { registration: 'asc' } },
      events: { where: { startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' }, take: 10 },
      shifts: {
        where: { startTime: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
        include: { employee: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { startTime: 'asc' },
        take: 20,
      },
    },
  });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const taskStats = await prisma.task.groupBy({
    by: ['status'],
    where: { tenantId: tenant.tenantId, homeId, deletedAt: null },
    _count: true,
  });

  const mapped = mapHome(home);

  return {
    ...mapped,
    youngPeople: home.youngPeople,
    employees: home.employees.map((e) => ({
      id: e.id,
      name: `${e.user.firstName} ${e.user.lastName}`.trim(),
      jobTitle: e.jobTitle,
      roleName: e.role?.name ?? null,
      status: e.status,
    })),
    vehicles: home.vehicles,
    upcomingEvents: home.events,
    todayShifts: home.shifts.map((s) => ({
      id: s.id,
      employeeName: `${s.employee.user.firstName} ${s.employee.user.lastName}`.trim(),
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    taskStats: Object.fromEntries(taskStats.map((s) => [s.status, s._count])),
  };
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function getHomeDailyAudit(actorId: string, homeId: string, date: string) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true, name: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const [tasks, dailyLogs, events, shifts] = await Promise.all([
    prisma.task.findMany({
      where: { tenantId: tenant.tenantId, homeId, deletedAt: null, createdAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true, title: true, category: true, status: true, priority: true, createdAt: true, createdById: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.task.findMany({
      where: { tenantId: tenant.tenantId, homeId, category: 'daily_log', deletedAt: null, submittedAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true, title: true, description: true, submittedAt: true, createdById: true },
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.homeEvent.findMany({
      where: { tenantId: tenant.tenantId, homeId, startsAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.employeeShift.findMany({
      where: { tenantId: tenant.tenantId, homeId, startTime: { gte: dayStart, lte: dayEnd } },
      include: { employee: { select: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { startTime: 'asc' },
    }),
  ]);

  return {
    home: { id: home.id, name: home.name },
    date,
    tasks,
    dailyLogs,
    events,
    shifts: shifts.map((s) => ({
      id: s.id,
      employeeName: `${s.employee.user.firstName} ${s.employee.user.lastName}`.trim(),
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    summary: {
      totalTasks: tasks.length,
      totalDailyLogs: dailyLogs.length,
      totalEvents: events.length,
      totalShifts: shifts.length,
    },
  };
}

export async function getHomeEmployeeStats(actorId: string, homeId: string) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true, name: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const employees = await prisma.employee.findMany({
    where: { tenantId: tenant.tenantId, homeId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      role: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return {
    home: { id: home.id, name: home.name },
    employees: employees.map((e) => ({
      id: e.id,
      name: `${e.user.firstName} ${e.user.lastName}`.trim(),
      email: e.user.email,
      jobTitle: e.jobTitle,
      roleName: e.role?.name ?? null,
      status: e.status,
      contractType: e.contractType,
      startDate: e.startDate,
      endDate: e.endDate,
      dbsNumber: e.dbsNumber,
      dbsDate: e.dbsDate,
      qualifications: e.qualifications,
      isActive: e.isActive,
    })),
    summary: {
      total: employees.length,
      active: employees.filter((e) => e.isActive).length,
      current: employees.filter((e) => e.status === 'current').length,
    },
  };
}

export async function getHomeStatistics(actorId: string, homeId: string) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true, name: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalTasks, tasksByCategory, tasksByStatus,
    totalDailyLogs, recentDailyLogs,
    totalYoungPeople, totalEmployees, totalVehicles,
    upcomingEvents,
  ] = await Promise.all([
    prisma.task.count({ where: { tenantId: tenant.tenantId, homeId, deletedAt: null } }),
    prisma.task.groupBy({ by: ['category'], where: { tenantId: tenant.tenantId, homeId, deletedAt: null }, _count: true }),
    prisma.task.groupBy({ by: ['status'], where: { tenantId: tenant.tenantId, homeId, deletedAt: null }, _count: true }),
    prisma.task.count({ where: { tenantId: tenant.tenantId, homeId, category: 'daily_log', deletedAt: null } }),
    prisma.task.count({ where: { tenantId: tenant.tenantId, homeId, category: 'daily_log', deletedAt: null, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.youngPerson.count({ where: { tenantId: tenant.tenantId, homeId, isActive: true } }),
    prisma.employee.count({ where: { tenantId: tenant.tenantId, homeId, isActive: true } }),
    prisma.vehicle.count({ where: { tenantId: tenant.tenantId, homeId, isActive: true } }),
    prisma.homeEvent.count({ where: { tenantId: tenant.tenantId, homeId, startsAt: { gte: now } } }),
  ]);

  return {
    home: { id: home.id, name: home.name },
    tasks: {
      total: totalTasks,
      byCategory: Object.fromEntries(tasksByCategory.map((c) => [c.category, c._count])),
      byStatus: Object.fromEntries(tasksByStatus.map((s) => [s.status, s._count])),
    },
    dailyLogs: { total: totalDailyLogs, last30Days: recentDailyLogs },
    residents: totalYoungPeople,
    staff: totalEmployees,
    vehicles: totalVehicles,
    upcomingEvents,
  };
}

// ─── Access Report ───────────────────────────────────────────────────────────

export async function getHomeAccessReport(actorId: string, homeId: string, query: { page: number; pageSize: number }) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true, name: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const skip = (query.page - 1) * query.pageSize;
  const where = {
    tenantId: tenant.tenantId,
    entityType: { in: ['task', 'daily_log', 'home'] },
    OR: [
      { entityId: homeId },
      { metadata: { path: ['homeId'], equals: homeId } },
    ],
    action: AuditAction.record_accessed,
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  return {
    home: { id: home.id, name: home.name },
    data: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      user: r.user ? { id: r.user.id, name: `${r.user.firstName} ${r.user.lastName}`.trim(), email: r.user.email } : null,
      metadata: r.metadata,
      accessedAt: r.createdAt,
    })),
    meta: { total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
  };
}

// ─── Weekly / Monthly Record Reports ─────────────────────────────────────────

export async function getHomePeriodRecord(actorId: string, homeId: string, startDate: string, endDate: string) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true, name: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const from = new Date(startDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(endDate);
  to.setHours(23, 59, 59, 999);

  const [tasks, dailyLogs, events, shifts] = await Promise.all([
    prisma.task.findMany({
      where: { tenantId: tenant.tenantId, homeId, deletedAt: null, createdAt: { gte: from, lte: to } },
      select: { id: true, title: true, category: true, status: true, priority: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.task.findMany({
      where: { tenantId: tenant.tenantId, homeId, category: 'daily_log', deletedAt: null, submittedAt: { gte: from, lte: to } },
      select: { id: true, title: true, description: true, submittedAt: true, createdById: true },
      orderBy: { submittedAt: 'asc' },
    }),
    prisma.homeEvent.findMany({
      where: { tenantId: tenant.tenantId, homeId, startsAt: { gte: from, lte: to } },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.employeeShift.findMany({
      where: { tenantId: tenant.tenantId, homeId, startTime: { gte: from, lte: to } },
      include: { employee: { select: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { startTime: 'asc' },
    }),
  ]);

  const tasksByStatus: Record<string, number> = {};
  for (const t of tasks) { tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1; }

  const tasksByCategory: Record<string, number> = {};
  for (const t of tasks) { tasksByCategory[t.category] = (tasksByCategory[t.category] ?? 0) + 1; }

  return {
    home: { id: home.id, name: home.name },
    period: { from: startDate, to: endDate },
    tasks,
    dailyLogs,
    events,
    shifts: shifts.map((s) => ({
      id: s.id,
      employeeName: `${s.employee.user.firstName} ${s.employee.user.lastName}`.trim(),
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    summary: {
      totalTasks: tasks.length,
      tasksByStatus,
      tasksByCategory,
      totalDailyLogs: dailyLogs.length,
      totalEvents: events.length,
      totalShifts: shifts.length,
    },
  };
}

// ─── Home Sub-Resource Lists ─────────────────────────────────────────────────

export async function listHomeYoungPeople(actorId: string, homeId: string, query: { page: number; pageSize: number }) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const skip = (query.page - 1) * query.pageSize;
  const where = { tenantId: tenant.tenantId, homeId, isActive: true };
  const [total, rows] = await Promise.all([
    prisma.youngPerson.count({ where }),
    prisma.youngPerson.findMany({ where, orderBy: { lastName: 'asc' }, skip, take: query.pageSize }),
  ]);

  return { data: rows, meta: { total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } };
}

export async function listHomeEmployees(actorId: string, homeId: string, query: { page: number; pageSize: number }) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const skip = (query.page - 1) * query.pageSize;
  const where = { tenantId: tenant.tenantId, homeId, isActive: true };
  const [total, rows] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      include: { user: { select: { firstName: true, lastName: true, email: true } }, role: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  return {
    data: rows.map((e) => ({ id: e.id, name: `${e.user.firstName} ${e.user.lastName}`.trim(), email: e.user.email, jobTitle: e.jobTitle, roleName: e.role?.name ?? null, status: e.status })),
    meta: { total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
  };
}

export async function listHomeVehicles(actorId: string, homeId: string, query: { page: number; pageSize: number }) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const skip = (query.page - 1) * query.pageSize;
  const where = { tenantId: tenant.tenantId, homeId, isActive: true };
  const [total, rows] = await Promise.all([
    prisma.vehicle.count({ where }),
    prisma.vehicle.findMany({ where, orderBy: { registration: 'asc' }, skip, take: query.pageSize }),
  ]);

  return { data: rows, meta: { total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } };
}

export async function listHomeTasks(actorId: string, homeId: string, query: { page: number; pageSize: number }) {
  const tenant = await requireTenantContext(actorId);
  const home = await prisma.home.findFirst({ where: { id: homeId, tenantId: tenant.tenantId }, select: { id: true } });
  if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');

  const skip = (query.page - 1) * query.pageSize;
  const where = { tenantId: tenant.tenantId, homeId, deletedAt: null };
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      select: { id: true, title: true, category: true, status: true, priority: true, dueDate: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  return { data: rows, meta: { total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } };
}

// ─── Deactivate ──────────────────────────────────────────────────────────────

export async function deactivateHome(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.home.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }

  await prisma.home.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_deleted,
      entityType: 'home',
      entityId: id,
      metadata: { softDelete: true },
    },
  });

  return { message: 'Home deactivated.' };
}
