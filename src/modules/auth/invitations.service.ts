import { createHash, randomBytes } from 'node:crypto';
import { AuditAction, MembershipStatus, InvitationStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { sendOtpEmail } from '../../lib/email.js';
import { logger } from '../../lib/logger.js';

const INVITATION_TOKEN_BYTES = 32;
const INVITATION_DEFAULT_EXPIRY_HOURS = 7 * 24; // 7 days

/** SHA-256 hash of the plaintext invitation token (what we store in the DB). */
function hashInvitationToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function generateInvitationToken(): { plaintext: string; tokenHash: string } {
  const plaintext = randomBytes(INVITATION_TOKEN_BYTES).toString('hex');
  return { plaintext, tokenHash: hashInvitationToken(plaintext) };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─── Lookup helper ───────────────────────────────────────────────────────────

/**
 * Resolves an invitation by its plaintext token + checks state. Returns the
 * row if pending and not expired; throws an httpError otherwise.
 */
export async function resolveInvitationByToken(plaintext: string) {
  const tokenHash = hashInvitationToken(plaintext);
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash },
    include: {
      tenant: { select: { id: true, name: true, slug: true, isActive: true } },
      role: { select: { id: true, name: true, permissions: true } },
      home: { select: { id: true, name: true } },
    },
  });
  if (!invitation) {
    throw httpError(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
  }
  if (invitation.status === InvitationStatus.accepted) {
    throw httpError(409, 'INVITATION_ALREADY_ACCEPTED', 'This invitation has already been used.');
  }
  if (invitation.status === InvitationStatus.revoked) {
    throw httpError(410, 'INVITATION_REVOKED', 'This invitation has been revoked.');
  }
  if (invitation.expiresAt <= new Date()) {
    throw httpError(410, 'INVITATION_EXPIRED', 'This invitation has expired.');
  }
  if (!invitation.tenant.isActive) {
    throw httpError(409, 'TENANT_INACTIVE', 'The inviting organization is no longer active.');
  }
  return invitation;
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Creates a pending invitation for `email` to join `tenantId` with the given
 * role (and optional home). The plaintext token is returned ONCE — it is the
 * value embedded in the email link. Only the SHA-256 hash is persisted.
 */
export async function createInvitation(args: {
  invitedById: string;
  tenantId: string;
  email: string;
  roleId: string;
  homeId?: string | null;
  expiresInHours?: number;
}) {
  const email = normalizeEmail(args.email);

  // Validate the role belongs to this tenant (or is a system role).
  const role = await prisma.role.findFirst({
    where: { id: args.roleId, OR: [{ tenantId: args.tenantId }, { tenantId: null }] },
    select: { id: true, name: true, isAssignable: true },
  });
  if (!role) {
    throw httpError(404, 'ROLE_NOT_FOUND', 'Role not found in this tenant.');
  }
  if (!role.isAssignable) {
    throw httpError(403, 'ROLE_NOT_ASSIGNABLE', 'This role cannot be assigned to invitees.');
  }
  if (role.name === 'Owner') {
    throw httpError(403, 'CANNOT_INVITE_OWNER', 'Owner role cannot be granted via invitation. Transfer ownership instead.');
  }

  if (args.homeId) {
    const home = await prisma.home.findFirst({
      where: { id: args.homeId, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!home) throw httpError(404, 'HOME_NOT_FOUND', 'Home not found in this tenant.');
  }

  // Check for an existing active membership for this email under this tenant.
  const existingUser = await prisma.tenantUser.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    const existingMembership = await prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: args.tenantId, userId: existingUser.id } },
      select: { status: true },
    });
    if (existingMembership && existingMembership.status === MembershipStatus.active) {
      throw httpError(409, 'ALREADY_A_MEMBER', 'A user with this email is already a member of the tenant.');
    }
  }

  // Refuse to stack pending invitations — revoke any prior pending invite for
  // this email/tenant before creating a new one.
  await prisma.invitation.updateMany({
    where: {
      tenantId: args.tenantId,
      email,
      status: InvitationStatus.pending,
    },
    data: { status: InvitationStatus.revoked },
  });

  const { plaintext, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(
    Date.now() + (args.expiresInHours ?? INVITATION_DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000,
  );

  const invitation = await prisma.invitation.create({
    data: {
      tenantId: args.tenantId,
      email,
      invitedById: args.invitedById,
      roleId: args.roleId,
      homeId: args.homeId ?? null,
      tokenHash,
      expiresAt,
    },
    include: {
      tenant: { select: { name: true, slug: true } },
      role: { select: { name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: args.tenantId,
      userId: args.invitedById,
      action: AuditAction.permission_changed,
      entityType: 'invitation',
      entityId: invitation.id,
      metadata: {
        event: 'invitation_created',
        email,
        roleName: invitation.role.name,
        ...(args.homeId ? { homeId: args.homeId } : {}),
        expiresAt: expiresAt.toISOString(),
      },
    },
  });

  return { invitation, plaintextToken: plaintext };
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listInvitations(args: {
  tenantId: string;
  status?: 'pending' | 'accepted' | 'revoked' | 'expired' | 'all';
  page: number;
  pageSize: number;
}) {
  const skip = (args.page - 1) * args.pageSize;
  const now = new Date();

  let where: Prisma.InvitationWhereInput = { tenantId: args.tenantId };
  if (args.status === 'pending') {
    where = { ...where, status: InvitationStatus.pending, expiresAt: { gt: now } };
  } else if (args.status === 'expired') {
    where = { ...where, status: InvitationStatus.pending, expiresAt: { lte: now } };
  } else if (args.status === 'accepted') {
    where = { ...where, status: InvitationStatus.accepted };
  } else if (args.status === 'revoked') {
    where = { ...where, status: InvitationStatus.revoked };
  }

  const [total, rows] = await Promise.all([
    prisma.invitation.count({ where }),
    prisma.invitation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: args.pageSize,
      include: {
        role: { select: { id: true, name: true } },
        home: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    }),
  ]);

  return {
    data: rows.map((row) => mapInvitation(row, now)),
    meta: {
      total,
      page: args.page,
      pageSize: args.pageSize,
      totalPages: Math.max(1, Math.ceil(total / args.pageSize)),
    },
  };
}

function deriveStatus(row: { status: InvitationStatus; expiresAt: Date }, now: Date) {
  if (row.status === InvitationStatus.pending && row.expiresAt <= now) return 'expired' as const;
  return row.status;
}

function mapInvitation(
  row: Prisma.InvitationGetPayload<{
    include: {
      role: { select: { id: true; name: true } };
      home: { select: { id: true; name: true } };
      invitedBy: { select: { id: true; firstName: true; lastName: true; email: true } };
    };
  }>,
  now: Date,
) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    role: row.role,
    home: row.home,
    invitedBy: row.invitedBy,
    status: deriveStatus(row, now),
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Revoke ──────────────────────────────────────────────────────────────────

export async function revokeInvitation(args: {
  tenantId: string;
  actorUserId: string;
  invitationId: string;
}) {
  const invitation = await prisma.invitation.findFirst({
    where: { id: args.invitationId, tenantId: args.tenantId },
    select: { id: true, status: true, email: true },
  });
  if (!invitation) {
    throw httpError(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
  }
  if (invitation.status === InvitationStatus.accepted) {
    throw httpError(409, 'INVITATION_ALREADY_ACCEPTED', 'Cannot revoke an accepted invitation.');
  }
  if (invitation.status === InvitationStatus.revoked) {
    return { revoked: false }; // idempotent
  }

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: InvitationStatus.revoked },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: args.tenantId,
      userId: args.actorUserId,
      action: AuditAction.permission_changed,
      entityType: 'invitation',
      entityId: invitation.id,
      metadata: { event: 'invitation_revoked', email: invitation.email },
    },
  });
  return { revoked: true };
}

