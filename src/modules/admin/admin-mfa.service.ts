import { AuditAction, Prisma } from '@prisma/client';
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

async function logPlatformAudit(args: {
  platformUserId: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}) {
  try {
    await prisma.platformAuditLog.create({
      data: {
        platformUserId: args.platformUserId,
        action: args.action,
        entityType: args.entityType ?? null,
        entityId: args.entityId ?? null,
        metadata: args.metadata ?? Prisma.JsonNull,
      },
    });
  } catch {
    // Fire-and-forget.
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export async function setupPlatformTotp(args: { platformUserId: string; userEmail: string }) {
  const secret = generateTotpSecret();
  const otpAuthUri = buildOtpAuthUri({
    issuer: env.MFA_TOTP_ISSUER_PLATFORM,
    accountName: args.userEmail,
    secret,
  });
  const qrCodeDataUri = await generateQrCodeDataUri(otpAuthUri);

  const backupCodes = generateBackupCodes();
  const backupCodeHashes = await Promise.all(backupCodes.map(hashBackupCode));

  await prisma.$transaction(async (tx) => {
    await tx.platformMfaCredential.upsert({
      where: { platformUserId: args.platformUserId },
      create: {
        platformUserId: args.platformUserId,
        secretEncrypted: encryptSecret(secret),
        confirmedAt: null,
      },
      update: {
        secretEncrypted: encryptSecret(secret),
        confirmedAt: null,
        lastUsedAt: null,
      },
    });
    await tx.platformMfaBackupCode.deleteMany({ where: { platformUserId: args.platformUserId } });
    await tx.platformMfaBackupCode.createMany({
      data: backupCodeHashes.map((codeHash) => ({ platformUserId: args.platformUserId, codeHash })),
    });
  });

  return { qrCodeDataUri, otpAuthUri, backupCodes };
}

export async function verifyPlatformTotpSetup(args: { platformUserId: string; code: string }) {
  const credential = await prisma.platformMfaCredential.findUnique({
    where: { platformUserId: args.platformUserId },
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

  await prisma.platformMfaCredential.update({
    where: { id: credential.id },
    data: { confirmedAt: new Date(), lastUsedAt: new Date() },
  });
  void logPlatformAudit({
    platformUserId: args.platformUserId,
    action: AuditAction.permission_changed,
    entityType: 'mfa_credential',
    entityId: credential.id,
    metadata: { event: 'mfa_enrolled', type: 'totp' },
  });
  return { enrolled: true };
}

// ─── Verify (during login challenge) ─────────────────────────────────────────

export async function verifyPlatformTotp(args: {
  platformUserId: string;
  code: string;
}): Promise<boolean> {
  const credential = await prisma.platformMfaCredential.findUnique({
    where: { platformUserId: args.platformUserId },
  });
  if (!credential || !credential.confirmedAt) return false;

  const secret = decryptSecret(credential.secretEncrypted);
  const ok = await verifyTotpCode(args.code, secret);
  if (ok) {
    await prisma.platformMfaCredential.update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date() },
    });
  }
  return ok;
}

export async function verifyPlatformBackupCode(args: {
  platformUserId: string;
  code: string;
}): Promise<boolean> {
  const codes = await prisma.platformMfaBackupCode.findMany({
    where: { platformUserId: args.platformUserId, usedAt: null },
  });
  for (const row of codes) {
    if (await verifyBackupCodeHash(args.code, row.codeHash)) {
      await prisma.platformMfaBackupCode.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      void logPlatformAudit({
        platformUserId: args.platformUserId,
        action: AuditAction.permission_changed,
        entityType: 'mfa_backup_code',
        entityId: row.id,
        metadata: { event: 'backup_code_consumed' },
      });
      return true;
    }
  }
  return false;
}

// ─── Disable ────────────────────────────────────────────────────────────────

export async function disablePlatformMfa(args: { platformUserId: string; currentPassword: string }) {
  const user = await prisma.platformUser.findUnique({
    where: { id: args.platformUserId },
    select: { passwordHash: true },
  });
  if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User not found.');

  const { match } = await verifyPassword(args.currentPassword, user.passwordHash);
  if (!match) {
    throw httpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  }

  const credential = await prisma.platformMfaCredential.findUnique({
    where: { platformUserId: args.platformUserId },
    select: { id: true },
  });
  if (!credential) {
    return { disabled: false };
  }

  await prisma.$transaction([
    prisma.platformMfaBackupCode.deleteMany({ where: { platformUserId: args.platformUserId } }),
    prisma.platformMfaCredential.delete({ where: { id: credential.id } }),
  ]);
  void logPlatformAudit({
    platformUserId: args.platformUserId,
    action: AuditAction.permission_changed,
    entityType: 'mfa_credential',
    entityId: credential.id,
    metadata: { event: 'mfa_disabled' },
  });

  return { disabled: true };
}

// ─── Status helpers ──────────────────────────────────────────────────────────

export async function platformHasMfa(platformUserId: string): Promise<boolean> {
  const credential = await prisma.platformMfaCredential.findUnique({
    where: { platformUserId },
    select: { confirmedAt: true },
  });
  return Boolean(credential?.confirmedAt);
}

export async function countPlatformBackupCodesRemaining(platformUserId: string): Promise<number> {
  return prisma.platformMfaBackupCode.count({
    where: { platformUserId, usedAt: null },
  });
}
