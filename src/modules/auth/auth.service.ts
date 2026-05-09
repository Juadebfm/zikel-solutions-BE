import { randomInt } from 'crypto';
import { Prisma, OtpPurpose, AuditAction, MembershipStatus, TenantRole, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { sendOtpEmail } from '../../lib/email.js';
import { generateRefreshToken, refreshExpiresAt, refreshIdleExpiresAt } from '../../lib/tokens.js';
import { httpError } from '../../lib/errors.js';
import {
  hashPassword,
  normalizePasswordCheckTiming,
  verifyPassword,
} from '../../lib/password.js';
import { seedSystemRolesForTenant } from '../../auth/system-roles.js';
import { tenantHasMfa, verifyTenantTotp, verifyTenantBackupCode } from './mfa.service.js';
import {
  signMfaChallengeToken,
  verifyMfaChallengeToken,
  MFA_CHALLENGE_EXPIRY_SECONDS,
} from '../../auth/mfa-challenge-token.js';
import {
  signMfaEnrollmentToken,
  MFA_ENROLLMENT_EXPIRY_SECONDS,
} from '../../auth/mfa-enrollment-token.js';
import type {
  RegisterBody,
  VerifyOtpBody,
  ResendOtpBody,
  LoginBody,
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
    return prisma.tenantUser.findUnique({ where: { id: identifier.userId } });
  }
  return prisma.tenantUser.findUnique({ where: { email: identifier.email } });
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

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 120);
}

function parseUniqueConstraintTarget(metaTarget: unknown): string[] {
  if (Array.isArray(metaTarget)) {
    return metaTarget.map((item) => String(item).toLowerCase());
  }
  if (typeof metaTarget === 'string') {
    return [metaTarget.toLowerCase()];
  }
  return [];
}

/**
 * Strips sensitive fields from a Prisma User before sending it over the wire.
 * Returns a plain object so it serialises cleanly to JSON.
 */
