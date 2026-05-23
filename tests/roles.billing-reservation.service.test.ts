import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    tenantUser: { findUnique: vi.fn() },
    tenantMembership: { findFirst: vi.fn() },
    role: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/cache.js', () => ({
  invalidateRolesCache: vi.fn(),
}));

import * as rolesService from '../src/modules/roles/roles.service.js';

// Minimal tenant-context stub: requireTenantContext walks user + membership
// + tenant relations. Set up the happy-path tenant lookup so the validator
// is the only thing that can throw.
function stubTenantContext() {
  mockPrisma.tenantUser.findUnique.mockResolvedValueOnce({
    id: 'user_1',
    role: 'admin',
    activeTenantId: 'tenant_1',
    activeTenant: { id: 'tenant_1', isActive: true },
    tenantMemberships: [
      {
        tenantId: 'tenant_1',
        status: 'active',
        role: { name: 'Owner', permissions: ['roles:write'] },
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('roles.service — billing:write reservation', () => {
  describe('createRole', () => {
    it('rejects a custom role that includes billing:write', async () => {
      stubTenantContext();

      await expect(
        rolesService.createRole('user_1', {
          name: 'Finance Manager',
          permissions: ['billing:read', 'billing:write'],
          description: null,
          isActive: true,
        } as Parameters<typeof rolesService.createRole>[1]),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PERMISSION_RESERVED',
      });

      // Validator must short-circuit BEFORE the DB write — no role created.
      expect(mockPrisma.role.create).not.toHaveBeenCalled();
    });

    it('allows a custom role without billing:write', async () => {
      stubTenantContext();
      mockPrisma.role.create.mockResolvedValueOnce({
        id: 'role_new',
        name: 'Care Coordinator',
        description: null,
        permissions: ['tasks:read', 'tasks:write'],
        isActive: true,
        isSystemRole: false,
        isAssignable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { memberships: 0 },
      });

      const result = await rolesService.createRole('user_1', {
        name: 'Care Coordinator',
        permissions: ['tasks:read', 'tasks:write'],
        description: null,
        isActive: true,
      } as Parameters<typeof rolesService.createRole>[1]);

      expect(result.name).toBe('Care Coordinator');
      expect(mockPrisma.role.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateRole', () => {
    it('rejects adding billing:write to an existing non-Owner role', async () => {
      stubTenantContext();
      mockPrisma.role.findFirst.mockResolvedValueOnce({
        id: 'role_admin',
        name: 'Admin',
      });

      await expect(
        rolesService.updateRole('user_1', 'role_admin', {
          permissions: ['billing:read', 'billing:write', 'roles:write'],
        } as Parameters<typeof rolesService.updateRole>[2]),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PERMISSION_RESERVED',
      });

      expect(mockPrisma.role.update).not.toHaveBeenCalled();
    });

    it('rejects removing billing:write from the Owner role', async () => {
      stubTenantContext();
      mockPrisma.role.findFirst.mockResolvedValueOnce({
        id: 'role_owner',
        name: 'Owner',
      });

      await expect(
        rolesService.updateRole('user_1', 'role_owner', {
          // Permissions list deliberately omits billing:write to simulate
          // an attempt to strip it from the Owner role.
          permissions: ['billing:read', 'roles:write'],
        } as Parameters<typeof rolesService.updateRole>[2]),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'PERMISSION_RESERVED',
      });

      expect(mockPrisma.role.update).not.toHaveBeenCalled();
    });

    it('allows updating the Owner role while preserving billing:write', async () => {
      stubTenantContext();
      mockPrisma.role.findFirst.mockResolvedValueOnce({
        id: 'role_owner',
        name: 'Owner',
      });
      mockPrisma.role.update.mockResolvedValueOnce({
        id: 'role_owner',
        name: 'Owner',
        description: 'Updated description',
        permissions: ['billing:read', 'billing:write', 'roles:write'],
        isActive: true,
        isSystemRole: true,
        isAssignable: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { memberships: 1 },
      });

      const result = await rolesService.updateRole('user_1', 'role_owner', {
        description: 'Updated description',
        permissions: ['billing:read', 'billing:write', 'roles:write'],
      } as Parameters<typeof rolesService.updateRole>[2]);

      expect(result.name).toBe('Owner');
      expect(result.permissions).toContain('billing:write');
      expect(mockPrisma.role.update).toHaveBeenCalledTimes(1);
    });

    it('allows updating a non-Owner role when permissions list excludes billing:write', async () => {
      stubTenantContext();
      mockPrisma.role.findFirst.mockResolvedValueOnce({
        id: 'role_admin',
        name: 'Admin',
      });
      mockPrisma.role.update.mockResolvedValueOnce({
        id: 'role_admin',
        name: 'Admin',
        description: null,
        permissions: ['tasks:read', 'tasks:write', 'roles:write'],
        isActive: true,
        isSystemRole: true,
        isAssignable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { memberships: 2 },
      });

      const result = await rolesService.updateRole('user_1', 'role_admin', {
        permissions: ['tasks:read', 'tasks:write', 'roles:write'],
      } as Parameters<typeof rolesService.updateRole>[2]);

      expect(result.permissions).not.toContain('billing:write');
      expect(mockPrisma.role.update).toHaveBeenCalledTimes(1);
    });

    it('skips the billing check entirely when permissions are not part of the update', async () => {
      // If the caller is only changing description / isActive / name without
      // touching permissions, the reservation rule shouldn't fire.
      stubTenantContext();
      mockPrisma.role.findFirst.mockResolvedValueOnce({
        id: 'role_x',
        name: 'Care Coordinator',
      });
      mockPrisma.role.update.mockResolvedValueOnce({
        id: 'role_x',
        name: 'Care Coordinator',
        description: 'Renamed',
        permissions: ['tasks:read'],
        isActive: true,
        isSystemRole: false,
        isAssignable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { memberships: 0 },
      });

      const result = await rolesService.updateRole('user_1', 'role_x', {
        description: 'Renamed',
      } as Parameters<typeof rolesService.updateRole>[2]);

      expect(result.description).toBe('Renamed');
      expect(mockPrisma.role.update).toHaveBeenCalledTimes(1);
    });
  });
});