// ─── Resend ──────────────────────────────────────────────────────────────────

/**
 * Re-issues a fresh token for a still-pending invitation, extending the expiry.
 * Returns the new plaintext token. The old token becomes invalid.
 */
export async function resendInvitation(args: {
  tenantId: string;
  actorUserId: string;
  invitationId: string;
  expiresInHours?: number;
}) {
  const invitation = await prisma.invitation.findFirst({
    where: { id: args.invitationId, tenantId: args.tenantId },
    select: { id: true, status: true, email: true },
  });
  if (!invitation) {
    throw httpError(404, 'INVITATION_NOT_FOUND', 'Invitation not found.');
  }
  if (invitation.status === InvitationStatus.accepted) {
    throw httpError(409, 'INVITATION_ALREADY_ACCEPTED', 'Cannot resend an accepted invitation.');
  }
  if (invitation.status === InvitationStatus.revoked) {
    throw httpError(409, 'INVITATION_REVOKED', 'Cannot resend a revoked invitation; create a new one.');
  }

  const { plaintext, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(
    Date.now() + (args.expiresInHours ?? INVITATION_DEFAULT_EXPIRY_HOURS) * 60 * 60 * 1000,
  );

  const updated = await prisma.invitation.update({
    where: { id: invitation.id },
    data: { tokenHash, expiresAt, status: InvitationStatus.pending },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: args.tenantId,
      userId: args.actorUserId,
      action: AuditAction.permission_changed,
      entityType: 'invitation',
      entityId: invitation.id,
      metadata: { event: 'invitation_resent', email: invitation.email, expiresAt: expiresAt.toISOString() },
    },
  });
  return { invitation: updated, plaintextToken: plaintext };
}

