import { AuditAction } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { encryptSecret, decryptSecret } from '../../lib/secret-crypto.js';
import {
  buildOtpAuthUri,
  generateBackupCodes,
  generateQrCodeDataUri,
  generateTotpSecret,
  hashBackupCode,
  verifyBackupCodeHash,
  verifyTotpCode,
} from '../../auth/mfa.js';
import { verifyPassword } from '../../lib/password.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Begins TOTP enrollment for the calling tenant user. Creates (or replaces) a
 * pending credential — `confirmedAt` is null until verify-setup succeeds.
 *
 * Returns the QR code data URI and the plaintext backup codes. The user MUST
 * save the backup codes now; they are only shown once.
 */
export async function setupTenantTotp(args: { userId: string; userEmail: string }) {
  const secret = generateTotpSecret();
  const otpAuthUri = buildOtpAuthUri({
    issuer: env.MFA_TOTP_ISSUER_TENANT,
    accountName: args.userEmail,
    secret,
  });
  const qrCodeDataUri = await generateQrCodeDataUri(otpAuthUri);

  const backupCodes = generateBackupCodes();
  const backupCodeHashes = await Promise.all(backupCodes.map(hashBackupCode));

  await prisma.$transaction(async (tx) => {
    // Replace any pending or stale credential — userId is unique.
    await tx.tenantMfaCredential.upsert({
      where: { userId: args.userId },
      create: {
        userId: args.userId,
        secretEncrypted: encryptSecret(secret),
        confirmedAt: null,
      },
      update: {
        secretEncrypted: encryptSecret(secret),
        confirmedAt: null,
        lastUsedAt: null,
      },
    });
    // Wipe previous backup codes (re-issued at every setup).
    await tx.tenantMfaBackupCode.deleteMany({ where: { userId: args.userId } });
    await tx.tenantMfaBackupCode.createMany({
      data: backupCodeHashes.map((codeHash) => ({ userId: args.userId, codeHash })),
    });
  });

  return {
    qrCodeDataUri,
    otpAuthUri,
    backupCodes, // plaintext — show once
  };
}

/**
 * Confirms enrollment by validating the user's first TOTP code against the
 * pending credential. Sets `confirmedAt` so login challenges fire from now on.
 */
export async function verifyTenantTotpSetup(args: { userId: string; code: string }) {
  const credential = await prisma.tenantMfaCredential.findUnique({
    where: { userId: args.userId },
  });
  if (!credential) {
    throw httpError(404, 'MFA_NOT_FOUND', 'No MFA setup in progress. Begin setup first.');
  }
  if (credential.confirmedAt) {
    throw httpError(409, 'MFA_ALREADY_CONFIRMED', 'MFA is already enrolled.');
  }

  const secret = decryptSecret(credential.secretEncrypted);
  const ok = await verifyTotpCode(args.code, secret);
  if (!ok) {
    throw httpError(401, 'MFA_CODE_INVALID', 'The code did not match. Try again.');
  }

  await prisma.tenantMfaCredential.update({
    where: { id: credential.id },
    data: { confirmedAt: new Date(), lastUsedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      userId: args.userId,
      action: AuditAction.permission_changed,
      entityType: 'mfa_credential',
      entityId: credential.id,
      metadata: { event: 'mfa_enrolled', type: 'totp' },
    },
  });
  return { enrolled: true };
}

// ─── Verify (during login challenge) ─────────────────────────────────────────

/**
 * Validates a TOTP code against the user's confirmed credential. Returns true
 * iff the credential exists, is confirmed, and the code matches.
 */
export async function verifyTenantTotp(args: { userId: string; code: string }): Promise<boolean> {
  const credential = await prisma.tenantMfaCredential.findUnique({
    where: { userId: args.userId },
  });
  if (!credential || !credential.confirmedAt) return false;

  const secret = decryptSecret(credential.secretEncrypted);
  const ok = await verifyTotpCode(args.code, secret);
  if (ok) {
    await prisma.tenantMfaCredential.update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date() },
    });
  }
  return ok;
}

/**
 * Validates a single-use backup code. Marks the matched code as consumed on
 * success — same code cannot be replayed.
 */
export async function verifyTenantBackupCode(args: {
  userId: string;
  code: string;
}): Promise<boolean> {
  const codes = await prisma.tenantMfaBackupCode.findMany({
    where: { userId: args.userId, usedAt: null },
  });
  for (const row of codes) {
    if (await verifyBackupCodeHash(args.code, row.codeHash)) {
      await prisma.tenantMfaBackupCode.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      await prisma.auditLog.create({
        data: {
          userId: args.userId,
          action: AuditAction.permission_changed,
          entityType: 'mfa_backup_code',
          entityId: row.id,
          metadata: { event: 'backup_code_consumed' },
        },
      });
      return true;
    }
  }
  return false;
}

// ─── Disable ────────────────────────────────────────────────────────────────

/**
 * Removes the user's TOTP credential and all backup codes. Requires the user
 * to re-authenticate by submitting their current password — disabling MFA is
 * a high-risk operation that should never inherit just an active session.
 */
export async function disableTenantMfa(args: { userId: string; currentPassword: string }) {
  const user = await prisma.tenantUser.findUnique({
    where: { id: args.userId },
    select: { passwordHash: true },
  });
  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');

  const { match } = await verifyPassword(args.currentPassword, user.passwordHash);
  if (!match) {
    throw httpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  }

  const credential = await prisma.tenantMfaCredential.findUnique({
    where: { userId: args.userId },
    select: { id: true },
  });
  if (!credential) {
    return { disabled: false }; // no-op — already off
  }

  await prisma.$transaction([
    prisma.tenantMfaBackupCode.deleteMany({ where: { userId: args.userId } }),
    prisma.tenantMfaCredential.delete({ where: { id: credential.id } }),
    prisma.auditLog.create({
      data: {
        userId: args.userId,
        action: AuditAction.permission_changed,
        entityType: 'mfa_credential',
        entityId: credential.id,
        metadata: { event: 'mfa_disabled' },
      },
    }),
  ]);

  return { disabled: true };
}

// ─── Status helpers ──────────────────────────────────────────────────────────

/** Returns true if the user has a confirmed TOTP credential. */
export async function tenantHasMfa(userId: string): Promise<boolean> {
  const credential = await prisma.tenantMfaCredential.findUnique({
    where: { userId },
    select: { confirmedAt: true },
  });
  return Boolean(credential?.confirmedAt);
}

/** Counts how many backup codes the user has remaining (unused). */
export async function countTenantBackupCodesRemaining(userId: string): Promise<number> {
  return prisma.tenantMfaBackupCode.count({
    where: { userId, usedAt: null },
  });
}

// Type exports for routes
export type MfaSetupResult = {
  qrCodeDataUri: string;
  otpAuthUri: string;
  backupCodes: string[];
};
