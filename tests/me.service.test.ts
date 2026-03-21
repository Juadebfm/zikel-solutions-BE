import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
    },
    tenantMembership: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

import * as meService from '../src/modules/me/me.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.tenantMembership.findFirst.mockResolvedValue(null);
});

describe('me.service getMyPermissions', () => {
  it('returns tenant-admin permissions for a staff user in active tenant-admin context', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      role: 'staff',
      activeTenantId: 'tenant_1',
    });
    mockPrisma.tenantMembership.findFirst.mockResolvedValueOnce({
      role: 'tenant_admin',
    });

    const result = await meService.getMyPermissions('user_1');

    expect(result).toEqual({
      canViewAllHomes: true,
      canViewAllYoungPeople: true,
      canViewAllEmployees: true,
      canApproveIOILogs: true,
      canManageUsers: true,
      canManageSettings: true,
      canViewReports: true,
      canExportData: true,
    });
    expect(mockPrisma.tenantMembership.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        tenantId: 'tenant_1',
        status: 'active',
        tenant: { isActive: true },
      },
      select: { role: true },
    });
  });

  it('returns sub-admin permissions for a staff user in active sub-admin context', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      role: 'staff',
      activeTenantId: 'tenant_1',
    });
    mockPrisma.tenantMembership.findFirst.mockResolvedValueOnce({
      role: 'sub_admin',
    });

    const result = await meService.getMyPermissions('user_2');

    expect(result).toEqual({
      canViewAllHomes: true,
      canViewAllYoungPeople: true,
      canViewAllEmployees: true,
      canApproveIOILogs: true,
      canManageUsers: true,
      canManageSettings: false,
      canViewReports: true,
      canExportData: true,
    });
  });

  it('falls back to global role when active tenant membership is missing', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      role: 'manager',
      activeTenantId: 'tenant_missing_membership',
    });
    mockPrisma.tenantMembership.findFirst.mockResolvedValueOnce(null);

    const result = await meService.getMyPermissions('user_3');

    expect(result).toEqual({
      canViewAllHomes: true,
      canViewAllYoungPeople: true,
      canViewAllEmployees: true,
      canApproveIOILogs: true,
      canManageUsers: false,
      canManageSettings: false,
      canViewReports: true,
      canExportData: true,
    });
  });

  it('uses global super-admin permissions without tenant lookup', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      role: 'super_admin',
      activeTenantId: null,
    });

    const result = await meService.getMyPermissions('user_super');

    expect(result).toEqual({
      canViewAllHomes: true,
      canViewAllYoungPeople: true,
      canViewAllEmployees: true,
      canApproveIOILogs: true,
      canManageUsers: true,
      canManageSettings: true,
      canViewReports: true,
      canExportData: true,
    });
    expect(mockPrisma.tenantMembership.findFirst).not.toHaveBeenCalled();
  });

  it('throws USER_NOT_FOUND when user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(meService.getMyPermissions('missing_user')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User not found.',
    });
  });
});
