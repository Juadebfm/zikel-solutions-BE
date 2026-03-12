import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { OtpPurpose, AuditAction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { sendOtpEmail } from '../../lib/email.js';
import { generateRefreshToken, refreshExpiresAt } from '../../lib/tokens.js';
import { httpError } from '../../lib/errors.js';
import type {
  RegisterBody,
  VerifyOtpBody,
  ResendOtpBody,
  LoginBody,
  RefreshBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from './auth.schema.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_COST = 12;
const OTP_EXPIRY_MS = 10 * 60 * 1_000; // 10 minutes
const OTP_COOLDOWN_MS = 60 * 1_000;    // 60 seconds between resends
const OTP_EMAIL_WAIT_MS = 1_200;       // wait briefly for provider ack, then return queued
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1_000;   // 30 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a random 6-digit string (100000–999999). */
function generateOtpCode(): string {
  return randomInt(100_000, 1_000_000).toString();
}

type OtpIdentifier = { userId: string } | { email: string };

async function findUserByOtpIdentifier(identifier: OtpIdentifier) {
  if ('userId' in identifier) {
    return prisma.user.findUnique({ where: { id: identifier.userId } });
  }
  return prisma.user.findUnique({ where: { email: identifier.email } });
}

function resolveOtpPurpose(body: VerifyOtpBody | ResendOtpBody): OtpPurpose {
  if ('purpose' in body && body.purpose) {
    return body.purpose as OtpPurpose;
  }
  return OtpPurpose.email_verification;
}

type OtpDeliveryStatus = 'sent' | 'queued' | 'failed';

function isoAfter(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function registerMessageFor(status: OtpDeliveryStatus): string {
  switch (status) {
    case 'sent':
      return 'OTP sent to your email address.';
    case 'queued':
      return "Account created. We're sending your OTP now.";
    case 'failed':
      return 'Account created, but OTP delivery failed. Please use resend.';
  }
}

function resendMessageFor(status: OtpDeliveryStatus): string {
  switch (status) {
    case 'sent':
      return 'A new OTP has been sent to your email.';
    case 'queued':
      return "A new OTP has been created and is being sent now.";
    case 'failed':
      return 'A new OTP was created, but delivery failed. Please try resend again shortly.';
  }
}

async function dispatchOtp(
  email: string,
  code: string,
  purpose: OtpPurpose,
): Promise<OtpDeliveryStatus> {
  return new Promise<OtpDeliveryStatus>((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('queued');
    }, OTP_EMAIL_WAIT_MS);

    sendOtpEmail(email, code, purpose)
      .then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve('sent');
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve('failed');
      });
  });
}

/**
 * Strips sensitive fields from a Prisma User before sending it over the wire.
 * Returns a plain object so it serialises cleanly to JSON.
 */
function safeUser(user: {
  id: string;
  email: string;
  role: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string | null;
  country: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  language: string;
  timezone: string;
  emailVerified: boolean;
  acceptedTerms: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName,
    gender: user.gender,
    country: user.country,
    phoneNumber: user.phoneNumber,
    avatarUrl: user.avatarUrl,
    language: user.language,
    timezone: user.timezone,
    emailVerified: user.emailVerified,
    acceptedTerms: user.acceptedTerms,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Step 1–3 of the signup flow.
 * Creates a pending user (emailVerified: false) and initiates 6-digit OTP delivery.
 */
export async function register(body: RegisterBody) {
  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) {
    throw httpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);

  const user = await prisma.user.create({
    data: {
      email: body.email,
      passwordHash,
      firstName: body.firstName,
      middleName: body.middleName ?? null,
      lastName: body.lastName,
      gender: (body.gender ?? null) as 'male' | 'female' | 'other' | null,
      country: body.country as 'UK' | 'Nigeria',
      phoneNumber: body.phoneNumber ?? null,
      acceptedTerms: body.acceptTerms as boolean,
      emailVerified: false,
    },
  });

  const code = generateOtpCode();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      code,
      purpose: OtpPurpose.email_verification,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    },
  });

  const otpDeliveryStatus = await dispatchOtp(
    body.email,
    code,
    OtpPurpose.email_verification,
  );

  await prisma.auditLog.create({
    data: { userId: user.id, action: AuditAction.register },
  });

  return {
    userId: user.id,
    message: registerMessageFor(otpDeliveryStatus),
    otpDeliveryStatus,
    resendAvailableAt: isoAfter(OTP_COOLDOWN_MS),
  };
}

