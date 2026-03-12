import { randomInt } from 'crypto';
import { OtpPurpose, AuditAction, MembershipStatus, TenantRole, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { sendOtpEmail } from '../../lib/email.js';
import { generateRefreshToken, refreshExpiresAt } from '../../lib/tokens.js';
import { httpError } from '../../lib/errors.js';
import { reconcileExpiredBreakGlassAccess } from '../../lib/break-glass.js';
import {
  hashPassword,
  normalizePasswordCheckTiming,
  verifyPassword,
} from '../../lib/password.js';
import type {
  RegisterBody,
  VerifyOtpBody,
  VerifyMfaChallengeBody,
  ResendOtpBody,
  LoginBody,
  RefreshBody,
  ForgotPasswordBody,
  ResetPasswordBody,
} from './auth.schema.js';

// ─── Constants ────────────────────────────────────────────────────────────────

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

function mfaChallengeMessageFor(status: OtpDeliveryStatus): string {
  switch (status) {
    case 'sent':
      return 'MFA code sent to your email.';
    case 'queued':
      return "MFA code generated and being sent now.";
    case 'failed':
      return 'MFA code generated, but delivery failed. Please try again.';
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
  role: 'super_admin' | 'staff' | 'manager' | 'admin';
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
  aiAccessEnabled: boolean;
  activeTenantId: string | null;
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
    aiAccessEnabled: user.aiAccessEnabled,
    activeTenantId: user.activeTenantId,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export interface AuthSessionMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantRole: TenantRole;
}

export interface AuthSessionContext {
  activeTenantId: string | null;
  activeTenantRole: TenantRole | null;
  memberships: AuthSessionMembership[];
  mfaRequired: boolean;
  mfaVerified: boolean;
}

async function resolveAuthSessionContext(args: {
  userId: string;
  userRole: UserRole;
  currentActiveTenantId: string | null;
  preferredTenantId?: string | null;
}): Promise<AuthSessionContext> {
  const effectiveActiveTenantId = await reconcileExpiredBreakGlassAccess({
    userId: args.userId,
    userRole: args.userRole,
    activeTenantId: args.currentActiveTenantId,
  });

  if (args.userRole === UserRole.super_admin) {
    return {
      activeTenantId: effectiveActiveTenantId,
      activeTenantRole: null,
      memberships: [],
      mfaRequired: true,
      mfaVerified: false,
    };
  }

  const memberships = await prisma.tenantMembership.findMany({
    where: {
      userId: args.userId,
      status: MembershipStatus.active,
      tenant: { isActive: true },
    },
    select: {
      tenantId: true,
      role: true,
      tenant: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const mappedMemberships: AuthSessionMembership[] = memberships.map((membership) => ({
    tenantId: membership.tenantId,
    tenantName: membership.tenant.name,
    tenantSlug: membership.tenant.slug,
    tenantRole: membership.role,
  }));

  const preferredMembership = args.preferredTenantId
    ? mappedMemberships.find((membership) => membership.tenantId === args.preferredTenantId) ?? null
    : null;
  const currentMembership = effectiveActiveTenantId
    ? mappedMemberships.find((membership) => membership.tenantId === effectiveActiveTenantId) ?? null
    : null;
  const selectedMembership = preferredMembership ?? currentMembership ?? mappedMemberships[0] ?? null;
  const resolvedActiveTenantId = selectedMembership?.tenantId ?? null;
  const mfaRequired = selectedMembership?.tenantRole === TenantRole.tenant_admin;
  const mfaVerified = !mfaRequired;

  if (effectiveActiveTenantId !== resolvedActiveTenantId) {
    await prisma.user.update({
      where: { id: args.userId },
      data: { activeTenantId: resolvedActiveTenantId },
    });
  }

  return {
    activeTenantId: resolvedActiveTenantId,
    activeTenantRole: selectedMembership?.tenantRole ?? null,
    memberships: mappedMemberships,
    mfaRequired,
    mfaVerified,
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

  const passwordHash = await hashPassword(body.password);

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

  const session = await resolveAuthSessionContext({
    userId: updatedUser.id,
    userRole: updatedUser.role,
    currentActiveTenantId: updatedUser.activeTenantId,
  });

  return {
    user: { ...safeUser(updatedUser), activeTenantId: session.activeTenantId },
    refreshToken,
    session,
  };
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
 * Starts a privileged-session MFA challenge by issuing a one-time code.
 * Only super_admin or tenant_admin sessions can request this challenge.
 */
export async function requestMfaChallenge(actorUserId: string) {
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      emailVerified: true,
      activeTenantId: true,
    },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }
  if (!user.isActive) {
    throw httpError(403, 'ACCOUNT_INACTIVE', 'Account is disabled.');
  }
  if (!user.emailVerified) {
    throw httpError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first.');
  }

  const session = await resolveAuthSessionContext({
    userId: user.id,
    userRole: user.role,
    currentActiveTenantId: user.activeTenantId,
  });
  if (!session.mfaRequired) {
    throw httpError(400, 'MFA_NOT_REQUIRED', 'MFA challenge is not required for this session.');
  }

  const recent = await prisma.otpCode.findFirst({
    where: { userId: user.id, purpose: OtpPurpose.mfa_challenge },
    orderBy: { createdAt: 'desc' },
  });

  if (recent) {
    const elapsedMs = Date.now() - recent.createdAt.getTime();
    if (elapsedMs < OTP_COOLDOWN_MS) {
      const remainingSec = Math.ceil((OTP_COOLDOWN_MS - elapsedMs) / 1_000);
      throw httpError(
        429,
        'OTP_COOLDOWN',
        `Please wait ${remainingSec} seconds before requesting a new MFA code.`,
      );
    }

    await prisma.otpCode.updateMany({
      where: { userId: user.id, purpose: OtpPurpose.mfa_challenge, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  const code = generateOtpCode();
  await prisma.otpCode.create({
    data: {
      userId: user.id,
      code,
      purpose: OtpPurpose.mfa_challenge,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
    },
  });

  const otpDeliveryStatus = await dispatchOtp(user.email, code, OtpPurpose.mfa_challenge);

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: AuditAction.login,
      entityType: 'auth_mfa',
      entityId: user.id,
      metadata: {
        type: 'mfa_challenge_requested',
        activeTenantId: session.activeTenantId,
        activeTenantRole: session.activeTenantRole,
      },
    },
  });

  return {
    message: mfaChallengeMessageFor(otpDeliveryStatus),
    cooldownSeconds: OTP_COOLDOWN_MS / 1_000,
    otpDeliveryStatus,
    resendAvailableAt: isoAfter(OTP_COOLDOWN_MS),
  };
}

/**
 * Completes a privileged-session MFA challenge.
 * Returns refreshed session context and expects the route to sign a new access token.
 */
export async function verifyMfaChallenge(actorUserId: string, body: VerifyMfaChallengeBody) {
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }
  if (!user.isActive) {
    throw httpError(403, 'ACCOUNT_INACTIVE', 'Account is disabled.');
  }

  const session = await resolveAuthSessionContext({
    userId: user.id,
    userRole: user.role,
    currentActiveTenantId: user.activeTenantId,
  });
  if (!session.mfaRequired) {
    throw httpError(400, 'MFA_NOT_REQUIRED', 'MFA challenge is not required for this session.');
  }

  const otp = await prisma.otpCode.findFirst({
    where: {
      userId: user.id,
      purpose: OtpPurpose.mfa_challenge,
      code: body.code,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  if (!otp) {
    throw httpError(400, 'OTP_INVALID', 'OTP is invalid, expired, or already used.');
  }

  await prisma.$transaction([
    prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        action: AuditAction.otp_verified,
        entityType: 'auth_mfa',
        entityId: user.id,
        metadata: {
          purpose: OtpPurpose.mfa_challenge,
          activeTenantId: session.activeTenantId,
          activeTenantRole: session.activeTenantRole,
        },
      },
    }),
  ]);

  return {
    user: { ...safeUser(user), activeTenantId: session.activeTenantId },
    session: {
      ...session,
      mfaVerified: true,
    },
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
    await normalizePasswordCheckTiming(body.password);
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw httpError(403, 'ACCOUNT_LOCKED', 'Account is temporarily locked. Please try again later.');
  }

  if (!user.isActive) {
    throw httpError(403, 'ACCOUNT_INACTIVE', 'Account is disabled.');
  }

  const passwordCheck = await verifyPassword(body.password, user.passwordHash);
  if (!passwordCheck.match) {
    const newFailed = user.failedAttempts + 1;
    const lockedUntil = newFailed >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MS)
      : null;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: newFailed,
          ...(lockedUntil ? { lockedUntil } : {}),
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.login,
          entityType: 'auth_login_failed',
          metadata: {
            failedAttempts: newFailed,
            accountLocked: Boolean(lockedUntil),
          },
        },
      }),
    ]);
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (!user.emailVerified) {
    throw httpError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address before logging in.');
  }

  const maybeRehashedPassword = passwordCheck.needsRehash
    ? await hashPassword(body.password)
    : null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      ...(maybeRehashedPassword ? { passwordHash: maybeRehashedPassword } : {}),
    },
  });

  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt: refreshExpiresAt() },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, action: AuditAction.login },
  });

  const session = await resolveAuthSessionContext({
    userId: user.id,
    userRole: user.role,
    currentActiveTenantId: user.activeTenantId,
  });

  return {
    user: { ...safeUser(user), activeTenantId: session.activeTenantId },
    refreshToken,
    session,
  };
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
  const session = await resolveAuthSessionContext({
    userId: user.id,
    userRole: user.role,
    currentActiveTenantId: user.activeTenantId,
  });
  return { ...safeUser(user), activeTenantId: session.activeTenantId };
}

