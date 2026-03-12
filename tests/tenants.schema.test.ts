import { describe, expect, it } from 'vitest';
import {
  AcceptTenantInviteBodySchema,
  AddTenantMemberBodySchema,
  CreateTenantInviteBodySchema,
  CreateTenantBodySchema,
  ListTenantInvitesQuerySchema,
  UpdateTenantMemberBodySchema,
} from '../src/modules/tenants/tenants.schema.js';

describe('tenants schema contracts', () => {
  it('accepts valid tenant creation payload', () => {
    const result = CreateTenantBodySchema.safeParse({
      name: 'Acme Care',
      country: 'UK',
      adminEmail: 'owner@example.com',
    });

    expect(result.success).toBe(true);
  });

  it('rejects tenant creation payload with both admin identifiers', () => {
    const result = CreateTenantBodySchema.safeParse({
      name: 'Acme Care',
      adminUserId: 'user_1',
      adminEmail: 'owner@example.com',
    });

    expect(result.success).toBe(false);
  });

  it('accepts adding membership with email', () => {
    const result = AddTenantMemberBodySchema.safeParse({
      email: 'staff@example.com',
      role: 'staff',
    });

    expect(result.success).toBe(true);
  });

  it('rejects adding membership without user identifier', () => {
    const result = AddTenantMemberBodySchema.safeParse({
      role: 'staff',
    });

    expect(result.success).toBe(false);
  });

  it('requires role/status changes when patching membership', () => {
    const result = UpdateTenantMemberBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts valid tenant invite payload', () => {
    const result = CreateTenantInviteBodySchema.safeParse({
      email: 'person@example.com',
      role: 'staff',
      expiresInHours: 72,
    });
    expect(result.success).toBe(true);
  });

  it('rejects short invite token', () => {
    const result = AcceptTenantInviteBodySchema.safeParse({
      token: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('accepts list invite query defaults', () => {
    const result = ListTenantInvitesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });
});
