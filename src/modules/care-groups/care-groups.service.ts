import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type {
  CreateCareGroupBody,
  ListCareGroupsQuery,
  UpdateCareGroupBody,
} from './care-groups.schema.js';

function mapCareGroup(group: {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    isActive: group.isActive,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

export async function listCareGroups(actorId: string, query: ListCareGroupsQuery) {
  const tenant = await requireTenantContext(actorId);
  const skip = (query.page - 1) * query.pageSize;
  const where: Prisma.CareGroupWhereInput = {
    tenantId: tenant.tenantId,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.careGroup.count({ where }),
    prisma.careGroup.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  return {
    data: rows.map(mapCareGroup),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export async function getCareGroup(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const group = await prisma.careGroup.findFirst({
    where: { id, tenantId: tenant.tenantId },
  });
  if (!group) {
    throw httpError(404, 'CARE_GROUP_NOT_FOUND', 'Care group not found.');
  }
  return mapCareGroup(group);
}

export async function createCareGroup(actorId: string, body: CreateCareGroupBody) {
  const tenant = await requireTenantContext(actorId);

  try {
    const group = await prisma.careGroup.create({
      data: {
        tenantId: tenant.tenantId,
        name: body.name,
        description: body.description ?? null,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_created,
        entityType: 'care_group',
        entityId: group.id,
      },
    });

    return mapCareGroup(group);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'CARE_GROUP_NAME_TAKEN', 'A care group with this name already exists.');
    }
    throw error;
  }
}

export async function updateCareGroup(actorId: string, id: string, body: UpdateCareGroupBody) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.careGroup.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'CARE_GROUP_NOT_FOUND', 'Care group not found.');
  }

  const updateData: Prisma.CareGroupUpdateInput = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  try {
    const updated = await prisma.careGroup.update({
      where: { id },
      data: updateData,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_updated,
        entityType: 'care_group',
        entityId: id,
        metadata: { fields: Object.keys(body) },
      },
    });

    return mapCareGroup(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'CARE_GROUP_NAME_TAKEN', 'A care group with this name already exists.');
    }
    throw error;
  }
}

export async function deactivateCareGroup(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.careGroup.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'CARE_GROUP_NOT_FOUND', 'Care group not found.');
  }

  await prisma.careGroup.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_deleted,
      entityType: 'care_group',
      entityId: id,
      metadata: { softDelete: true },
    },
  });

  return { message: 'Care group deactivated.' };
}
