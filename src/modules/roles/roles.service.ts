import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { invalidateRolesCache } from '../../lib/cache.js';
import type { CreateRoleBody, ListRolesQuery, UpdateRoleBody } from './roles.schema.js';

const ROLE_INCLUDE = {
  _count: { select: { memberships: true } },
} as const;

function mapRole(role: Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isActive: role.isActive,
    isSystemRole: role.isSystemRole,
    isAssignable: role.isAssignable,
    permissions: role.permissions,
    activeUsers: role._count.memberships,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listRoles(actorId: string, query: ListRolesQuery) {
  const tenant = await requireTenantContext(actorId);
  const skip = (query.page - 1) * query.pageSize;
  const where: Prisma.RoleWhereInput = {
    tenantId: tenant.tenantId,
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.role.count({ where }),
    prisma.role.findMany({
      where,
      include: ROLE_INCLUDE,
      orderBy: { name: 'asc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  return {
    data: rows.map(mapRole),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

// ─── Get ─────────────────────────────────────────────────────────────────────

export async function getRole(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const role = await prisma.role.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: ROLE_INCLUDE,
  });
  if (!role) {
    throw httpError(404, 'ROLE_NOT_FOUND', 'Role not found.');
  }
  return mapRole(role);
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createRole(actorId: string, body: CreateRoleBody) {
  const tenant = await requireTenantContext(actorId);

  try {
    const role = await prisma.role.create({
      data: {
        tenantId: tenant.tenantId,
        name: body.name,
        description: body.description ?? null,
        permissions: body.permissions ?? [],
        isActive: body.isActive ?? true,
      },
      include: ROLE_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_created,
        entityType: 'role',
        entityId: role.id,
      },
    });

    invalidateRolesCache(tenant.tenantId);
    return mapRole(role);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(409, 'ROLE_NAME_TAKEN', 'A role with this name already exists.');
    }
    throw error;
  }
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateRole(actorId: string, id: string, body: UpdateRoleBody) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.role.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'ROLE_NOT_FOUND', 'Role not found.');
  }

  const updateData: Prisma.RoleUpdateInput = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.permissions !== undefined) updateData.permissions = body.permissions;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  try {
    const role = await prisma.role.update({
      where: { id },
      data: updateData,
      include: ROLE_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_updated,
        entityType: 'role',
        entityId: id,
        metadata: { fields: Object.keys(body) },
      },
    });

    invalidateRolesCache(tenant.tenantId);
    return mapRole(role);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(409, 'ROLE_NAME_TAKEN', 'A role with this name already exists.');
    }
    throw error;
  }
}

// ─── Deactivate ──────────────────────────────────────────────────────────────

export async function deactivateRole(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.role.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true, isSystemRole: true },
  });
  if (!existing) {
    throw httpError(404, 'ROLE_NOT_FOUND', 'Role not found.');
  }

  await prisma.role.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_deleted,
      entityType: 'role',
      entityId: id,
      metadata: { softDelete: true },
    },
  });

  invalidateRolesCache(tenant.tenantId);
  return { message: 'Role deactivated.' };
}
