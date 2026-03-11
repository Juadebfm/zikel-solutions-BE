import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import type {
  CreateEmployeeBody,
  ListEmployeesQuery,
  UpdateEmployeeBody,
} from './employees.schema.js';

function mapEmployee(employee: {
  id: string;
  userId: string;
  homeId: string | null;
  jobTitle: string | null;
  startDate: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  home: { id: string; name: string } | null;
}) {
  return {
    id: employee.id,
    userId: employee.userId,
    user: employee.user,
    homeId: employee.homeId,
    homeName: employee.home?.name ?? null,
    jobTitle: employee.jobTitle,
    startDate: employee.startDate,
    isActive: employee.isActive,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}

async function ensureUserExists(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }
}

async function ensureHomeExists(homeId: string) {
  const home = await prisma.home.findUnique({
    where: { id: homeId },
    select: { id: true },
  });
  if (!home) {
    throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
  }
}

export async function listEmployees(query: ListEmployeesQuery) {
  const skip = (query.page - 1) * query.pageSize;
  const where: Prisma.EmployeeWhereInput = {
    ...(query.homeId ? { homeId: query.homeId } : {}),
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
      include: {
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
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: query.pageSize,
    }),
  ]);

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

export async function getEmployee(id: string) {
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
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
    },
  });
  if (!employee) {
    throw httpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
  }
  return mapEmployee(employee);
}

export async function createEmployee(actorId: string, body: CreateEmployeeBody) {
  await ensureUserExists(body.userId);
  if (body.homeId) await ensureHomeExists(body.homeId);

  try {
    const employee = await prisma.employee.create({
      data: {
        userId: body.userId,
        homeId: body.homeId ?? null,
        jobTitle: body.jobTitle ?? null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        isActive: body.isActive ?? true,
      },
      include: {
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
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: AuditAction.record_created,
        entityType: 'employee',
        entityId: employee.id,
      },
    });

    return mapEmployee(employee);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'EMPLOYEE_EXISTS', 'An employee record already exists for this user.');
    }
    throw error;
  }
}

export async function updateEmployee(actorId: string, id: string, body: UpdateEmployeeBody) {
  const existing = await prisma.employee.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    throw httpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
  }

  if (body.homeId !== undefined && body.homeId !== null) {
    await ensureHomeExists(body.homeId);
  }

  const updateData: Prisma.EmployeeUpdateInput = {};
  if (body.homeId !== undefined) {
    updateData.home = body.homeId === null
      ? { disconnect: true }
      : { connect: { id: body.homeId } };
  }
  if (body.jobTitle !== undefined) updateData.jobTitle = body.jobTitle;
  if (body.startDate !== undefined) updateData.startDate = body.startDate ? new Date(body.startDate) : null;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const employee = await prisma.employee.update({
    where: { id },
    data: updateData,
    include: {
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
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: AuditAction.record_updated,
      entityType: 'employee',
      entityId: id,
      metadata: { fields: Object.keys(body) },
    },
  });

  return mapEmployee(employee);
}

export async function deactivateEmployee(actorId: string, id: string) {
  const existing = await prisma.employee.findUnique({
    where: { id },
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
      userId: actorId,
      action: AuditAction.record_deleted,
      entityType: 'employee',
      entityId: id,
      metadata: { softDelete: true },
    },
  });

  return { message: 'Employee deactivated.' };
}