function safeUser(user: {
  id: string;
  email: string;
  role: 'staff' | 'manager' | 'admin';
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
    acceptedTerms: true,
    isActive: user.isActive,
    aiAccessEnabled: user.aiAccessEnabled,
    activeTenantId: user.activeTenantId,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function createSessionWithRefreshToken(args: {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const absoluteExpiresAt = refreshExpiresAt();
  const idleExpiresAt = refreshIdleExpiresAt();
  const token = generateRefreshToken();

  const session = await prisma.tenantSession.create({
    data: {
      userId: args.userId,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
      absoluteExpiresAt,
      refreshTokens: {
        create: {
          userId: args.userId,
          token,
          idleExpiresAt,
        },
      },
    },
  });

  return {
    sessionId: session.id,
    token,
    absoluteExpiresAt: session.absoluteExpiresAt,
    idleExpiresAt,
  };
}

type RefreshTokenWithSessionState = {
  revokedAt: Date | null;
  idleExpiresAt: Date;
  session: {
    revokedAt: Date | null;
    absoluteExpiresAt: Date;
  };
};

function assertRefreshTokenAndSessionState(
  stored: RefreshTokenWithSessionState,
  now: Date,
) {
  if (stored.revokedAt !== null) {
    throw httpError(
      401,
      'REFRESH_TOKEN_REUSED',
      'Refresh token has already been used. Please sign in again.',
    );
  }

  if (stored.session.revokedAt !== null) {
    throw httpError(
      401,
      'SESSION_REVOKED',
      'Session has been revoked. Please sign in again.',
    );
  }

  if (stored.session.absoluteExpiresAt <= now) {
    throw httpError(
      401,
      'SESSION_ABSOLUTE_EXPIRED',
      'Session expired due to maximum lifetime. Please sign in again.',
    );
  }

  if (stored.idleExpiresAt <= now) {
    throw httpError(
      401,
      'SESSION_IDLE_EXPIRED',
      'Session expired due to inactivity. Please sign in again.',
    );
  }
}

function asSessionExpiryData(args: {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}) {
  return {
    idleExpiresAt: args.idleExpiresAt,
    absoluteExpiresAt: args.absoluteExpiresAt,
  };
}

export interface AuthSessionMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantRole: TenantRole; // Legacy enum derived from role.name; new code should use permissions.
  roleName: string;
  permissions: string[];
}

export interface AuthSessionContext {
  activeTenantId: string | null;
  activeTenantRole: TenantRole | null;
  activeRoleName: string | null;
  activePermissions: string[];
  memberships: AuthSessionMembership[];
  mfaRequired: boolean;
  mfaVerified: boolean;
}

async function resolveAuthSessionContext(args: {
  userId: string;
  userRole: UserRole;
  currentActiveTenantId: string | null;
  preferredTenantId?: string | null;
  mfaJustVerified?: boolean;
}): Promise<AuthSessionContext> {
  const effectiveActiveTenantId = args.currentActiveTenantId;

  const [memberships, totpEnrolled] = await Promise.all([
    prisma.tenantMembership.findMany({
      where: {
        userId: args.userId,
        status: MembershipStatus.active,
        tenant: { isActive: true },
      },
      select: {
        tenantId: true,
        role: { select: { name: true, permissions: true } },
        tenant: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    tenantHasMfa(args.userId),
  ]);

  const mappedMemberships: AuthSessionMembership[] = memberships.map((membership) => ({
    tenantId: membership.tenantId,
    tenantName: membership.tenant.name,
    tenantSlug: membership.tenant.slug,
    tenantRole: legacyTenantRoleFromName(membership.role.name),
    roleName: membership.role.name,
    permissions: membership.role.permissions,
  }));

  const preferredMembership = args.preferredTenantId
    ? memberships.find((membership) => membership.tenantId === args.preferredTenantId) ?? null
    : null;
  const currentMembership = effectiveActiveTenantId
    ? memberships.find((membership) => membership.tenantId === effectiveActiveTenantId) ?? null
    : null;
  const selectedMembership = preferredMembership ?? currentMembership ?? memberships[0] ?? null;
  const resolvedActiveTenantId = selectedMembership?.tenantId ?? null;

  // Phase 4: Owners must enroll TOTP. mfaRequired flags users who SHOULD have
  // MFA enrolled but don't — frontend should drive them to enrollment.
  const isOwner = selectedMembership?.role.name === 'Owner';
  const mfaRequired = isOwner && !totpEnrolled;
  // mfaVerified is true if MFA isn't required, OR the user just completed
  // a TOTP/backup challenge (the verify endpoints pass mfaJustVerified=true).
  const mfaVerified = !mfaRequired || Boolean(args.mfaJustVerified);

  if (effectiveActiveTenantId !== resolvedActiveTenantId) {
    await prisma.tenantUser.update({
      where: { id: args.userId },
      data: { activeTenantId: resolvedActiveTenantId },
    });
  }

  return {
    activeTenantId: resolvedActiveTenantId,
    activeTenantRole: selectedMembership ? legacyTenantRoleFromName(selectedMembership.role.name) : null,
    activeRoleName: selectedMembership?.role.name ?? null,
    activePermissions: selectedMembership?.role.permissions ?? [],
    memberships: mappedMemberships,
    mfaRequired,
    mfaVerified,
  };
}

// Maps the new Role.name → legacy TenantRole enum for back-compat with the JWT
// claim and middleware that still inspects `tenantRole`. Phase 3.5 migrates those
// consumers to permission-based checks; once that lands, this shim can be removed.
function legacyTenantRoleFromName(roleName: string): TenantRole {
  if (roleName === 'Owner') return TenantRole.tenant_admin;
  if (roleName === 'Admin') return TenantRole.sub_admin;
  return TenantRole.staff;
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Step 1–3 of the signup flow.
 * Creates a pending user (emailVerified: false) and initiates 6-digit OTP delivery.
 */
export async function register(body: RegisterBody) {
  const existing = await prisma.tenantUser.findUnique({ where: { email: body.email } });
  if (existing) {
    throw httpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  }

  const tenantSlug = (body.organizationSlug ?? slugify(body.organizationName)).toLowerCase();
  if (!tenantSlug) {
    throw httpError(422, 'VALIDATION_ERROR', 'Unable to derive slug from organization name.');
  }

  const passwordHash = await hashPassword(body.password);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: body.organizationName,
          slug: tenantSlug,
          country: body.country as 'UK' | 'Nigeria',
        },
      });

      // Seed the four system roles for this brand-new tenant.
      const systemRoles = await seedSystemRolesForTenant(tenant.id, tx);

      const user = await tx.tenantUser.create({
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
          activeTenantId: tenant.id,
        },
      });

      // Registering self-creates the tenant — the registrant is the Owner.
      await tx.tenantMembership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          roleId: systemRoles.Owner,
          status: MembershipStatus.active,
        },
      });

      const otpCode = generateOtpCode();
      await tx.otpCode.create({
        data: {
          userId: user.id,
          code: otpCode,
          purpose: OtpPurpose.email_verification,
          expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
        },
      });

      await tx.auditLog.create({
        data: { userId: user.id, action: AuditAction.register },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.record_created,
          entityType: 'tenant',
          entityId: tenant.id,
          metadata: { slug: tenant.slug, country: tenant.country },
        },
      });

      return { user, tenant, otpCode };
    });

    const otpDeliveryStatus = await dispatchOtp(
      body.email,
      result.otpCode,
      OtpPurpose.email_verification,
    );

    return {
      userId: result.user.id,
      message: registerMessageFor(otpDeliveryStatus),
      otpDeliveryStatus,
      resendAvailableAt: isoAfter(OTP_COOLDOWN_MS),
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = parseUniqueConstraintTarget(error.meta?.target);
      if (target.some((entry) => entry.includes('slug'))) {
        throw httpError(409, 'ORG_SLUG_TAKEN', 'An organization with this slug already exists. Please choose a different name or slug.');
      }
      if (target.some((entry) => entry.includes('email'))) {
        throw httpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
      }
      throw httpError(409, 'REGISTRATION_CONFLICT', 'Unable to complete registration because this account or organization already exists.');
    }
    throw error;
  }
}