export async function checkEmailAvailability(email: string) {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return { available: !existing };
}

/**
 * Validates the 6-digit OTP, activates the account (for email_verification),
 * and returns the safe user + a raw refresh token for the caller to use.
 *
 * The caller (route handler) is responsible for signing the JWT access token.
 */
export async function verifyOtp(body: VerifyOtpBody) {
  const user = await findUserByOtpIdentifier(body);
  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  const purpose = resolveOtpPurpose(body);

  const otp = await prisma.otpCode.findFirst({
    where: {
      userId: user.id,
      code: body.code,
      purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!otp) {
    throw httpError(400, 'OTP_INVALID', 'OTP is invalid, expired, or already used.');
  }

  // Mark OTP consumed
  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });

  // Activate account on email verification
  let updatedUser = user;
  if (purpose === OtpPurpose.email_verification) {
    updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
  }

  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: refreshExpiresAt() },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, action: AuditAction.otp_verified },
  });

  return { user: safeUser(updatedUser), refreshToken };
}

/**
 * Issues a fresh OTP, invalidating any previous unused ones.
 * Enforces a 60-second cooldown between requests.
 */
export async function resendOtp(body: ResendOtpBody) {
  const user = await findUserByOtpIdentifier(body);
  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  const purpose = resolveOtpPurpose(body);

  const recent = await prisma.otpCode.findFirst({
    where: { userId: user.id, purpose },
    orderBy: { createdAt: 'desc' },
  });

  if (recent) {
    const elapsedMs = Date.now() - recent.createdAt.getTime();
    if (elapsedMs < OTP_COOLDOWN_MS) {
      const remainingSec = Math.ceil((OTP_COOLDOWN_MS - elapsedMs) / 1_000);
      throw httpError(
        429,
        'OTP_COOLDOWN',
        `Please wait ${remainingSec} seconds before requesting a new OTP.`,
      );
    }
    // Invalidate all previous unused OTPs for this user + purpose
    await prisma.otpCode.updateMany({
      where: { userId: user.id, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  const code = generateOtpCode();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      code,
      purpose,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    },
  });

  const otpDeliveryStatus = await dispatchOtp(user.email, code, purpose);

  return {
    message: resendMessageFor(otpDeliveryStatus),
    cooldownSeconds: OTP_COOLDOWN_MS / 1_000,
    otpDeliveryStatus,
    resendAvailableAt: isoAfter(OTP_COOLDOWN_MS),
  };
}

/**
 * Authenticates a user by email + password.
 * Enforces account lockout after 5 consecutive failures (30-minute window).
 * Returns the safe user + a raw refresh token for the caller to use.
 */
export async function login(body: LoginBody) {
  const user = await prisma.user.findUnique({ where: { email: body.email } });

  if (!user) {
    // Constant-time dummy compare to prevent user-enumeration via timing
    await bcrypt.compare(body.password, '$2a$12$invalidhashfortimingnormalisati');
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw httpError(403, 'ACCOUNT_LOCKED', 'Account is temporarily locked. Please try again later.');
  }

  if (!user.isActive) {
    throw httpError(403, 'ACCOUNT_INACTIVE', 'Account is disabled.');
  }

  const passwordMatch = await bcrypt.compare(body.password, user.passwordHash);
  if (!passwordMatch) {
    const newFailed = user.failedAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: newFailed,
        ...(newFailed >= MAX_FAILED_ATTEMPTS
          ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
          : {}),
      },
    });
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (!user.emailVerified) {
    throw httpError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address before logging in.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: refreshExpiresAt() },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, action: AuditAction.login },
  });

  return { user: safeUser(user), refreshToken };
}

/**
 * Revokes the provided refresh token for the authenticated user.
 * Idempotent — silently succeeds if the token is not found.
 */
