import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, sendOtpEmail, generateRefreshToken, refreshExpiresAt } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../src/lib/email.js', () => ({ sendOtpEmail }));
vi.mock('../src/lib/tokens.js', () => ({ generateRefreshToken, refreshExpiresAt }));

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
  mockPrisma.$transaction.mockImplementation(async (operations: Array<Promise<unknown>>) =>
    Promise.all(operations),
  );
});

describe('auth.service', () => {
  it('register returns sent delivery status when OTP email dispatch succeeds', async () => {
    const createdUser = makeUser({ id: 'user_new' });
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.user.create.mockResolvedValueOnce(createdUser);
    mockPrisma.otpCode.create.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});
    sendOtpEmail.mockResolvedValueOnce(undefined);

    const result = await authService.register({
      country: 'UK',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      acceptTerms: true,
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
    mockPrisma.user.create.mockResolvedValueOnce(createdUser);
    mockPrisma.otpCode.create.mockResolvedValueOnce({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});
    sendOtpEmail.mockRejectedValueOnce(new Error('provider-down'));

    const result = await authService.register({
      country: 'UK',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      acceptTerms: true,
    });

    expect(result).toMatchObject({
      userId: 'user_failed',
      otpDeliveryStatus: 'failed',
      message: 'Account created, but OTP delivery failed. Please use resend.',
    });
    expect(new Date(result.resendAvailableAt).toString()).not.toBe('Invalid Date');
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
});