// Phase 5: removed legacy `joinViaInviteLink`, `validateInviteLink`, and
// `staffActivate` service functions. Staff onboarding now uses the unified
// Invitation flow — see src/modules/auth/invitations.service.ts and the
// /api/v1/invitations + /api/v1/auth/invitations/:token routes.

export async function checkEmailAvailability(email: string) {
  // Deliberately avoid account enumeration via this public endpoint.
  // Registration is the authoritative uniqueness check.
  void email;
  return { available: true };
}

/**
 * Validates the 6-digit OTP, activates the account (for email_verification),
 * and returns the safe user + a raw refresh token for the caller to use.
 *
 * The caller (route handler) is responsible for signing the JWT access token.
 */
export async function verifyOtp(body: VerifyOtpBody) {
  const user = await findUserByOtpIdentifier(body);
  if (!user) throw httpError(400, 'OTP_INVALID', 'OTP is invalid, expired, or already used.');
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
    updatedUser = await prisma.tenantUser.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
  }

  const refreshToken = await createSessionWithRefreshToken({ userId: user.id });

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
    sessionId: refreshToken.sessionId,
    refreshToken: refreshToken.token,
    session,
    sessionExpiry: asSessionExpiryData({
      idleExpiresAt: refreshToken.idleExpiresAt,
      absoluteExpiresAt: refreshToken.absoluteExpiresAt,
    }),
  };
}

/**
 * Issues a fresh OTP, invalidating any previous unused ones.
 * Enforces a 60-second cooldown between requests.
 */
