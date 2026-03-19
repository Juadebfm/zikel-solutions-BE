import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const {
  listTenants,
  getTenantById,
  createTenant,
  provisionStaff,
  createInviteLink,
  getInviteLink,
  revokeInviteLink,
  resolveInviteLinkByCode,
  listTenantMemberships,
  addTenantMembership,
  updateTenantMembership,
  listTenantInvites,
  createTenantInvite,
  revokeTenantInvite,
  acceptTenantInvite,
} = vi.hoisted(() => ({
  listTenants: vi.fn(),
  getTenantById: vi.fn(),
  createTenant: vi.fn(),
  provisionStaff: vi.fn(),
  createInviteLink: vi.fn(),
  getInviteLink: vi.fn(),
  revokeInviteLink: vi.fn(),
  resolveInviteLinkByCode: vi.fn(),
  listTenantMemberships: vi.fn(),
  addTenantMembership: vi.fn(),
  updateTenantMembership: vi.fn(),
  listTenantInvites: vi.fn(),
  createTenantInvite: vi.fn(),
  revokeTenantInvite: vi.fn(),
  acceptTenantInvite: vi.fn(),
}));

vi.mock('../src/modules/tenants/tenants.service.js', () => ({
  listTenants,
  getTenantById,
  createTenant,
  provisionStaff,
  createInviteLink,
  getInviteLink,
  revokeInviteLink,
  resolveInviteLinkByCode,
  listTenantMemberships,
  addTenantMembership,
  updateTenantMembership,
  listTenantInvites,
  createTenantInvite,
  revokeTenantInvite,
  acceptTenantInvite,
}));

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test_secret_that_is_at_least_32_characters_long';

let app: FastifyInstance;

