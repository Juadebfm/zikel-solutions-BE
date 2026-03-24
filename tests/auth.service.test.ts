import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const {
  mockPrisma,
  sendOtpEmail,
  generateRefreshToken,
  refreshExpiresAt,
  refreshIdleExpiresAt,
} = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    tenantMembership: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    otpCode: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  sendOtpEmail: vi.fn(),
  generateRefreshToken: vi.fn(() => 'refresh-token'),
  refreshExpiresAt: vi.fn(() => new Date('2030-01-01T00:00:00.000Z')),
  refreshIdleExpiresAt: vi.fn(() => new Date('2030-01-01T00:15:00.000Z')),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/email.js', () => ({ sendOtpEmail }));
vi.mock('../src/lib/tokens.js', () => ({
  generateRefreshToken,
  refreshExpiresAt,
  refreshIdleExpiresAt,
}));
vi.mock('../src/modules/tenants/tenants.service.js', () => ({
  resolveInviteLinkByCode: vi.fn(),
}));

import * as authService from '../src/modules/auth/auth.service.js';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_1',
    email: 'jane@example.com',
    passwordHash: '$2a$12$invalidhashfortimingnormalisati',
    role: 'staff',
    firstName: 'Jane',
    middleName: null,
    lastName: 'Doe',
    gender: null,
    country: 'UK',
    phoneNumber: null,
    avatarUrl: null,
    language: 'en',
    timezone: 'Europe/London',
    emailVerified: false,
    acceptedTerms: true,
    isActive: true,
    aiAccessEnabled: false,
    activeTenantId: null,
    lastLoginAt: null,
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.tenantMembership.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation(async (operations: Array<Promise<unknown>>) =>
    Promise.all(operations),
  );
});