export async function resendOtp(body: ResendOtpBody) {
  const user = await findUserByOtpIdentifier(body);
  if (!user) {
    return {
      message: 'If that account exists, a new OTP has been created and is being sent now.',
      cooldownSeconds: OTP_COOLDOWN_MS / 1_000,
      otpDeliveryStatus: 'queued' as const,
      resendAvailableAt: isoAfter(OTP_COOLDOWN_MS),
    };
  }
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

// Phase 4: removed legacy email-OTP MFA flow (requestMfaChallenge / verifyMfaChallenge).
// MFA is now TOTP-based — see src/modules/auth/mfa.service.ts and the
// /auth/mfa/totp/* routes. The OtpPurpose.mfa_challenge enum value is left
// in place for backwards-compat but is no longer issued by the service.

/**
 * Authenticates a user by email + password.
 * Enforces account lockout after 5 consecutive failures (30-minute window).
 * Returns the safe user + a raw refresh token for the caller to use.
 */
export async function login(body: LoginBody) {
  const user = await prisma.tenantUser.findUnique({ where: { email: body.email } });

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
      prisma.tenantUser.update({
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

  // Reset lockout state and persist any password rehash up-front — these
  // are intent-of-login signals, not contingent on MFA outcome.
  await prisma.tenantUser.update({
    where: { id: user.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      ...(maybeRehashedPassword ? { passwordHash: maybeRehashedPassword } : {}),
    },
  });

  // ── MFA gate ─────────────────────────────────────────────────────────────
  // Two paths beyond password:
  //  1. User has confirmed TOTP → issue a challenge token (existing flow).
  //  2. User MUST have MFA (Owner role) but has not enrolled → issue an
  //     enrollment token instead of a session. Hard block: no partial session
  //     is ever minted. The enrollment token is single-purpose and only
  //     authorizes /auth/mfa/totp/enroll/* — once enrollment confirms, that
  //     endpoint mints the full session in the same flow.
  const [hasMfa, isPrivileged] = await Promise.all([
    tenantHasMfa(user.id),
    isPrivilegedTenantUser(user.id),
  ]);

  if (hasMfa) {
    return {
      kind: 'mfa-required' as const,
      mfaRequired: true,
      challengeToken: signMfaChallengeToken({ userId: user.id, audience: 'tenant' }),
      challengeExpiresInSeconds: MFA_CHALLENGE_EXPIRY_SECONDS,
    };
  }

  if (isPrivileged) {
    return {
      kind: 'mfa-enrollment-required' as const,
      mfaEnrollmentRequired: true,
      enrollmentToken: signMfaEnrollmentToken({ userId: user.id, audience: 'tenant' }),
      enrollmentExpiresInSeconds: MFA_ENROLLMENT_EXPIRY_SECONDS,
    };
  }

  return finalizeTenantLogin(user.id);
}

/**
 * True if this tenant user holds an Owner role in any active membership.
 * Owners are required to have TOTP enrolled — login hard-blocks until they do.
 */
async function isPrivilegedTenantUser(userId: string): Promise<boolean> {
  const owner = await prisma.tenantMembership.findFirst({
    where: {
      userId,
      status: MembershipStatus.active,
      tenant: { isActive: true },
      role: { name: 'Owner' },
    },
    select: { id: true },
  });
  return Boolean(owner);
}

/**
 * Mints a session for a tenant user whose identity has already been verified
 * (either by password-only login or password + MFA verify). Sets lastLoginAt,
 * creates a session + refresh token, audit-logs, and resolves the AuthSession
 * context for the route layer to sign an access token from.
 *
 * Pass `mfaJustVerified: true` from the MFA verify endpoints so the resulting
 * session is marked as MFA-validated for privileged-mutation gating.
 *
 * Returns the discriminated `kind: 'completed'` shape used by every login
 * downstream (login, MFA verify, backup verify).
 */
export async function finalizeTenantLogin(userId: string, opts?: { mfaJustVerified?: boolean }) {
  const user = await prisma.tenantUser.findUnique({ where: { id: userId } });
  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  await prisma.tenantUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const refreshToken = await createSessionWithRefreshToken({ userId: user.id });

  await prisma.auditLog.create({
    data: { userId: user.id, action: AuditAction.login },
  });

  const session = await resolveAuthSessionContext({
    userId: user.id,
    userRole: user.role,
    currentActiveTenantId: user.activeTenantId,
    ...(opts?.mfaJustVerified ? { mfaJustVerified: true } : {}),
  });

  return {
    kind: 'completed' as const,
    user: { ...safeUser(user), activeTenantId: session.activeTenantId },
    sessionId: refreshToken.sessionId,
    refreshToken: refreshToken.token,
    session,
    sessionExpiry: asSessionExpiryData({
      idleExpiresAt: refreshToken.idleExpiresAt,
      absoluteExpiresAt: refreshToken.absoluteExpiresAt,
    }),
  };
}

/**
 * Exchanges a challenge token + 6-digit TOTP for a full session.
 * Used at /auth/mfa/totp/verify after the password step issued a challenge.
 */
export async function verifyTenantTotpAndLogin(args: {
  challengeToken: string;
  code: string;
}) {
  const userId = verifyMfaChallengeToken({ token: args.challengeToken, expectedAudience: 'tenant' });
  const ok = await verifyTenantTotp({ userId, code: args.code });
  if (!ok) {
    throw httpError(401, 'MFA_CODE_INVALID', 'The code did not match. Try again.');
  }
  return finalizeTenantLogin(userId, { mfaJustVerified: true });
}

/** Exchanges a challenge token + a single-use backup code for a full session. */
export async function verifyTenantBackupAndLogin(args: {
  challengeToken: string;
  code: string;
}) {
  const userId = verifyMfaChallengeToken({ token: args.challengeToken, expectedAudience: 'tenant' });
  const ok = await verifyTenantBackupCode({ userId, code: args.code });
  if (!ok) {
    throw httpError(401, 'MFA_BACKUP_INVALID', 'Backup code is invalid or already used.');
  }
  return finalizeTenantLogin(userId, { mfaJustVerified: true });
}

/**
 * Mints a session for a tenant user who has just completed first-time TOTP
 * enrollment via the enrollment-token flow. The enrollment route is
 * responsible for verifying the enrollment token and the TOTP setup code
 * BEFORE calling this — by the time we reach here, the user's identity and
 * second factor have both been confirmed.
 */
export async function finalizeTenantLoginAfterEnrollment(userId: string) {
  return finalizeTenantLogin(userId, { mfaJustVerified: true });
}

/**
 * Revokes the entire session associated with the provided refresh token (or the
 * caller-provided sessionId). Idempotent — silently succeeds if not found.
 */
export async function logout(args: {
  actorUserId: string;
  refreshToken?: string | null;
  sessionId?: string | null;
}) {
  let sessionId = args.sessionId ?? null;

  if (!sessionId && args.refreshToken) {
    const tokenRow = await prisma.refreshToken.findUnique({
      where: { token: args.refreshToken },
      select: { sessionId: true, userId: true },
    });
    if (tokenRow && tokenRow.userId === args.actorUserId) {
      sessionId = tokenRow.sessionId;
    }
  }

  if (!sessionId) return { revoked: 0 };

  const now = new Date();
  const updated = await prisma.tenantSession.updateMany({
    where: { id: sessionId, userId: args.actorUserId, revokedAt: null },
    data: { revokedAt: now },
  });
  if (updated.count === 0) return { revoked: 0 };

  await prisma.refreshToken.updateMany({
    where: { sessionId, revokedAt: null },
    data: { revokedAt: now },
  });

  await prisma.auditLog.create({
    data: {
      userId: args.actorUserId,
      action: AuditAction.logout,
      entityType: 'tenant_session',
      entityId: sessionId,
    },
  });

  return { revoked: 1 };
}

// ─── Session listing & management (tenant) ────────────────────────────────────

export async function listTenantSessions(userId: string) {
  return prisma.tenantSession.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastActiveAt: 'desc' },
    select: {
      id: true,
      deviceLabel: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      lastActiveAt: true,
      absoluteExpiresAt: true,
    },
  });
}