beforeAll(async () => {
  const server = await import('../src/server.js');
  app = await server.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function authHeader(
  userId = 'user_1',
  role: 'super_admin' | 'staff' | 'manager' | 'admin' = 'super_admin',
  tenantRole: 'tenant_admin' | 'sub_admin' | 'staff' | null = null,
  mfaVerified?: boolean,
) {
  const token = app.jwt.sign({
    sub: userId,
    email: `${userId}@example.com`,
    role,
    tenantId: tenantRole ? 'tenant_1' : null,
    tenantRole,
    mfaVerified: mfaVerified
      ?? (role === 'super_admin' || tenantRole === 'tenant_admin'),
  });
  return { authorization: `Bearer ${token}` };
}

describe('Tenant routes', () => {
  it('blocks non-super-admin access', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: authHeader('manager_1', 'manager'),
    });

    expect(res.statusCode).toBe(403);
    expect(listTenants).not.toHaveBeenCalled();
  });

  it('lists tenants for super-admin', async () => {
    listTenants.mockResolvedValueOnce({
      data: [
        {
          id: 'tenant_1',
          name: 'Acme Care',
          slug: 'acme-care',
          country: 'UK',
          isActive: true,
          createdAt: '2026-03-12T10:00:00.000Z',
          updatedAt: '2026-03-12T10:00:00.000Z',
        },
      ],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants?page=1&pageSize=20',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(listTenants).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: [{ id: 'tenant_1', slug: 'acme-care' }],
    });
  });

  it('creates a tenant for super-admin', async () => {
    createTenant.mockResolvedValueOnce({
      tenant: {
        id: 'tenant_2',
        name: 'North Homes',
        slug: 'north-homes',
        country: 'UK',
        isActive: true,
        createdAt: '2026-03-12T10:00:00.000Z',
        updatedAt: '2026-03-12T10:00:00.000Z',
      },
      adminMembership: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: authHeader('super_1', 'super_admin'),
      payload: {
        name: 'North Homes',
        country: 'UK',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createTenant).toHaveBeenCalledWith('super_1', {
      name: 'North Homes',
      country: 'UK',
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: { tenant: { slug: 'north-homes' } },
    });
  });

  it('provisions a staff member', async () => {
    provisionStaff.mockResolvedValueOnce({
      user: {
        id: 'staff_new',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
      },
      membership: {
        id: 'membership_staff_1',
        tenantId: 'tenant_1',
        userId: 'staff_new',
        role: 'staff',
        status: 'invited',
        invitedById: 'admin_1',
        user: null,
        createdAt: '2026-03-12T10:00:00.000Z',
        updatedAt: '2026-03-12T10:00:00.000Z',
      },
      tenantName: 'Acme Care',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant_1/staff',
      headers: authHeader('admin_1', 'admin', 'tenant_admin'),
      payload: {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(provisionStaff).toHaveBeenCalledWith('admin_1', 'admin', 'tenant_1', {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      role: 'staff',
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: { user: { email: 'jane@example.com' }, tenantName: 'Acme Care' },
    });
  });

  it('validates tenant membership request body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant_1/memberships',
      headers: authHeader(),
      payload: {
        role: 'tenant_admin',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      success: false,
      error: { code: 'FST_ERR_VALIDATION' },
    });
    expect(addTenantMembership).not.toHaveBeenCalled();
  });

  it('lists tenant memberships for scoped actor', async () => {
    listTenantMemberships.mockResolvedValueOnce({
      data: [
        {
          id: 'membership_1',
          tenantId: 'tenant_1',
          userId: 'user_1',
          role: 'staff',
          status: 'active',
          invitedById: 'admin_1',
          user: null,
          createdAt: '2026-03-12T10:00:00.000Z',
          updatedAt: '2026-03-12T10:00:00.000Z',
        },
      ],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant_1/memberships?page=1&pageSize=20',
      headers: authHeader('admin_1', 'admin'),
    });

    expect(res.statusCode).toBe(200);
    expect(listTenantMemberships).toHaveBeenCalledWith('admin_1', 'admin', 'tenant_1', {
      page: 1,
      pageSize: 20,
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: [{ id: 'membership_1', role: 'staff' }],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });
  });

  it('adds tenant membership for scoped actor', async () => {
    addTenantMembership.mockResolvedValueOnce({
      id: 'membership_new',
      tenantId: 'tenant_1',
      userId: 'user_77',
      role: 'staff',
      status: 'active',
      invitedById: 'admin_1',
      user: null,
      createdAt: '2026-03-12T10:00:00.000Z',
      updatedAt: '2026-03-12T10:00:00.000Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant_1/memberships',
      headers: authHeader('admin_1', 'admin'),
      payload: {
        email: 'user_77@example.com',
        role: 'staff',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(addTenantMembership).toHaveBeenCalledWith('admin_1', 'admin', 'tenant_1', {
      email: 'user_77@example.com',
      role: 'staff',
      status: 'active',
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: { id: 'membership_new', role: 'staff' },
    });
  });

  it('updates tenant membership status', async () => {
    updateTenantMembership.mockResolvedValueOnce({
      id: 'membership_1',
      tenantId: 'tenant_1',
      userId: 'user_22',
      role: 'tenant_admin',
      status: 'suspended',
      invitedById: 'super_1',
      createdAt: '2026-03-12T10:00:00.000Z',
      updatedAt: '2026-03-12T10:00:00.000Z',
      user: null,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tenants/tenant_1/memberships/membership_1',
      headers: authHeader('super_1', 'super_admin'),
      payload: {
        status: 'suspended',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(updateTenantMembership).toHaveBeenCalledWith(
      'super_1',
      'super_admin',
      'tenant_1',
      'membership_1',
      { status: 'suspended' },
    );
    expect(res.json()).toMatchObject({
      success: true,
      data: { status: 'suspended' },
    });
  });

  it('fetches tenant details', async () => {
    getTenantById.mockResolvedValueOnce({
      id: 'tenant_1',
      name: 'Acme Care',
      slug: 'acme-care',
      country: 'UK',
      isActive: true,
      createdAt: '2026-03-12T10:00:00.000Z',
      updatedAt: '2026-03-12T10:00:00.000Z',
      memberships: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant_1',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(getTenantById).toHaveBeenCalledWith('tenant_1');
    expect(res.json()).toMatchObject({
      success: true,
      data: { id: 'tenant_1', memberships: [] },
    });
  });

  it('creates tenant invite for super-admin', async () => {
    createTenantInvite.mockResolvedValueOnce({
      invite: {
        id: 'invite_1',
        tenantId: 'tenant_1',
        email: 'newstaff@example.com',
        role: 'staff',
        status: 'pending',
        invitedById: 'super_1',
        acceptedByUserId: null,
        expiresAt: '2026-03-19T10:00:00.000Z',
        acceptedAt: null,
        revokedAt: null,
        createdAt: '2026-03-12T10:00:00.000Z',
        updatedAt: '2026-03-12T10:00:00.000Z',
      },
      inviteToken: 'token_abc',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/tenant_1/invites',
      headers: authHeader('super_1', 'super_admin'),
      payload: {
        email: 'newstaff@example.com',
        role: 'staff',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(createTenantInvite).toHaveBeenCalledWith('super_1', 'super_admin', 'tenant_1', {
      email: 'newstaff@example.com',
      role: 'staff',
      expiresInHours: 168,
    });
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        invite: { id: 'invite_1', status: 'pending' },
        inviteToken: 'token_abc',
      },
    });
  });

  it('accepts tenant invite for authenticated user', async () => {
    acceptTenantInvite.mockResolvedValueOnce({
      membership: {
        id: 'membership_22',
        tenantId: 'tenant_1',
        userId: 'user_22',
        role: 'staff',
        status: 'active',
        invitedById: 'super_1',
        user: null,
        createdAt: '2026-03-12T10:00:00.000Z',
        updatedAt: '2026-03-12T10:00:00.000Z',
      },
      invite: {
        id: 'invite_22',
        tenantId: 'tenant_1',
        email: 'user_22@example.com',
        role: 'staff',
        status: 'accepted',
        invitedById: 'super_1',
        acceptedByUserId: 'user_22',
        expiresAt: '2026-03-19T10:00:00.000Z',
        acceptedAt: '2026-03-12T11:00:00.000Z',
        revokedAt: null,
        createdAt: '2026-03-12T10:00:00.000Z',
        updatedAt: '2026-03-12T11:00:00.000Z',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/invites/accept',
      headers: authHeader('user_22', 'staff'),
      payload: { token: '12345678901234567890' },
    });

    expect(res.statusCode).toBe(200);
    expect(acceptTenantInvite).toHaveBeenCalledWith(
      'user_22',
      'user_22@example.com',
      { token: '12345678901234567890' },
    );
    expect(res.json()).toMatchObject({
      success: true,
      data: {
        membership: { tenantId: 'tenant_1' },
        invite: { status: 'accepted' },
      },
    });
  });

  it('lists tenant invites', async () => {
    listTenantInvites.mockResolvedValueOnce({
      data: [],
      meta: { total: 0, page: 1, pageSize: 20, totalPages: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/tenant_1/invites?page=1&pageSize=20',
      headers: authHeader('super_1', 'super_admin'),
    });

    expect(res.statusCode).toBe(200);
    expect(listTenantInvites).toHaveBeenCalledWith('super_1', 'super_admin', 'tenant_1', {
      page: 1,
      pageSize: 20,
    });
  });

  it('revokes invite', async () => {
    revokeTenantInvite.mockResolvedValueOnce({
      id: 'invite_1',
      tenantId: 'tenant_1',
      email: 'newstaff@example.com',
      role: 'staff',
      status: 'revoked',
      invitedById: 'super_1',
      acceptedByUserId: null,
      expiresAt: '2026-03-19T10:00:00.000Z',
      acceptedAt: null,
      revokedAt: '2026-03-12T10:05:00.000Z',
      createdAt: '2026-03-12T10:00:00.000Z',
      updatedAt: '2026-03-12T10:05:00.000Z',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/tenants/tenant_1/invites/invite_1/revoke',
      headers: authHeader('super_1', 'super_admin'),
    });

    expect(res.statusCode).toBe(200);
    expect(revokeTenantInvite).toHaveBeenCalledWith('super_1', 'super_admin', 'tenant_1', 'invite_1');
    expect(res.json()).toMatchObject({
      success: true,
      data: { status: 'revoked' },
    });
  });
});