describe('auth.service', () => {
  it('returns generic email availability response to avoid enumeration', async () => {
    const result = await authService.checkEmailAvailability('jane@example.com');

    expect(result).toEqual({ available: true });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('register returns sent delivery status when OTP email dispatch succeeds', async () => {
    const createdUser = makeUser({ id: 'user_new' });
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.$transaction.mockImplementationOnce(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
    mockPrisma.tenant.create.mockResolvedValueOnce({ id: 'tenant_1', slug: 'sunrise-care', country: 'UK' });
    mockPrisma.user.create.mockResolvedValueOnce(createdUser);
    mockPrisma.tenantMembership.create.mockResolvedValueOnce({});
    mockPrisma.otpCode.create.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    sendOtpEmail.mockResolvedValueOnce(undefined);

    const result = await authService.register({
      country: 'UK',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      acceptTerms: true,
      organizationName: 'Sunrise Care',
    });

    expect(result).toMatchObject({
      userId: 'user_new',
      otpDeliveryStatus: 'sent',
      message: 'OTP sent to your email address.',
    });
    expect(new Date(result.resendAvailableAt).toString()).not.toBe('Invalid Date');
  });

  it('register returns failed delivery status when OTP email dispatch fails', async () => {
    const createdUser = makeUser({ id: 'user_failed' });
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.$transaction.mockImplementationOnce(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
    mockPrisma.tenant.create.mockResolvedValueOnce({ id: 'tenant_2', slug: 'sunset-care', country: 'UK' });
    mockPrisma.user.create.mockResolvedValueOnce(createdUser);
    mockPrisma.tenantMembership.create.mockResolvedValueOnce({});
    mockPrisma.otpCode.create.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    sendOtpEmail.mockRejectedValueOnce(new Error('provider-down'));

    const result = await authService.register({
      country: 'UK',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      acceptTerms: true,
      organizationName: 'Sunset Care',
    });

    expect(result).toMatchObject({
      userId: 'user_failed',
      otpDeliveryStatus: 'failed',
      message: 'Account created, but OTP delivery failed. Please use resend.',
    });
    expect(new Date(result.resendAvailableAt).toString()).not.toBe('Invalid Date');
  });

  it('register maps Prisma email unique conflicts when target is a constraint name', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test-client',
        meta: { target: 'User_email_key' },
      }),
    );

    await expect(
      authService.register({
        country: 'UK',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        acceptTerms: true,
        organizationName: 'Sunset Care',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'EMAIL_TAKEN',
      message: 'An account with this email already exists.',
    });
  });

  it('register maps unknown unique conflicts to a stable registration conflict', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test-client',
        meta: { target: 'tenant_name_unique' },
      }),
    );

    await expect(
      authService.register({
        country: 'UK',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        acceptTerms: true,
        organizationName: 'Sunset Care',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'REGISTRATION_CONFLICT',
      message: 'Unable to complete registration because this account or organization already exists.',
    });
  });

  it('resend OTP returns delivery status and next resend time', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValueOnce(user);
    mockPrisma.otpCode.findFirst.mockResolvedValueOnce(null);
    mockPrisma.otpCode.create.mockResolvedValueOnce({});
    sendOtpEmail.mockResolvedValueOnce(undefined);

    const result = await authService.resendOtp({ email: user.email });

    expect(result).toMatchObject({
      otpDeliveryStatus: 'sent',
      cooldownSeconds: 60,
      message: 'A new OTP has been sent to your email.',
    });
    expect(new Date(result.resendAvailableAt).toString()).not.toBe('Invalid Date');
  });

  it('resend OTP returns generic success for unknown users', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    const result = await authService.resendOtp({ email: 'missing@example.com' });

    expect(result).toMatchObject({
      otpDeliveryStatus: 'queued',
      cooldownSeconds: 60,
      message: 'If that account exists, a new OTP has been created and is being sent now.',
    });
    expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
  });

  it('issues MFA challenge OTP for privileged sessions', async () => {
    const superAdmin = makeUser({
      id: 'super_1',
      role: 'super_admin',
      emailVerified: true,
    });

    mockPrisma.user.findUnique.mockResolvedValueOnce(superAdmin);
    mockPrisma.otpCode.findFirst.mockResolvedValueOnce(null);
    mockPrisma.otpCode.create.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});
    sendOtpEmail.mockResolvedValueOnce(undefined);

    const result = await authService.requestMfaChallenge('super_1');

    expect(mockPrisma.otpCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'super_1',
        purpose: 'mfa_challenge',
      }),
    });
    expect(result).toMatchObject({
      otpDeliveryStatus: 'sent',
      message: 'MFA code sent to your email.',
      cooldownSeconds: 60,
    });
  });

  it('rejects MFA challenge when tenant already completed one-time MFA setup', async () => {
    const tenantAdmin = makeUser({
      id: 'tenant_admin_1',
      role: 'staff',
      activeTenantId: 'tenant_1',
      emailVerified: true,
    });

    mockPrisma.user.findUnique.mockResolvedValueOnce(tenantAdmin);
    mockPrisma.tenantMembership.findMany.mockResolvedValueOnce([
      {
        tenantId: 'tenant_1',
        role: 'tenant_admin',
        tenant: {
          name: 'Cadnamart',
          slug: 'cadnamart',
          mfaSetupCompletedAt: new Date('2026-03-21T13:46:38.804Z'),
        },
      },
    ]);

    await expect(authService.requestMfaChallenge('tenant_admin_1')).rejects.toMatchObject({
      code: 'MFA_NOT_REQUIRED',
    });
    expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
  });

  it('verifies MFA challenge and returns session with mfaVerified=true', async () => {
    const superAdmin = makeUser({
      id: 'super_1',
      role: 'super_admin',
      emailVerified: true,
    });

    mockPrisma.user.findUnique.mockResolvedValueOnce(superAdmin);
    mockPrisma.otpCode.findFirst.mockResolvedValueOnce({ id: 'otp_mfa_1' });
    mockPrisma.otpCode.update.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const result = await authService.verifyMfaChallenge('super_1', { code: '123456' });

    expect(result).toMatchObject({
      user: { id: 'super_1' },
      session: {
        mfaRequired: true,
        mfaVerified: true,
      },
    });
    expect(mockPrisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp_mfa_1' },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('marks tenant MFA setup as completed after first successful tenant-admin verification', async () => {
    const tenantAdmin = makeUser({
      id: 'tenant_admin_1',
      role: 'staff',
      activeTenantId: 'tenant_1',
      emailVerified: true,
    });

    mockPrisma.user.findUnique.mockResolvedValueOnce(tenantAdmin);
    mockPrisma.tenantMembership.findMany.mockResolvedValueOnce([
      {
        tenantId: 'tenant_1',
        role: 'tenant_admin',
        tenant: {
          name: 'Cadnamart',
          slug: 'cadnamart',
          mfaSetupCompletedAt: null,
        },
      },
    ]);
    mockPrisma.otpCode.findFirst.mockResolvedValueOnce({ id: 'otp_mfa_2' });
    mockPrisma.otpCode.update.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});
    mockPrisma.tenant.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await authService.verifyMfaChallenge('tenant_admin_1', { code: '654321' });

    expect(result).toMatchObject({
      user: { id: 'tenant_admin_1' },
      session: {
        activeTenantId: 'tenant_1',
        activeTenantRole: 'tenant_admin',
        mfaVerified: true,
      },
    });
    expect(mockPrisma.tenant.updateMany).toHaveBeenCalledWith({
      where: { id: 'tenant_1', mfaSetupCompletedAt: null },
      data: { mfaSetupCompletedAt: expect.any(Date) },
    });
  });

  it('rejects MFA verify when tenant one-time MFA setup is already completed', async () => {
    const tenantAdmin = makeUser({
      id: 'tenant_admin_1',
      role: 'staff',
      activeTenantId: 'tenant_1',
      emailVerified: true,
    });

    mockPrisma.user.findUnique.mockResolvedValueOnce(tenantAdmin);
    mockPrisma.tenantMembership.findMany.mockResolvedValueOnce([
      {
        tenantId: 'tenant_1',
        role: 'tenant_admin',
        tenant: {
          name: 'Cadnamart',
          slug: 'cadnamart',
          mfaSetupCompletedAt: new Date('2026-03-21T13:46:38.804Z'),
        },
      },
    ]);

    await expect(
      authService.verifyMfaChallenge('tenant_admin_1', { code: '123456' }),
    ).rejects.toMatchObject({
      code: 'MFA_NOT_REQUIRED',
    });
    expect(mockPrisma.otpCode.findFirst).not.toHaveBeenCalled();
  });

  it('verifies OTP using email identifier and issues tokens', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValueOnce(user);
    mockPrisma.otpCode.findFirst.mockResolvedValueOnce({ id: 'otp_1' });
    mockPrisma.otpCode.update.mockResolvedValueOnce({});
    mockPrisma.user.update.mockResolvedValueOnce({ ...user, emailVerified: true });
    mockPrisma.refreshToken.create.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const result = await authService.verifyOtp({
      email: user.email,
      code: '123456',
    });

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: user.email },
    });
    expect(result).toMatchObject({
      refreshToken: 'refresh-token',
      user: { id: user.id, emailVerified: true },
    });
  });

  it('returns OTP_INVALID when verify-otp user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      authService.verifyOtp({
        email: 'missing@example.com',
        code: '123456',
      }),
    ).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
  });

  it('rejects login for inactive accounts', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(
      makeUser({ isActive: false, emailVerified: true }),
    );

    await expect(
      authService.login({ email: 'jane@example.com', password: 'Password123!' }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
    });
  });

  it('does not leak cooldown state during forgot-password', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValueOnce(user);
    mockPrisma.otpCode.findFirst.mockResolvedValueOnce({
      id: 'otp_recent',
      createdAt: new Date(),
    });

    const result = await authService.forgotPassword({ email: user.email });

    expect(result).toEqual({
      message: 'If that email is registered, an OTP has been sent.',
    });
    expect(mockPrisma.otpCode.create).not.toHaveBeenCalled();
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it('resets password using email (not userId) lookup', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValueOnce(user);
    mockPrisma.otpCode.findFirst.mockResolvedValueOnce({ id: 'otp_1' });
    mockPrisma.otpCode.update.mockResolvedValueOnce({});
    mockPrisma.user.update.mockResolvedValueOnce({});
    mockPrisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const result = await authService.resetPassword({
      email: user.email,
      code: '123456',
      newPassword: 'NewPassword1!',
      confirmPassword: 'NewPassword1!',
    });

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: user.email },
    });
    expect(result).toEqual({
      message: 'Password reset successfully. Please log in with your new password.',
    });
  });

  it('revokes only refresh tokens owned by the authenticated user', async () => {
    mockPrisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    await authService.logout('refresh_token_1', 'user_1');

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        token: 'refresh_token_1',
        userId: 'user_1',
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('switches tenant for a user with active membership', async () => {
    const user = makeUser({ id: 'user_switch', emailVerified: true });
    mockPrisma.user.findUnique.mockResolvedValueOnce(user);
    mockPrisma.tenantMembership.findFirst.mockResolvedValueOnce({ role: 'tenant_admin' });
    mockPrisma.user.update.mockResolvedValueOnce({ ...user, activeTenantId: 'tenant_1' });
    mockPrisma.auditLog.create.mockResolvedValueOnce({});
    mockPrisma.tenantMembership.findMany.mockResolvedValueOnce([
      {
        tenantId: 'tenant_1',
        role: 'tenant_admin',
        tenant: { name: 'Acme Care', slug: 'acme-care' },
      },
    ]);

    const result = await authService.switchTenant(user.id, 'tenant_1');

    expect(result).toMatchObject({
      user: { id: 'user_switch', activeTenantId: 'tenant_1' },
      session: {
        activeTenantId: 'tenant_1',
        activeTenantRole: 'tenant_admin',
        memberships: [
          {
            tenantId: 'tenant_1',
            tenantName: 'Acme Care',
            tenantSlug: 'acme-care',
            tenantRole: 'tenant_admin',
          },
        ],
      },
    });
  });

  it('blocks tenant switch when membership is missing', async () => {
    const user = makeUser({ id: 'user_blocked' });
    mockPrisma.user.findUnique.mockResolvedValueOnce(user);
    mockPrisma.tenantMembership.findFirst.mockResolvedValueOnce(null);

    await expect(authService.switchTenant(user.id, 'tenant_404')).rejects.toMatchObject({
      code: 'TENANT_ACCESS_DENIED',
    });
  });
});