/**
 * Switches the authenticated user to an active tenant they belong to and
 * returns refreshed session context for token re-issuance.
 */
export async function switchTenant(actorUserId: string, tenantId: string) {
  const user = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      email: true,
      role: true,
      firstName: true,
      middleName: true,
      lastName: true,
      gender: true,
      country: true,
      phoneNumber: true,
      avatarUrl: true,
      language: true,
      timezone: true,
      emailVerified: true,
      acceptedTerms: true,
      isActive: true,
      aiAccessEnabled: true,
      activeTenantId: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  if (!user.isActive) {
    throw httpError(403, 'ACCOUNT_INACTIVE', 'Account is disabled.');
  }

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      userId: actorUserId,
      tenantId,
      status: MembershipStatus.active,
      tenant: { isActive: true },
    },
    select: { role: true },
  });

  if (!membership) {
    throw httpError(
      403,
      'TENANT_ACCESS_DENIED',
      'You do not have active access to the requested tenant.',
    );
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: actorUserId },
      data: { activeTenantId: tenantId },
    }),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: AuditAction.permission_changed,
        entityType: 'auth_session',
        entityId: actorUserId,
        metadata: { type: 'tenant_switched', tenantId, tenantRole: membership.role },
      },
    }),
  ]);

  const session = await resolveAuthSessionContext({
    userId: actorUserId,
    userRole: user.role,
    currentActiveTenantId: tenantId,
    preferredTenantId: tenantId,
  });

  return {
    user: { ...safeUser(user), activeTenantId: session.activeTenantId },
    session,
  };
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

  const session = await resolveAuthSessionContext({
    userId: stored.user.id,
    userRole: stored.user.role,
    currentActiveTenantId: stored.user.activeTenantId,
  });

  return {
    user: { ...safeUser(stored.user), activeTenantId: session.activeTenantId },
    newRefreshToken: newRawToken,
    session,
  };
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

  const newPasswordHash = await hashPassword(body.newPassword);

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