export async function logout(refreshToken: string, actorUserId: string) {
  const result = await prisma.refreshToken.updateMany({
    where: { token: refreshToken, userId: actorUserId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (result.count > 0) {
    await prisma.auditLog.create({
      data: { userId: actorUserId, action: AuditAction.logout },
    });
  }
}

/**
 * Returns the authenticated user's profile (sensitive fields excluded).
 */
export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  return safeUser(user);
}

/**
 * Validates an existing refresh token, revokes it, and issues a new token pair
 * (access token + rotated refresh token).
 *
 * Implements single-use token rotation: each refresh token can only be used once.
 * A revoked token arriving here indicates a possible replay attack — the 401 response
 * signals the client to force a full re-login.
 *
 * The caller (route handler) is responsible for signing the JWT access token.
 */
export async function refreshAccessToken(body: RefreshBody) {
  const stored = await prisma.refreshToken.findUnique({
    where: { token: body.refreshToken },
    include: { user: true },
  });

  if (!stored || stored.revokedAt !== null || stored.expiresAt < new Date()) {
    throw httpError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token is invalid or expired.');
  }

  if (!stored.user.isActive) {
    throw httpError(403, 'ACCOUNT_INACTIVE', 'Account is disabled.');
  }

  const newRawToken = generateRefreshToken();

  // Atomic rotation: revoke the old token and create the new one in a single transaction.
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        token: newRawToken,
        expiresAt: refreshExpiresAt(),
      },
    }),
  ]);

  // Audit log — reuse 'login' action with metadata to distinguish token refreshes.
  await prisma.auditLog.create({
    data: {
      userId: stored.userId,
      action: AuditAction.login,
      metadata: { type: 'token_refreshed' },
    },
  });

  return { user: safeUser(stored.user), newRefreshToken: newRawToken };
}

/**
 * Initiates the password reset flow.
 * Generates a password_reset OTP and sends it to the given email.
 *
 * Always returns the same response regardless of whether the email is registered,
 * and never reveals cooldown state for existing accounts.
 */
export async function forgotPassword(body: ForgotPasswordBody) {
  const user = await prisma.user.findUnique({ where: { email: body.email } });

  // Silent early-return — do not reveal whether the email exists
  if (!user) {
    return { message: 'If that email is registered, an OTP has been sent.' };
  }

  // Enforce the same cooldown as resend-otp to prevent flooding
  const recent = await prisma.otpCode.findFirst({
    where: { userId: user.id, purpose: OtpPurpose.password_reset },
    orderBy: { createdAt: 'desc' },
  });

  if (recent) {
    const elapsedMs = Date.now() - recent.createdAt.getTime();
    if (elapsedMs < OTP_COOLDOWN_MS) {
      // Return the same generic response to avoid account enumeration via cooldown signals.
      return { message: 'If that email is registered, an OTP has been sent.' };
    }
    // Invalidate all previous unused password_reset OTPs
    await prisma.otpCode.updateMany({
      where: { userId: user.id, purpose: OtpPurpose.password_reset, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  const code = generateOtpCode();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      code,
      purpose: OtpPurpose.password_reset,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    },
  });

  await sendOtpEmail(user.email, code, OtpPurpose.password_reset);

  return { message: 'If that email is registered, an OTP has been sent.' };
}

/**
 * Completes the password reset flow.
 * Verifies the password_reset OTP, hashes the new password, and atomically:
 *   1. Updates the user's passwordHash.
 *   2. Revokes all existing refresh tokens (forces re-login on all devices).
 * Audit logs the password_change action.
 */
export async function resetPassword(body: ResetPasswordBody) {
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user) throw httpError(400, 'OTP_INVALID', 'OTP is invalid, expired, or already used.');

  const otp = await prisma.otpCode.findFirst({
    where: {
      userId: user.id,
      code: body.code,
      purpose: OtpPurpose.password_reset,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!otp) {
    throw httpError(400, 'OTP_INVALID', 'OTP is invalid, expired, or already used.');
  }

  const newPasswordHash = await bcrypt.hash(body.newPassword, BCRYPT_COST);

  // Atomic: mark OTP used + update password + revoke all refresh tokens
  await prisma.$transaction([
    prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash, failedAttempts: 0, lockedUntil: null },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await prisma.auditLog.create({
    data: { userId: user.id, action: AuditAction.password_change },
  });

  return { message: 'Password reset successfully. Please log in with your new password.' };
}