export async function revokeTenantSession(args: { userId: string; sessionId: string }) {
  const now = new Date();
  const updated = await prisma.tenantSession.updateMany({
    where: { id: args.sessionId, userId: args.userId, revokedAt: null },
    data: { revokedAt: now },
  });
  if (updated.count === 0) {
    throw httpError(404, 'SESSION_NOT_FOUND', 'Session not found or already revoked.');
  }
  await prisma.refreshToken.updateMany({
    where: { sessionId: args.sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: AuditAction.logout,
      entityType: 'tenant_session',
      entityId: args.sessionId,
      metadata: { kind: 'revoke_one' },
    },
  });
  return { revoked: 1 };
}

export async function revokeAllTenantSessions(userId: string) {
  const now = new Date();
  const sessions = await prisma.tenantSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  await prisma.auditLog.create({
    data: {
      userId,
      action: AuditAction.logout,
      entityType: 'tenant_session',
      metadata: { kind: 'revoke_all', count: sessions.count },
    },
  });
  return { revoked: sessions.count };
}

/**
 * Returns the authenticated user's profile (sensitive fields excluded).
 */
export async function getMe(userId: string) {
  const user = await prisma.tenantUser.findUnique({ where: { id: userId } });
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
  const user = await prisma.tenantUser.findUnique({
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
    prisma.tenantUser.update({
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
export async function refreshAccessToken(refreshToken: string) {
  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true, session: true },
  });

  const now = new Date();
  if (!stored) {
    throw httpError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token is invalid.');
  }

  // ── Token-reuse detection: a revoked refresh token being presented again
  // strongly suggests theft. Revoke the entire session as a tripwire.
  if (stored.revokedAt !== null) {
    await prisma.$transaction([
      prisma.tenantSession.updateMany({
        where: { id: stored.sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
      prisma.refreshToken.updateMany({
        where: { sessionId: stored.sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
      prisma.auditLog.create({
        data: {
          userId: stored.userId,
          action: AuditAction.permission_changed,
          entityType: 'tenant_session',
          entityId: stored.sessionId,
          metadata: { reason: 'refresh_token_reused', sessionRevoked: true },
        },
      }),
    ]);
    throw httpError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token already used. Session revoked. Please sign in again.');
  }

  assertRefreshTokenAndSessionState(stored, now);

  if (!stored.user.isActive) {
    throw httpError(403, 'ACCOUNT_INACTIVE', 'Account is disabled.');
  }

  const newRawToken = generateRefreshToken();
  const nextIdleExpiry = refreshIdleExpiresAt();
  const sessionAbsoluteExpiresAt = stored.session.absoluteExpiresAt;

  const newRecord = await prisma.refreshToken.create({
    data: {
      sessionId: stored.sessionId,
      userId: stored.userId,
      token: newRawToken,
      idleExpiresAt: nextIdleExpiry,
    },
  });
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: now, replacedByTokenId: newRecord.id },
    }),
    prisma.tenantSession.update({
      where: { id: stored.sessionId },
      data: { lastActiveAt: now },
    }),
    prisma.auditLog.create({
      data: {
        userId: stored.userId,
        action: AuditAction.login,
        metadata: { type: 'token_refreshed', sessionId: stored.sessionId },
      },
    }),
  ]);

  const session = await resolveAuthSessionContext({
    userId: stored.user.id,
    userRole: stored.user.role,
    currentActiveTenantId: stored.user.activeTenantId,
  });

  return {
    user: { ...safeUser(stored.user), activeTenantId: session.activeTenantId },
    newRefreshToken: newRawToken,
    sessionId: stored.sessionId,
    session,
    sessionExpiry: asSessionExpiryData({
      idleExpiresAt: nextIdleExpiry,
      absoluteExpiresAt: sessionAbsoluteExpiresAt,
    }),
  };
}

export async function getSessionExpiry(userId: string, token?: string) {
  const now = new Date();
  const stored = token
    ? await prisma.refreshToken.findUnique({
        where: { token },
        select: {
          userId: true,
          revokedAt: true,
          idleExpiresAt: true,
          session: { select: { revokedAt: true, absoluteExpiresAt: true } },
        },
      })
    : await prisma.refreshToken.findFirst({
        where: { userId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          userId: true,
          revokedAt: true,
          idleExpiresAt: true,
          session: { select: { revokedAt: true, absoluteExpiresAt: true } },
        },
      });

  if (!stored || stored.userId !== userId) {
    throw httpError(401, 'REFRESH_TOKEN_INVALID', 'Refresh token is invalid.');
  }

  assertRefreshTokenAndSessionState(stored, now);

  return {
    serverTime: now.toISOString(),
    session: asSessionExpiryData({
      idleExpiresAt: stored.idleExpiresAt,
      absoluteExpiresAt: stored.session.absoluteExpiresAt,
    }),
    tokens: {
      refreshTokenExpiresAt: stored.session.absoluteExpiresAt,
    },
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
  const user = await prisma.tenantUser.findUnique({ where: { email: body.email } });

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
  const user = await prisma.tenantUser.findUnique({ where: { email: body.email } });
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
    prisma.tenantUser.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash, failedAttempts: 0, lockedUntil: null },
    }),
    prisma.tenantSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
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
