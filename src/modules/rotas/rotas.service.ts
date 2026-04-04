import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type {
  CreateRotaBody,
  CreateRotaTemplateBody,
  ListRotaTemplatesQuery,
  ListRotasQuery,
  RotaShiftInput,
  UpdateRotaBody,
} from './rotas.schema.js';

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function normalizeShift(shift: RotaShiftInput) {
  return {
    employeeId: shift.employeeId,
    dayOfWeek: shift.dayOfWeek,
    startTime: shift.startTime,
    endTime: shift.endTime,
    role: shift.role,
  };
}

function normalizeShifts(shifts: RotaShiftInput[]) {
  return shifts.map(normalizeShift);
}

function extractEmployeeIdsFromShifts(shifts: RotaShiftInput[]) {
  return [...new Set(shifts.map((shift) => shift.employeeId))];
}

function parseShifts(raw: Prisma.JsonValue | null): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => typeof item === 'object' && item !== null) as Record<string, unknown>[];
}

async function ensureHomeInTenant(tenantId: string, homeId: string) {
  const home = await prisma.home.findFirst({
    where: { id: homeId, tenantId },
    select: { id: true },
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }
}

async function ensureEmployeesInTenant(tenantId: string, employeeIds: string[]) {
  if (employeeIds.length === 0) return;

  const rows = await prisma.employee.findMany({
    where: { tenantId, id: { in: employeeIds }, isActive: true },
    select: { id: true },
  });
  if (rows.length !== employeeIds.length) {
    throw httpError(404, 'EMPLOYEE_NOT_FOUND', 'One or more employees were not found in this tenant.');
  }
}

function mapRota(
  row: Prisma.RotaGetPayload<{
    include: { home: { select: { id: true; name: true } } };
  }>,
) {
  return {
    id: row.id,
    homeId: row.homeId,
    homeName: row.home.name,
    weekStarting: row.weekStarting,
    shifts: parseShifts(row.shifts),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRotaTemplate(
  row: Prisma.RotaTemplateGetPayload<{
    include: { home: { select: { id: true; name: true } } };
  }>,
) {
  return {
    id: row.id,
    name: row.name,
    homeId: row.homeId,
    homeName: row.home?.name ?? null,
    shifts: parseShifts(row.shifts),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listRotas(actorUserId: string, query: ListRotasQuery) {
  const tenant = await requireTenantContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;

  const where: Prisma.RotaWhereInput = { tenantId: tenant.tenantId };
  if (query.homeId) where.homeId = query.homeId;
  if (query.weekStarting) where.weekStarting = query.weekStarting;

  if (query.employeeId) {
    const rows = await prisma.rota.findMany({
      where,
      orderBy: { weekStarting: 'desc' },
      include: { home: { select: { id: true, name: true } } },
    });

    const filtered = rows.filter((row) => {
      const shifts = parseShifts(row.shifts);
      return shifts.some((shift) => shift.employeeId === query.employeeId);
    });
    const paged = filtered.slice(skip, skip + query.pageSize);

    return {
      data: paged.map(mapRota),
      meta: buildPaginationMeta(filtered.length, query.page, query.pageSize),
    };
  }

  const [total, rows] = await Promise.all([
    prisma.rota.count({ where }),
    prisma.rota.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { weekStarting: 'desc' },
      include: { home: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    data: rows.map(mapRota),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getRota(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const row = await prisma.rota.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: { home: { select: { id: true, name: true } } },
  });

  if (!row) {
    throw httpError(404, 'ROTA_NOT_FOUND', 'Rota not found.');
  }

  return mapRota(row);
}

export async function createRota(actorUserId: string, body: CreateRotaBody) {
  const tenant = await requireTenantContext(actorUserId);

  await ensureHomeInTenant(tenant.tenantId, body.homeId);
  await ensureEmployeesInTenant(tenant.tenantId, extractEmployeeIdsFromShifts(body.shifts));

  try {
    const created = await prisma.rota.create({
      data: {
        tenantId: tenant.tenantId,
        homeId: body.homeId,
        weekStarting: body.weekStarting,
        shifts: normalizeShifts(body.shifts) as Prisma.InputJsonValue,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      include: { home: { select: { id: true, name: true } } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_created,
        entityType: 'rota',
        entityId: created.id,
      },
    });

    return mapRota(created);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'ROTA_ALREADY_EXISTS', 'A rota for this home and week already exists.');
    }
    throw error;
  }
}

export async function updateRota(actorUserId: string, id: string, body: UpdateRotaBody) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.rota.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true, homeId: true, weekStarting: true, shifts: true },
  });

  if (!existing) {
    throw httpError(404, 'ROTA_NOT_FOUND', 'Rota not found.');
  }

  const nextHomeId = body.homeId ?? existing.homeId;
  const nextShifts = body.shifts ?? (parseShifts(existing.shifts) as unknown as RotaShiftInput[]);

  if (body.homeId !== undefined) {
    await ensureHomeInTenant(tenant.tenantId, body.homeId);
  }
  if (body.shifts !== undefined || body.homeId !== undefined) {
    await ensureEmployeesInTenant(tenant.tenantId, extractEmployeeIdsFromShifts(nextShifts));
  }

  const updateData: Prisma.RotaUpdateInput = {
    updatedBy: { connect: { id: actorUserId } },
  };
  if (body.homeId !== undefined) updateData.home = { connect: { id: body.homeId } };
  if (body.weekStarting !== undefined) updateData.weekStarting = body.weekStarting;
  if (body.shifts !== undefined) updateData.shifts = normalizeShifts(body.shifts) as Prisma.InputJsonValue;

  try {
    const updated = await prisma.rota.update({
      where: { id },
      data: updateData,
      include: { home: { select: { id: true, name: true } } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_updated,
        entityType: 'rota',
        entityId: id,
        metadata: { fields: Object.keys(body), homeId: nextHomeId },
      },
    });

    return mapRota(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'ROTA_ALREADY_EXISTS', 'A rota for this home and week already exists.');
    }
    throw error;
  }
}

export async function deleteRota(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.rota.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'ROTA_NOT_FOUND', 'Rota not found.');
  }

  await prisma.rota.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_deleted,
      entityType: 'rota',
      entityId: id,
    },
  });

  return { message: 'Rota deleted.' };
}

export async function listRotaTemplates(actorUserId: string, query: ListRotaTemplatesQuery) {
  const tenant = await requireTenantContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;

  const where: Prisma.RotaTemplateWhereInput = {
    tenantId: tenant.tenantId,
  };
  if (query.homeId) where.homeId = query.homeId;

  const [total, rows] = await Promise.all([
    prisma.rotaTemplate.count({ where }),
    prisma.rotaTemplate.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
      include: { home: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    data: rows.map(mapRotaTemplate),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function createRotaTemplate(actorUserId: string, body: CreateRotaTemplateBody) {
  const tenant = await requireTenantContext(actorUserId);

  if (body.homeId) {
    await ensureHomeInTenant(tenant.tenantId, body.homeId);
  }
  await ensureEmployeesInTenant(tenant.tenantId, extractEmployeeIdsFromShifts(body.shifts));

  const created = await prisma.rotaTemplate.create({
    data: {
      tenantId: tenant.tenantId,
      homeId: body.homeId ?? null,
      name: body.name,
      shifts: normalizeShifts(body.shifts) as Prisma.InputJsonValue,
      createdById: actorUserId,
    },
    include: { home: { select: { id: true, name: true } } },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_created,
      entityType: 'rota_template',
      entityId: created.id,
    },
  });

  return mapRotaTemplate(created);
}
