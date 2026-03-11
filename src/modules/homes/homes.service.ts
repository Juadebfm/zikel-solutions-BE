import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import type { CreateHomeBody, ListHomesQuery, UpdateHomeBody } from './homes.schema.js';

function mapHome(home: {
  id: string;
  careGroupId: string;
  name: string;
  address: string | null;
  capacity: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  careGroup: { id: string; name: string } | null;
}) {
  return {
    id: home.id,
    careGroupId: home.careGroupId,
    careGroupName: home.careGroup?.name ?? null,
    name: home.name,
    address: home.address,
    capacity: home.capacity,
    isActive: home.isActive,
    createdAt: home.createdAt,
    updatedAt: home.updatedAt,
  };
}

async function ensureCareGroupExists(careGroupId: string) {
  const exists = await prisma.careGroup.findUnique({
    where: { id: careGroupId },
    select: { id: true },
  });
  if (!exists) {
    throw httpError(404, 'CARE_GROUP_NOT_FOUND', 'Care group not found.');
  }
}

export async function listHomes(query: ListHomesQuery) {
  const skip = (query.page - 1) * query.pageSize;
  const where: Prisma.HomeWhereInput = {
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { address: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.careGroupId ? { careGroupId: query.careGroupId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.home.count({ where }),
    prisma.home.findMany({
      where,
      include: {
        careGroup: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
      skip,
      take: query.pageSize,
    }),
  ]);

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

export async function getHome(id: string) {
  const home = await prisma.home.findUnique({
    where: { id },
    include: { careGroup: { select: { id: true, name: true } } },
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }
  return mapHome(home);
}

export async function createHome(actorId: string, body: CreateHomeBody) {
  await ensureCareGroupExists(body.careGroupId);

  const home = await prisma.home.create({
    data: {
      careGroupId: body.careGroupId,
      name: body.name,
      address: body.address ?? null,
      capacity: body.capacity ?? null,
    },
    include: { careGroup: { select: { id: true, name: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: AuditAction.record_created,
      entityType: 'home',
      entityId: home.id,
    },
  });

  return mapHome(home);
}

export async function updateHome(actorId: string, id: string, body: UpdateHomeBody) {
  const existing = await prisma.home.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }

  if (body.careGroupId !== undefined) {
    await ensureCareGroupExists(body.careGroupId);
  }

  const updateData: Prisma.HomeUpdateInput = {};
  if (body.careGroupId !== undefined) updateData.careGroup = { connect: { id: body.careGroupId } };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.address !== undefined) updateData.address = body.address;
  if (body.capacity !== undefined) updateData.capacity = body.capacity;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const updated = await prisma.home.update({
    where: { id },
    data: updateData,
    include: { careGroup: { select: { id: true, name: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: AuditAction.record_updated,
      entityType: 'home',
      entityId: id,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapHome(updated);
}

export async function deactivateHome(actorId: string, id: string) {
  const existing = await prisma.home.findUnique({
    where: { id },
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
      userId: actorId,
      action: AuditAction.record_deleted,
      entityType: 'home',
      entityId: id,
      metadata: { softDelete: true },
    },
  });

  return { message: 'Home deactivated.' };
}