// ─── Accept ──────────────────────────────────────────────────────────────────

/**
 * Redeems an invitation: creates (or upgrades) the TenantUser and TenantMembership.
 * If the user already exists, the password parameter is ignored — they'll log
 * in with their existing credentials. New users must supply a password.
 */
export async function acceptInvitation(args: {
  plaintextToken: string;
  firstName: string;
  lastName: string;
  password?: string;
}) {
  const invitation = await resolveInvitationByToken(args.plaintextToken);

  return prisma.$transaction(async (tx) => {
    const existingUser = await tx.tenantUser.findUnique({
      where: { email: invitation.email },
      select: { id: true, passwordHash: true },
    });

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      if (!args.password || args.password.length < 12) {
        throw httpError(
          422,
          'PASSWORD_REQUIRED',
          'A password is required when creating a new account from this invitation.',
        );
      }
      const passwordHash = await hashPassword(args.password);
      const created = await tx.tenantUser.create({
        data: {
          email: invitation.email,
          passwordHash,
          firstName: args.firstName,
          lastName: args.lastName,
          country: 'UK',
          acceptedTerms: true,
          emailVerified: true, // accepting a tokenized invite proves email ownership
          activeTenantId: invitation.tenantId,
        },
        select: { id: true },
      });
      userId = created.id;
    }

    // Upsert membership
    await tx.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
      update: {
        roleId: invitation.role.id,
        status: MembershipStatus.active,
        invitedById: invitation.invitedById,
      },
      create: {
        tenantId: invitation.tenantId,
        userId,
        roleId: invitation.role.id,
        status: MembershipStatus.active,
        invitedById: invitation.invitedById,
      },
    });

    // Optionally pre-assign to a Home as an Employee record.
    if (invitation.homeId) {
      const existingEmployee = await tx.employee.findUnique({
        where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
        select: { id: true },
      });
      if (!existingEmployee) {
        await tx.employee.create({
          data: {
            tenantId: invitation.tenantId,
            userId,
            homeId: invitation.homeId,
            status: 'current',
          },
        });
      }
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.accepted,
        acceptedAt: new Date(),
        acceptedByUserId: userId,
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: invitation.tenantId,
        userId,
        action: AuditAction.permission_changed,
        entityType: 'invitation',
        entityId: invitation.id,
        metadata: { event: 'invitation_accepted', email: invitation.email },
      },
    });

    return { userId, tenantId: invitation.tenantId };
  });
}

// ─── Email helper ────────────────────────────────────────────────────────────

/**
 * Best-effort send. Reuses the existing OTP-style email sender and treats the
 * invitation token as the "code" payload — the email template renders a link
 * with the token. Logs but never throws on delivery failure.
 *
 * Today this leans on the `staff_activation` OTP-purpose template which the
 * existing email module knows how to render. A dedicated invitation template
 * would be a small, separate cleanup.
 */
export async function sendInvitationEmail(args: { email: string; plaintextToken: string }) {
  try {
    // We're piggybacking on the OTP email sender here. Using staff_activation
    // as the purpose preserves the existing template; the recipient receives
    // a link containing the token.
    await sendOtpEmail(args.email, args.plaintextToken, 'staff_activation' as never);
  } catch (err) {
    logger.warn({
      msg: 'Failed to send invitation email',
      err: err instanceof Error ? err.message : 'unknown',
    });
  }
}
