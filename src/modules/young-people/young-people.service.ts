import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type {
  CreateYoungPersonBody,
  ListYoungPeopleQuery,
  UpdateYoungPersonBody,
} from './young-people.schema.js';

function toIsoDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function mapYoungPerson(youngPerson: {
  id: string;
  homeId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  referenceNo: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  home: { id: string; name: string };
}) {
  return {
    id: youngPerson.id,
    homeId: youngPerson.homeId,
    homeName: youngPerson.home.name,
    firstName: youngPerson.firstName,
    lastName: youngPerson.lastName,
    dateOfBirth: toIsoDate(youngPerson.dateOfBirth),
    referenceNo: youngPerson.referenceNo,
    isActive: youngPerson.isActive,
    createdAt: youngPerson.createdAt,
    updatedAt: youngPerson.updatedAt,
  };
}

async function ensureHomeExists(homeId: string, tenantId: string) {
  const home = await prisma.home.findFirst({
    where: { id: homeId, tenantId },
    select: { id: true },
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }
}

export async function listYoungPeople(actorId: string, query: ListYoungPeopleQuery) {
  const tenant = await requireTenantContext(actorId);
  const skip = (query.page - 1) * query.pageSize;
  const where: Prisma.YoungPersonWhereInput = {
    tenantId: tenant.tenantId,
    ...(query.homeId ? { homeId: query.homeId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { referenceNo: { contains: query.search, mode: 'insensitive' } },
            { home: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.youngPerson.count({ where }),
    prisma.youngPerson.findMany({
      where,
      include: { home: { select: { id: true, name: true } } },
      orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      skip,
      take: query.pageSize,
    }),
  ]);

  await logSensitiveReadAccess({
    actorUserId: actorId,
    tenantId: tenant.tenantId,
    entityType: 'young_person',
    source: 'young-people.list',
    scope: 'list',
    resultCount: rows.length,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      homeId: query.homeId ?? null,
      hasSearch: Boolean(query.search),
      isActive: query.isActive ?? null,
    },
  });

  return {
    data: rows.map(mapYoungPerson),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export async function getYoungPerson(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const youngPerson = await prisma.youngPerson.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: { home: { select: { id: true, name: true } } },
  });
  if (!youngPerson) {
    throw httpError(404, 'YOUNG_PERSON_NOT_FOUND', 'Young person not found.');
  }

  await logSensitiveReadAccess({
    actorUserId: actorId,
    tenantId: tenant.tenantId,
    entityType: 'young_person',
    entityId: id,
    source: 'young-people.get',
    scope: 'detail',
    resultCount: 1,
  });

  return mapYoungPerson(youngPerson);
}

export async function createYoungPerson(actorId: string, body: CreateYoungPersonBody) {
  const tenant = await requireTenantContext(actorId);
  await ensureHomeExists(body.homeId, tenant.tenantId);

  try {
    const youngPerson = await prisma.youngPerson.create({
      data: {
        tenantId: tenant.tenantId,
        homeId: body.homeId,
        firstName: body.firstName,
        lastName: body.lastName,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        referenceNo: body.referenceNo ?? null,
      },
      include: { home: { select: { id: true, name: true } } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_created,
        entityType: 'young_person',
        entityId: youngPerson.id,
      },
    });

    return mapYoungPerson(youngPerson);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'REFERENCE_NO_TAKEN', 'Reference number already exists.');
    }
    throw error;
  }
}

export async function updateYoungPerson(actorId: string, id: string, body: UpdateYoungPersonBody) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.youngPerson.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'YOUNG_PERSON_NOT_FOUND', 'Young person not found.');
  }

  if (body.homeId !== undefined) {
    await ensureHomeExists(body.homeId, tenant.tenantId);
  }

  const updateData: Prisma.YoungPersonUpdateInput = {};
  if (body.homeId !== undefined) updateData.home = { connect: { id: body.homeId } };
  if (body.firstName !== undefined) updateData.firstName = body.firstName;
  if (body.lastName !== undefined) updateData.lastName = body.lastName;
  if (body.dateOfBirth !== undefined) {
    updateData.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
  }
  if (body.referenceNo !== undefined) updateData.referenceNo = body.referenceNo;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  try {
    const youngPerson = await prisma.youngPerson.update({
      where: { id },
      data: updateData,
      include: { home: { select: { id: true, name: true } } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_updated,
        entityType: 'young_person',
        entityId: id,
        metadata: { fields: Object.keys(body) },
      },
    });

    return mapYoungPerson(youngPerson);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'REFERENCE_NO_TAKEN', 'Reference number already exists.');
    }
    throw error;
  }
}

export async function deactivateYoungPerson(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.youngPerson.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'YOUNG_PERSON_NOT_FOUND', 'Young person not found.');
  }

  await prisma.youngPerson.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_deleted,
      entityType: 'young_person',
      entityId: id,
      metadata: { softDelete: true },
    },
  });

  return { message: 'Young person deactivated.' };
}
