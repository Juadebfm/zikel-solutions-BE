import { AuditAction, MembershipStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import { hashPassword } from '../../lib/password.js';
import { emitNotification, getTenantAdminUserIds } from '../../lib/notification-emitter.js';
import type {
  CreateEmployeeBody,
  CreateEmployeeWithUserBody,
  ListEmployeesQuery,
  UpdateEmployeeBody,
} from './employees.schema.js';

const EMP_INCLUDE = {
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
  home: { select: { id: true, name: true } },
  role: { select: { id: true, name: true } },
} as const;

function mapEmployee(employee: Prisma.EmployeeGetPayload<{ include: typeof EMP_INCLUDE }>) {
  return {
    id: employee.id,
    userId: employee.userId,
    user: employee.user,
    homeId: employee.homeId,
    homeName: employee.home?.name ?? null,
    roleId: employee.roleId,
    roleName: employee.role?.name ?? null,
    jobTitle: employee.jobTitle,
    startDate: employee.startDate,
    endDate: employee.endDate,
    status: employee.status,
    contractType: employee.contractType,
    dbsNumber: employee.dbsNumber,
    dbsDate: employee.dbsDate,
    qualifications: employee.qualifications,
    isActive: employee.isActive,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}

async function ensureUserHasTenantAccess(userId: string, tenantId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const membership = await prisma.tenantMembership.findUnique({
    where: {
      tenantId_userId: {
        tenantId,
        userId,
      },
    },
    select: { status: true },
  });

  if (!membership || membership.status !== MembershipStatus.active) {
    throw httpError(
      409,
      'TENANT_MEMBERSHIP_REQUIRED',
      'User must have an active tenant membership before becoming an employee.',
    );
  }
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

// ─── List ────────────────────────────────────────────────────────────────────

export async function listEmployees(actorId: string, query: ListEmployeesQuery) {
  const tenant = await requireTenantContext(actorId);
  const skip = (query.page - 1) * query.pageSize;
  const where: Prisma.EmployeeWhereInput = {
    tenantId: tenant.tenantId,
    ...(query.homeId ? { homeId: query.homeId } : {}),
    ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
    ...(query.roleId ? { roleId: query.roleId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
          OR: [
            { jobTitle: { contains: query.search, mode: 'insensitive' } },
            { user: { firstName: { contains: query.search, mode: 'insensitive' } } },
            { user: { lastName: { contains: query.search, mode: 'insensitive' } } },
            { user: { email: { contains: query.search, mode: 'insensitive' } } },
            { home: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      include: EMP_INCLUDE,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: query.pageSize,
    }),
  ]);

  await logSensitiveReadAccess({
    actorUserId: actorId,
    tenantId: tenant.tenantId,
    entityType: 'employee',
    source: 'employees.list',
    scope: 'list',
    resultCount: rows.length,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      homeId: query.homeId ?? null,
      status: query.status ?? null,
      roleId: query.roleId ?? null,
      hasSearch: Boolean(query.search),
      isActive: query.isActive ?? null,
    },
  });

  return {
    data: rows.map(mapEmployee),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

// ─── Get ─────────────────────────────────────────────────────────────────────

export async function getEmployee(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const employee = await prisma.employee.findFirst({
    where: { id, tenantId: tenant.tenantId },
    include: EMP_INCLUDE,
  });
  if (!employee) {
    throw httpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
  }

  await logSensitiveReadAccess({
    actorUserId: actorId,
    tenantId: tenant.tenantId,
    entityType: 'employee',
    entityId: id,
    source: 'employees.get',
    scope: 'detail',
    resultCount: 1,
  });

  return mapEmployee(employee);
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createEmployee(actorId: string, body: CreateEmployeeBody) {
  const tenant = await requireTenantContext(actorId);
  await ensureUserHasTenantAccess(body.userId, tenant.tenantId);
  if (body.homeId) await ensureHomeExists(body.homeId, tenant.tenantId);

  try {
    const employee = await prisma.employee.create({
      data: {
        tenantId: tenant.tenantId,
        userId: body.userId,
        homeId: body.homeId ?? null,
        roleId: body.roleId ?? null,
        jobTitle: body.jobTitle ?? null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        status: body.status ?? 'current',
        contractType: body.contractType ?? null,
        dbsNumber: body.dbsNumber ?? null,
        dbsDate: body.dbsDate ?? null,
        qualifications: (body.qualifications ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
        isActive: body.isActive ?? true,
      },
      include: EMP_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_created,
        entityType: 'employee',
        entityId: employee.id,
      },
    });

    // Notify tenant admins about the new employee
    void getTenantAdminUserIds(tenant.tenantId).then((adminIds) => {
      const recipients = adminIds.filter((id) => id !== actorId);
      if (recipients.length > 0) {
        void emitNotification({
          level: 'tenant',
          category: 'employee_added',
          tenantId: tenant.tenantId,
          title: 'New employee added',
          body: `A new employee has been added to the organization.`,
          metadata: { employeeId: employee.id },
          recipientUserIds: recipients,
          createdById: actorId,
        });
      }
    });

    return mapEmployee(employee);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(409, 'EMPLOYEE_EXISTS', 'An employee record already exists for this user.');
    }
    throw error;
  }
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateEmployee(actorId: string, id: string, body: UpdateEmployeeBody) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.employee.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
  }

  if (body.homeId !== undefined && body.homeId !== null) {
    await ensureHomeExists(body.homeId, tenant.tenantId);
  }

  const updateData: Prisma.EmployeeUpdateInput = {};
  if (body.homeId !== undefined) {
    updateData.home = body.homeId === null ? { disconnect: true } : { connect: { id: body.homeId } };
  }
  if (body.roleId !== undefined) {
    updateData.role = body.roleId === null ? { disconnect: true } : { connect: { id: body.roleId } };
  }
  if (body.jobTitle !== undefined) updateData.jobTitle = body.jobTitle;
  if (body.startDate !== undefined) updateData.startDate = body.startDate;
  if (body.endDate !== undefined) updateData.endDate = body.endDate;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.contractType !== undefined) updateData.contractType = body.contractType;
  if (body.dbsNumber !== undefined) updateData.dbsNumber = body.dbsNumber;
  if (body.dbsDate !== undefined) updateData.dbsDate = body.dbsDate;
  if (body.qualifications !== undefined) {
    updateData.qualifications = (body.qualifications ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  }
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const employee = await prisma.employee.update({
    where: { id },
    data: updateData,
    include: EMP_INCLUDE,
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_updated,
      entityType: 'employee',
      entityId: id,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapEmployee(employee);
}

// ─── Create with User (multi-step) ───────────────────────────────────────────

export async function createEmployeeWithUser(actorId: string, body: CreateEmployeeWithUserBody) {
  const tenant = await requireTenantContext(actorId);
  if (body.homeId) await ensureHomeExists(body.homeId, tenant.tenantId);

  const passwordHash = await hashPassword(body.password);

  try {
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        otherNames: body.otherNames ?? null,
        dateOfBirth: body.dateOfBirth ?? null,
        userType: body.userType ?? 'internal',
        avatarUrl: body.avatarUrl ?? null,
        landingPage: body.landingPage ?? null,
        hideFutureTasks: body.hideFutureTasks ?? false,
        enableIpRestriction: body.enableIpRestriction ?? false,
        passwordExpiresInstantly: body.passwordExpiresInstantly ?? false,
        disableLoginAt: body.disableLoginAt ?? null,
        passwordExpiresAt: body.passwordExpiresAt ?? null,
        isActive: body.isActive ?? true,
        emailVerified: true,
        acceptedTerms: true,
        activeTenantId: tenant.tenantId,
      },
    });

    await prisma.tenantMembership.create({
      data: {
        tenantId: tenant.tenantId,
        userId: user.id,
        role: MembershipStatus.active ? 'staff' : 'staff',
        status: MembershipStatus.active,
        invitedById: actorId,
      },
    });

    const employee = await prisma.employee.create({
      data: {
        tenantId: tenant.tenantId,
        userId: user.id,
        homeId: body.homeId ?? null,
        roleId: body.roleId ?? null,
        jobTitle: body.jobTitle ?? null,
        startDate: body.startDate ?? null,
        contractType: body.contractType ?? null,
        status: 'current',
        isActive: body.isActive ?? true,
      },
      include: EMP_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        userId: actorId,
        action: AuditAction.record_created,
        entityType: 'employee',
        entityId: employee.id,
        metadata: { createdWithUser: true, userId: user.id },
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        isActive: user.isActive,
      },
      employee: mapEmployee(employee),
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw httpError(409, 'EMAIL_TAKEN', 'A user with this email already exists.');
    }
    throw error;
  }
}

// ─── Deactivate ──────────────────────────────────────────────────────────────

export async function deactivateEmployee(actorId: string, id: string) {
  const tenant = await requireTenantContext(actorId);
  const existing = await prisma.employee.findFirst({
    where: { id, tenantId: tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
  }

  await prisma.employee.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: tenant.tenantId,
      userId: actorId,
      action: AuditAction.record_deleted,
      entityType: 'employee',
      entityId: id,
      metadata: { softDelete: true },
    },
  });

  return { message: 'Employee deactivated.' };
}
