import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    tenantUser: { findUnique: vi.fn() },
    tenantMembership: { findFirst: vi.fn() },
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));

import * as meService from '../src/modules/me/me.service.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.tenantMembership.findFirst.mockResolvedValue(null);
});

// Permission strings mirror src/auth/permissions.ts. The service translates
// them into legacy boolean flags for FE back-compat.
const OWNER_PERMS = [
  'employees:read', 'employees:write', 'employees:invite',
  'homes:read', 'homes:write',
  'young_people:read', 'young_people:write',
  'tasks:read', 'tasks:write', 'tasks:approve',
  'safeguarding:read', 'safeguarding:write',
  'reports:read', 'reports:export',
  'settings:read', 'settings:write',
  'members:read', 'members:write',
  'roles:read', 'roles:write',
];

const ADMIN_PERMS = OWNER_PERMS.filter((p) => p !== 'settings:write');

describe('me.service getMyPermissions', () => {
  it('returns full Owner permissions when active membership grants all capabilities', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      role: 'staff',
      activeTenantId: 'tenant_1',
    });
    mockPrisma.tenantMembership.findFirst.mockResolvedValueOnce({
      role: { name: 'Owner', permissions: OWNER_PERMS },
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
      select: { role: { select: { name: true, permissions: true } } },
    });
  });

  it('returns Admin permissions (no settings:write) when membership grants Admin role', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      role: 'staff',
      activeTenantId: 'tenant_1',
    });
    mockPrisma.tenantMembership.findFirst.mockResolvedValueOnce({
      role: { name: 'Admin', permissions: ADMIN_PERMS },
    });

    const result = await meService.getMyPermissions('user_2');

    expect(result.canManageSettings).toBe(false);
    expect(result.canManageUsers).toBe(true);
    expect(result.canViewReports).toBe(true);
  });

  it('falls back to global UserRole permissions when no active membership exists', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      role: 'manager',
      activeTenantId: 'tenant_missing_membership',
    });
    mockPrisma.tenantMembership.findFirst.mockResolvedValueOnce(null);

    const result = await meService.getMyPermissions('user_3');

    // GLOBAL_ROLE_PERMISSIONS.manager: read/approve everything, no manage.
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

  it('returns staff defaults when user has no active tenant', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
      role: 'staff',
      activeTenantId: null,
    });

    const result = await meService.getMyPermissions('user_no_tenant');

    expect(result).toEqual({
      canViewAllHomes: false,
      canViewAllYoungPeople: false,
      canViewAllEmployees: false,
      canApproveIOILogs: false,
      canManageUsers: false,
      canManageSettings: false,
      canViewReports: false,
      canExportData: false,
    });
    // No membership lookup when there's no active tenant.
    expect(mockPrisma.tenantMembership.findFirst).not.toHaveBeenCalled();
  });

  it('throws USER_NOT_FOUND when user does not exist', async () => {
    mockPrisma.tenantUser.findUnique.mockResolvedValueOnce(null);

    await expect(meService.getMyPermissions('missing_user')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User not found.',
    });
  });
});
