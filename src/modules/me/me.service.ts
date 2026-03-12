import { AuditAction, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { ChangePasswordBody, UpdateMeBody, UpdatePreferencesBody } from './me.schema.js';

const ROLE_PERMISSIONS: Record<
  UserRole,
  {
    canViewAllHomes: boolean;
    canViewAllYoungPeople: boolean;
    canViewAllEmployees: boolean;
    canApproveIOILogs: boolean;
    canManageUsers: boolean;
    canManageSettings: boolean;
    canViewReports: boolean;
    canExportData: boolean;
  }
> = {
  super_admin: {
    canViewAllHomes: true,
    canViewAllYoungPeople: true,
    canViewAllEmployees: true,
    canApproveIOILogs: true,
    canManageUsers: true,
    canManageSettings: true,
    canViewReports: true,
    canExportData: true,
  },
  staff: {
    canViewAllHomes: false,
    canViewAllYoungPeople: false,
    canViewAllEmployees: false,
    canApproveIOILogs: false,
    canManageUsers: false,
    canManageSettings: false,
    canViewReports: false,
    canExportData: false,
  },
  manager: {
    canViewAllHomes: true,
    canViewAllYoungPeople: true,
    canViewAllEmployees: true,
    canApproveIOILogs: true,
    canManageUsers: false,
    canManageSettings: false,
    canViewReports: true,
    canExportData: true,
  },
  admin: {
    canViewAllHomes: true,
    canViewAllYoungPeople: true,
    canViewAllEmployees: true,
    canApproveIOILogs: true,
    canManageUsers: true,
    canManageSettings: true,
    canViewReports: true,
    canExportData: true,
  },
};

type UserWithEmployee = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatarUrl: string | null;
  phoneNumber: string | null;
  language: string;
  timezone: string;
  aiAccessEnabled: boolean;
  activeTenantId: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  employee: { homeId: string | null; jobTitle: string | null; home: { name: string } | null } | null;
};

function mapProfile(user: UserWithEmployee) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    avatar: user.avatarUrl,
    homeId: user.employee?.homeId ?? null,
    homeName: user.employee?.home?.name ?? null,
    phone: user.phoneNumber,
    jobTitle: user.employee?.jobTitle ?? null,
    language: user.language,
    timezone: user.timezone,
    aiAccessEnabled: user.aiAccessEnabled,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

async function getUserOrThrow(userId: string): Promise<UserWithEmployee> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      avatarUrl: true,
      phoneNumber: true,
      language: true,
      timezone: true,
      aiAccessEnabled: true,
      activeTenantId: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const employee = user.activeTenantId
    ? await prisma.employee.findFirst({
        where: {
          userId: user.id,
          tenantId: user.activeTenantId,
        },
        select: {
          homeId: true,
          jobTitle: true,
          home: { select: { name: true } },
        },
      })
    : null;

  return {
    ...user,
    employee,
  };
}

export async function getMyProfile(userId: string) {
  const user = await getUserOrThrow(userId);
  return mapProfile(user);
}

export async function updateMyProfile(userId: string, body: UpdateMeBody) {
  const updateData: Prisma.UserUpdateInput = {};
  if (body.firstName !== undefined) updateData.firstName = body.firstName;
  if (body.lastName !== undefined) updateData.lastName = body.lastName;
  if (body.phone !== undefined) updateData.phoneNumber = body.phone;
  if (body.avatar !== undefined) updateData.avatarUrl = body.avatar;

  await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: AuditAction.record_updated,
      entityType: 'user_profile',
      entityId: userId,
      metadata: { fields: Object.keys(body) },
    },
  });

  const updated = await getUserOrThrow(userId);
  return mapProfile(updated);
}

export async function changeMyPassword(userId: string, body: ChangePasswordBody) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const currentPasswordCheck = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!currentPasswordCheck.match) {
    throw httpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  }

  const passwordReuseCheck = await verifyPassword(body.newPassword, user.passwordHash);
  if (passwordReuseCheck.match) {
    throw httpError(400, 'PASSWORD_REUSED', 'New password must be different from current password.');
  }

  const newPasswordHash = await hashPassword(body.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        userId,
        action: AuditAction.password_change,
        entityType: 'user',
        entityId: userId,
        metadata: { source: 'me_change_password' },
      },
    }),
  ]);

  return { message: 'Password updated.' };
}

export async function getMyPermissions(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  return ROLE_PERMISSIONS[user.role];
}

export async function getMyPreferences(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { language: true, timezone: true },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  return user;
}

export async function updateMyPreferences(userId: string, body: UpdatePreferencesBody) {
  const updateData: Prisma.UserUpdateInput = {};
  if (body.language !== undefined) updateData.language = body.language;
  if (body.timezone !== undefined) updateData.timezone = body.timezone;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: { language: true, timezone: true },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: AuditAction.record_updated,
      entityType: 'user_preferences',
      entityId: userId,
      metadata: body,
    },
  });

  return updated;
}
