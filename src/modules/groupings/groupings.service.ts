import { AuditAction, GroupingEntityType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type { CreateGroupingBody, ListGroupingsQuery, UpdateGroupingBody } from './groupings.schema.js';

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function assertEntityIdsInTenant(
  tenantId: string,
  entityType: GroupingEntityType,
  entityIds: string[],
) {
  if (entityIds.length === 0) return;

  if (entityType === GroupingEntityType.home) {
    const rows = await prisma.home.findMany({ where: { tenantId, id: { in: entityIds } }, select: { id: true } });
    if (rows.length !== entityIds.length) {
      throw httpError(404, 'HOME_NOT_FOUND', 'One or more homes were not found in this tenant.');
    }
    return;
  }

  if (entityType === GroupingEntityType.employee) {
    const rows = await prisma.employee.findMany({ where: { tenantId, id: { in: entityIds } }, select: { id: true } });
    if (rows.length !== entityIds.length) {
      throw httpError(404, 'EMPLOYEE_NOT_FOUND', 'One or more employees were not found in this tenant.');
    }
    return;
  }

  const rows = await prisma.careGroup.findMany({ where: { tenantId, id: { in: entityIds } }, select: { id: true } });
  if (rows.length !== entityIds.length) {
    throw httpError(404, 'CARE_GROUP_NOT_FOUND', 'One or more care groups were not found in this tenant.');
  }
}

function mapGrouping(
  row: Prisma.GroupingGetPayload<{
    include: {
      members: { select: { entityId: true } };
      createdBy: { select: { id: true; firstName: true; lastName: true } };
    };
  }>,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    entityType: row.entityType,
    entityIds: row.members.map((member) => member.entityId),
    isActive: row.isActive,
    createdBy: row.createdBy
      ? {
          id: row.createdBy.id,
          name: `${row.createdBy.firstName ?? ''} ${row.createdBy.lastName ?? ''}`.trim(),
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listGroupings(actorUserId: string, query: ListGroupingsQuery) {
  const tenant = await requireTenantContext(actorUserId);
  const skip = (query.page - 1) * query.pageSize;

  const where: Prisma.GroupingWhereInput = {
    tenantId: tenant.tenantId,
  };

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.type) where.type = query.type;
  if (query.isActive !== undefined) where.isActive = query.isActive;

  const [total, rows] = await Promise.all([
    prisma.grouping.count({ where }),
    prisma.grouping.findMany({
      where,
      skip,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        members: { select: { entityId: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  return {
    data: rows.map(mapGrouping),
    meta: buildPaginationMeta(total, query.page, query.pageSize),
  };
}

export async function getGrouping(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const row = await prisma.grouping.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: {
      members: { select: { entityId: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!row) {
    throw httpError(404, 'GROUPING_NOT_FOUND', 'Grouping not found.');
  }

  return mapGrouping(row);
}

export async function createGrouping(actorUserId: string, body: CreateGroupingBody) {
  const tenant = await requireTenantContext(actorUserId);
  const entityIds = [...new Set(body.entityIds)];

  await assertEntityIdsInTenant(tenant.tenantId, body.entityType, entityIds);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const grouping = await tx.grouping.create({
        data: {
          tenantId: tenant.tenantId,
          name: body.name,
          description: body.description ?? null,
          type: body.type,
          entityType: body.entityType,
          createdById: actorUserId,
        },
      });

      if (entityIds.length > 0) {
        await tx.groupingMember.createMany({
          data: entityIds.map((entityId) => ({
            tenantId: tenant.tenantId,
            groupingId: grouping.id,
            entityId,
          })),
        });
      }

      return tx.grouping.findUniqueOrThrow({
        where: { id: grouping.id },
        include: {
          members: { select: { entityId: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_created,
        entityType: 'grouping',
        entityId: created.id,
      },
    });

    return mapGrouping(created);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'GROUPING_NAME_CONFLICT', 'A grouping with this name already exists for that entity type.');
    }
    throw error;
  }
}

export async function updateGrouping(actorUserId: string, id: string, body: UpdateGroupingBody) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.grouping.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: { members: { select: { entityId: true } } },
  });

  if (!existing) {
    throw httpError(404, 'GROUPING_NOT_FOUND', 'Grouping not found.');
  }

  const entityType = body.entityType ?? existing.entityType;
  if (body.entityType && body.entityIds === undefined && existing.members.length > 0) {
    throw httpError(
      422,
      'ENTITY_IDS_REQUIRED_FOR_ENTITY_TYPE_CHANGE',
      'entityIds is required when changing entityType for a non-empty grouping.',
    );
  }

  const entityIds = body.entityIds ? [...new Set(body.entityIds)] : undefined;
  if (entityIds) {
    await assertEntityIdsInTenant(tenant.tenantId, entityType, entityIds);
  }

  const updateData: Prisma.GroupingUpdateInput = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.type !== undefined) updateData.type = body.type;
  if (body.entityType !== undefined) updateData.entityType = body.entityType;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.grouping.update({ where: { id }, data: updateData });

      if (entityIds) {
        await tx.groupingMember.deleteMany({ where: { groupingId: id } });
        if (entityIds.length > 0) {
          await tx.groupingMember.createMany({
            data: entityIds.map((entityId) => ({
              tenantId: tenant.tenantId,
              groupingId: id,
              entityId,
            })),
          });
        }
      }

      return tx.grouping.findUniqueOrThrow({
        where: { id },
        include: {
          members: { select: { entityId: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorUserId,
        action: AuditAction.record_updated,
        entityType: 'grouping',
        entityId: id,
        metadata: { fields: Object.keys(body) },
      },
    });

    return mapGrouping(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'GROUPING_NAME_CONFLICT', 'A grouping with this name already exists for that entity type.');
    }
    throw error;
  }
}

export async function deleteGrouping(actorUserId: string, id: string) {
  const tenant = await requireTenantContext(actorUserId);

  const existing = await prisma.grouping.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'GROUPING_NOT_FOUND', 'Grouping not found.');
  }

  await prisma.grouping.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorUserId,
      action: AuditAction.record_deleted,
      entityType: 'grouping',
      entityId: id,
    },
  });

  return { message: 'Grouping deleted.' };
}
