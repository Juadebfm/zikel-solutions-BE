import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import {
  hashPassword,
  normalizePasswordCheckTiming,
  verifyPassword,
} from '../../lib/password.js';
import {
  generateRefreshToken,
  refreshExpiresAt,
  refreshIdleExpiresAt,
} from '../../lib/tokens.js';
import { platformHasMfa, verifyPlatformTotp, verifyPlatformBackupCode } from './admin-mfa.service.js';
import {
  signMfaChallengeToken,
  verifyMfaChallengeToken,
  MFA_CHALLENGE_EXPIRY_SECONDS,
} from '../../auth/mfa-challenge-token.js';
import {
  signMfaEnrollmentToken,
  MFA_ENROLLMENT_EXPIRY_SECONDS,
} from '../../auth/mfa-enrollment-token.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1_000; // 30 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safePlatformUser(user: {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
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
    lastName: user.lastName,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function createPlatformSessionWithToken(args: {
  platformUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  mfaVerified?: boolean;
}) {
  const absoluteExpiresAt = refreshExpiresAt();
  const idleExpiresAt = refreshIdleExpiresAt();
  const token = generateRefreshToken();

  const session = await prisma.platformSession.create({
    data: {
      platformUserId: args.platformUserId,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
      absoluteExpiresAt,
      ...(args.mfaVerified ? { mfaVerifiedAt: new Date() } : {}),
      refreshTokens: {
        create: {
          platformUserId: args.platformUserId,
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

async function logPlatformAudit(args: {
  platformUserId: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  targetTenantId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  try {
    await prisma.platformAuditLog.create({
      data: {
        platformUserId: args.platformUserId,
        action: args.action,
        entityType: args.entityType ?? null,
        entityId: args.entityId ?? null,
        targetTenantId: args.targetTenantId ?? null,
        metadata: args.metadata ?? Prisma.JsonNull,
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
      },
    });
  } catch {
    // Fire-and-forget: never block the request on audit-log failure.
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function loginPlatformUser(args: {
  email: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const normalizedEmail = args.email.trim().toLowerCase();

  const user = await prisma.platformUser.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || !user.isActive) {
    await normalizePasswordCheckTiming(args.password);
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw httpError(
      423,
      'ACCOUNT_LOCKED',
      'Account temporarily locked due to repeated failed sign-in attempts. Try again later.',
    );
  }

  const { match } = await verifyPassword(args.password, user.passwordHash);
  if (!match) {
    const failedAttempts = user.failedAttempts + 1;
    const lockedUntil =
      failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null;
    await prisma.platformUser.update({
      where: { id: user.id },
      data: { failedAttempts, lockedUntil },
    });
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  // Reset lockout state ahead of any MFA gate.
  await prisma.platformUser.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null },
  });

  // ── MFA gate ────────────────────────────────────────────────────────────
  // Platform users always carry elevated risk — MFA is mandatory. Two paths
  // beyond password:
  //  1. TOTP enrolled → short-lived challenge token, finalize on /admin/auth/mfa/totp/verify.
  //  2. TOTP not enrolled → enrollment token. NO session is minted; the FE
  //     drives the user through /admin/auth/mfa/totp/enroll/setup +
  //     /admin/auth/mfa/totp/enroll/confirm in one flow.
  const hasMfa = await platformHasMfa(user.id);
  if (hasMfa) {
    return {
      kind: 'mfa-required' as const,
      mfaRequired: true,
      challengeToken: signMfaChallengeToken({ userId: user.id, audience: 'platform' }),
      challengeExpiresInSeconds: MFA_CHALLENGE_EXPIRY_SECONDS,
    };
  }

  return {
    kind: 'mfa-enrollment-required' as const,
    mfaEnrollmentRequired: true,
    enrollmentToken: signMfaEnrollmentToken({ userId: user.id, audience: 'platform' }),
    enrollmentExpiresInSeconds: MFA_ENROLLMENT_EXPIRY_SECONDS,
  };
}

/**
 * Mints a session for a platform user whose identity has already been verified
 * (password-only OR password + MFA verify).
 */
export async function finalizePlatformLogin(args: {
  platformUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  mfaVerified?: boolean;
}) {
  const user = await prisma.platformUser.findUnique({ where: { id: args.platformUserId } });
  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'Platform user not found.');
  }

  const session = await createPlatformSessionWithToken({
    platformUserId: user.id,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
    ...(args.mfaVerified ? { mfaVerified: true } : {}),
  });

  await prisma.platformUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  void logPlatformAudit({
    platformUserId: user.id,
    action: AuditAction.login,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return {
    kind: 'completed' as const,
    user: safePlatformUser(user),
    session: { id: session.sessionId },
    tokens: {
      refreshToken: session.token,
      refreshTokenExpiresAt: session.absoluteExpiresAt,
    },
  };
}

/** Exchange platform challenge token + TOTP code for a full session. */
export async function verifyPlatformTotpAndLogin(args: {
  challengeToken: string;
  code: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const platformUserId = verifyMfaChallengeToken({
    token: args.challengeToken,
    expectedAudience: 'platform',
  });
  const ok = await verifyPlatformTotp({ platformUserId, code: args.code });
  if (!ok) {
    throw httpError(401, 'MFA_CODE_INVALID', 'The code did not match. Try again.');
  }
  return finalizePlatformLogin({
    platformUserId,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
    mfaVerified: true,
  });
}

/**
 * Mints a session for a platform user who has just completed first-time TOTP
 * enrollment. The enrollment route verifies the enrollment token and the TOTP
 * setup code BEFORE calling this — by here, identity + second factor are both
 * confirmed.
 */
export async function finalizePlatformLoginAfterEnrollment(args: {
  platformUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return finalizePlatformLogin({
    platformUserId: args.platformUserId,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
    mfaVerified: true,
  });
}

/** Exchange platform challenge token + single-use backup code for a full session. */
export async function verifyPlatformBackupAndLogin(args: {
  challengeToken: string;
  code: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const platformUserId = verifyMfaChallengeToken({
    token: args.challengeToken,
    expectedAudience: 'platform',
  });
  const ok = await verifyPlatformBackupCode({ platformUserId, code: args.code });
  if (!ok) {
    throw httpError(401, 'MFA_BACKUP_INVALID', 'Backup code is invalid or already used.');
  }
  return finalizePlatformLogin({
    platformUserId,
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
    mfaVerified: true,
  });
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logoutPlatformUser(args: {
  platformUserId: string;
  sessionId?: string | null;
  refreshToken?: string | null;
}) {
  let sessionId = args.sessionId ?? null;

  // If only the refresh token is given, look up its session.
  if (!sessionId && args.refreshToken) {
    const tokenRow = await prisma.platformRefreshToken.findUnique({
      where: { token: args.refreshToken },
      select: { sessionId: true, platformUserId: true },
    });
    if (tokenRow && tokenRow.platformUserId === args.platformUserId) {
      sessionId = tokenRow.sessionId;
    }
  }

  if (!sessionId) return { revoked: 0 };

  const now = new Date();
  const session = await prisma.platformSession.updateMany({
    where: {
      id: sessionId,
      platformUserId: args.platformUserId,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  if (session.count === 0) return { revoked: 0 };

  await prisma.platformRefreshToken.updateMany({
    where: { sessionId, revokedAt: null },
    data: { revokedAt: now },
  });

  void logPlatformAudit({
    platformUserId: args.platformUserId,
    action: AuditAction.logout,
    entityType: 'platform_session',
    entityId: sessionId,
  });

  return { revoked: 1 };
}

// ─── Session listing & management ─────────────────────────────────────────────

export async function listPlatformSessions(platformUserId: string) {
  const sessions = await prisma.platformSession.findMany({
    where: { platformUserId, revokedAt: null },
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
  return sessions;
}

export async function revokePlatformSession(args: {
  platformUserId: string;
  sessionId: string;
}) {
  const now = new Date();
  const updated = await prisma.platformSession.updateMany({
    where: {
      id: args.sessionId,
      platformUserId: args.platformUserId,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  if (updated.count === 0) {
    throw httpError(404, 'SESSION_NOT_FOUND', 'Session not found or already revoked.');
  }
  await prisma.platformRefreshToken.updateMany({
    where: { sessionId: args.sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
  void logPlatformAudit({
    platformUserId: args.platformUserId,
    action: AuditAction.logout,
    entityType: 'platform_session',
    entityId: args.sessionId,
    metadata: { kind: 'revoke_one' },
  });
  return { revoked: 1 };
}

export async function revokeAllPlatformSessions(platformUserId: string) {
  const now = new Date();
  const sessions = await prisma.platformSession.updateMany({
    where: { platformUserId, revokedAt: null },
    data: { revokedAt: now },
  });
  await prisma.platformRefreshToken.updateMany({
    where: { platformUserId, revokedAt: null },
    data: { revokedAt: now },
  });
  void logPlatformAudit({
    platformUserId,
    action: AuditAction.logout,
    entityType: 'platform_session',
    metadata: { kind: 'revoke_all', count: sessions.count },
  });
  return { revoked: sessions.count };
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export async function getPlatformUser(platformUserId: string) {
  const user = await prisma.platformUser.findUnique({ where: { id: platformUserId } });
  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'Platform user not found.');
  }
  return safePlatformUser(user);
}

// ─── Seeding helper (used by scripts/seed-platform-user.ts) ───────────────────

export async function provisionPlatformUser(args: {
  email: string;
  password: string;
  role: 'platform_admin' | 'support' | 'engineer' | 'billing';
  firstName: string;
  lastName: string;
}) {
  const email = args.email.trim().toLowerCase();
  if (!email.endsWith('@zikelsolutions.com')) {
    throw httpError(
      422,
      'PLATFORM_EMAIL_DOMAIN',
      'Platform users must sign in with a @zikelsolutions.com email address.',
    );
  }
  const passwordHash = await hashPassword(args.password);
  return prisma.platformUser.create({
    data: {
      email,
      passwordHash,
      role: args.role,
      firstName: args.firstName,
      lastName: args.lastName,
    },
  });
}
