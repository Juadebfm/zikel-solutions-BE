import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type { CreateRegionBody, ListRegionsQuery, UpdateRegionBody } from './regions.schema.js';

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function assertHomesInTenant(tenantId: string, homeIds: string[]) {
  if (homeIds.length === 0) return;

  const rows = await prisma.home.findMany({
    where: { tenantId, id: { in: homeIds } },
    select: { id: true },
  });
  if (rows.length !== homeIds.length) {
    throw httpError(404, 'HOME_NOT_FOUND', 'One or more homes were not found in this tenant.');
  }
}

function mapRegion(
  row: Prisma.RegionGetPayload<{
    include: {
      homeLinks: {
        include: {
          home: { select: { id: true; name: true } };
        };
      };
    };
  }>,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    homes: row.homeLinks.map((link) => ({ id: link.home.id, name: link.home.name })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listRegions(actorUserId: string, query: ListRegionsQuery) {
  const tenant = await requireTenantContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;

  const where: Prisma.RegionWhereInput = {
    tenantId: tenant.tenantId,
  };
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.isActive !== undefined) where.isActive = query.isActive;

  const [total, rows] = await Promise.all([
    prisma.region.count({ where }),
    prisma.region.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        homeLinks: {
          include: {
            home: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  return {
    data: rows.map(mapRegion),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getRegion(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const row = await prisma.region.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: {
      homeLinks: {
        include: {
          home: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!row) {
    throw httpError(404, 'REGION_NOT_FOUND', 'Region not found.');
  }

  return mapRegion(row);
}

export async function createRegion(actorUserId: string, body: CreateRegionBody) {
  const tenant = await requireTenantContext(actorUserId);
  const homeIds = [...new Set(body.homeIds)];

  await assertHomesInTenant(tenant.tenantId, homeIds);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const region = await tx.region.create({
        data: {
          tenantId: tenant.tenantId,
          name: body.name,
          description: body.description ?? null,
        },
      });

      if (homeIds.length > 0) {
        await tx.regionHome.createMany({
          data: homeIds.map((homeId) => ({
            tenantId: tenant.tenantId,
            regionId: region.id,
            homeId,
          })),
        });
      }

      return tx.region.findUniqueOrThrow({
        where: { id: region.id },
        include: {
          homeLinks: {
            include: {
              home: { select: { id: true, name: true } },
            },
          },
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_created,
        entityType: 'region',
        entityId: created.id,
      },
    });

    return mapRegion(created);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'REGION_NAME_CONFLICT', 'A region with this name already exists.');
    }
    throw error;
  }
}

export async function updateRegion(actorUserId: string, id: string, body: UpdateRegionBody) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.region.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'REGION_NOT_FOUND', 'Region not found.');
  }

  const homeIds = body.homeIds ? [...new Set(body.homeIds)] : undefined;
  if (homeIds) {
    await assertHomesInTenant(tenant.tenantId, homeIds);
  }

  const updateData: Prisma.RegionUpdateInput = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.region.update({
        where: { id },
        data: updateData,
      });

      if (homeIds) {
        await tx.regionHome.deleteMany({ where: { regionId: id } });
        if (homeIds.length > 0) {
          await tx.regionHome.createMany({
            data: homeIds.map((homeId) => ({
              tenantId: tenant.tenantId,
              regionId: id,
              homeId,
            })),
          });
        }
      }

      return tx.region.findUniqueOrThrow({
        where: { id },
        include: {
          homeLinks: {
            include: {
              home: { select: { id: true, name: true } },
            },
          },
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_updated,
        entityType: 'region',
        entityId: id,
        metadata: { fields: Object.keys(body) },
      },
    });

    return mapRegion(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'REGION_NAME_CONFLICT', 'A region with this name already exists.');
    }
    throw error;
  }
}

export async function deleteRegion(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.region.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'REGION_NOT_FOUND', 'Region not found.');
  }

  await prisma.region.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_deleted,
      entityType: 'region',
      entityId: id,
    },
  });

  return { message: 'Region deleted.' };
}
