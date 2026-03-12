import { createHash, randomBytes } from 'crypto';
import { AuditAction, MembershipStatus, Prisma, TenantRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { sendTenantInviteEmail } from '../../lib/email.js';
import { logger } from '../../lib/logger.js';
import { logSensitiveReadAccess } from '../../lib/sensitive-read-audit.js';
import type {
  AcceptTenantInviteBody,
  AddTenantMemberBody,
  CreateTenantInviteBody,
  CreateTenantBody,
  ListTenantMembershipsQuery,
  ListTenantInvitesQuery,
  ListTenantsQuery,
  SelfServeCreateTenantBody,
  UpdateTenantMemberBody,
} from './tenants.schema.js';

type ActorGlobalRole = 'super_admin' | 'admin' | 'manager' | 'staff';

const INVITE_TOKEN_BYTES = 32;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function inviteTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function deriveInviteStatus(row: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): 'pending' | 'accepted' | 'revoked' | 'expired' {
  if (row.revokedAt) return 'revoked';
  if (row.acceptedAt) return 'accepted';
  if (row.expiresAt <= new Date()) return 'expired';
  return 'pending';
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

function mapMembership(row: {
  id: string;
  tenantId: string;
  userId: string;
  role: TenantRole;
  status: MembershipStatus;
  invitedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    email: string;
    firstName: string;
    lastName: string;
  } | null;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    role: row.role,
    status: row.status,
    invitedById: row.invitedById,
    user: row.user
      ? {
          email: row.user.email,
          firstName: row.user.firstName,
          lastName: row.user.lastName,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapInvite(row: {
  id: string;
  tenantId: string;
  email: string;
  role: TenantRole;
  invitedById: string;
  acceptedByUserId: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    role: row.role,
    status: deriveInviteStatus(row),
    invitedById: row.invitedById,
    acceptedByUserId: row.acceptedByUserId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTenant(row: {
  id: string;
  name: string;
  slug: string;
  country: 'UK' | 'Nigeria';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    country: row.country,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function resolveUserByMemberInput(body: {
  userId?: string | undefined;
  email?: string | undefined;
}) {
  if (body.userId) {
    return prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
  }
  if (body.email) {
    return prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
  }
  return null;
}

async function ensureTenantExists(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, isActive: true, name: true },
  });

  if (!tenant) {
    throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  }

  return tenant;
}

function manageableInviteRoles(
  actorGlobalRole: ActorGlobalRole,
  actorTenantRole: TenantRole | null,
): TenantRole[] {
  if (actorGlobalRole === 'super_admin') {
    return [TenantRole.tenant_admin, TenantRole.sub_admin, TenantRole.staff];
  }
  if (actorTenantRole === TenantRole.tenant_admin) {
    return [TenantRole.sub_admin, TenantRole.staff];
  }
  if (actorTenantRole === TenantRole.sub_admin) {
    return [TenantRole.staff];
  }
  return [];
}

function viewableMembershipRoles(
  actorGlobalRole: ActorGlobalRole,
  actorTenantRole: TenantRole | null,
): TenantRole[] {
  if (actorGlobalRole === 'super_admin') {
    return [TenantRole.tenant_admin, TenantRole.sub_admin, TenantRole.staff];
  }
  if (actorTenantRole === TenantRole.tenant_admin) {
    return [TenantRole.tenant_admin, TenantRole.sub_admin, TenantRole.staff];
  }
  if (actorTenantRole === TenantRole.sub_admin) {
    return [TenantRole.sub_admin, TenantRole.staff];
  }
  return [];
}

function manageableMembershipRoles(
  actorGlobalRole: ActorGlobalRole,
  actorTenantRole: TenantRole | null,
): TenantRole[] {
  if (actorGlobalRole === 'super_admin') {
    return [TenantRole.tenant_admin, TenantRole.sub_admin, TenantRole.staff];
  }
  if (actorTenantRole === TenantRole.tenant_admin) {
    return [TenantRole.sub_admin, TenantRole.staff];
  }
  if (actorTenantRole === TenantRole.sub_admin) {
    return [TenantRole.staff];
  }
  return [];
}

async function resolveActorTenantRole(
  actorUserId: string,
  tenantId: string,
): Promise<TenantRole | null> {
  const membership = await prisma.tenantMembership.findUnique({
    where: {
      tenantId_userId: {
        tenantId,
        userId: actorUserId,
      },
    },
    select: { role: true, status: true },
  });

  if (!membership || membership.status !== MembershipStatus.active) {
    return null;
  }

  return membership.role;
}

async function assertInvitePermission(
  actorUserId: string,
  actorGlobalRole: ActorGlobalRole,
  tenantId: string,
  targetRole: TenantRole,
) {
  const actorTenantRole = actorGlobalRole === 'super_admin'
    ? null
    : await resolveActorTenantRole(actorUserId, tenantId);
  const allowedRoles = manageableInviteRoles(actorGlobalRole, actorTenantRole);

  if (!allowedRoles.includes(targetRole)) {
    throw httpError(
      403,
      'TENANT_INVITE_FORBIDDEN',
      'You do not have permission to manage this invite role in the tenant.',
    );
  }

  return actorTenantRole;
}

async function resolveMembershipPermissionContext(
  actorUserId: string,
  actorGlobalRole: ActorGlobalRole,
  tenantId: string,
) {
  const actorTenantRole = actorGlobalRole === 'super_admin'
    ? null
    : await resolveActorTenantRole(actorUserId, tenantId);
  return {
    actorTenantRole,
    viewableRoles: viewableMembershipRoles(actorGlobalRole, actorTenantRole),
    manageableRoles: manageableMembershipRoles(actorGlobalRole, actorTenantRole),
  };
}

function inviteWhereFromStatus(status?: ListTenantInvitesQuery['status']): Prisma.TenantInviteWhereInput {
  const now = new Date();
  if (!status) return {};
  switch (status) {
    case 'pending':
      return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
    case 'accepted':
      return { acceptedAt: { not: null } };
    case 'revoked':
      return { revokedAt: { not: null } };
    case 'expired':
      return { acceptedAt: null, revokedAt: null, expiresAt: { lte: now } };
    default:
      return {};
  }
}

export async function listTenants(query: ListTenantsQuery) {
  const where: Prisma.TenantWhereInput = {
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { slug: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };

  const skip = (query.page - 1) * query.pageSize;
  const [total, rows] = await Promise.all([
    prisma.tenant.count({ where }),
    prisma.tenant.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  return {
    data: rows.map(mapTenant),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export async function getTenantById(id: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      memberships: {
        include: {
          user: {
            select: { email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!tenant) {
    throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  }

  return {
    ...mapTenant(tenant),
    memberships: tenant.memberships.map(mapMembership),
  };
}

export async function listTenantMemberships(
  actorUserId: string,
  actorGlobalRole: ActorGlobalRole,
  tenantId: string,
  query: ListTenantMembershipsQuery,
) {
  await ensureTenantExists(tenantId);

  const permission = await resolveMembershipPermissionContext(
    actorUserId,
    actorGlobalRole,
    tenantId,
  );
  if (permission.viewableRoles.length === 0) {
    throw httpError(
      403,
      'TENANT_MEMBERSHIP_FORBIDDEN',
      'You do not have permission to view tenant memberships.',
    );
  }

  if (query.role && !permission.viewableRoles.includes(query.role)) {
    throw httpError(
      403,
      'TENANT_MEMBERSHIP_FORBIDDEN',
      'You do not have permission to view that tenant role.',
    );
  }

  const where: Prisma.TenantMembershipWhereInput = {
    tenantId,
    role: { in: permission.viewableRoles },
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          user: {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
  };

  const skip = (query.page - 1) * query.pageSize;
  const [total, memberships] = await Promise.all([
    prisma.tenantMembership.count({ where }),
    prisma.tenantMembership.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip,
      take: query.pageSize,
      include: {
        user: {
          select: { email: true, firstName: true, lastName: true },
        },
      },
    }),
  ]);

  await logSensitiveReadAccess({
    actorUserId,
    tenantId,
    entityType: 'tenant_membership',
    source: 'tenants.memberships.list',
    scope: 'list',
    resultCount: memberships.length,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      role: query.role ?? null,
      status: query.status ?? null,
      hasSearch: Boolean(query.search),
    },
  });

  return {
    data: memberships.map(mapMembership),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export async function createTenant(actorUserId: string, body: CreateTenantBody) {
  const tenantSlug = (body.slug ?? slugify(body.name)).toLowerCase();
  if (!tenantSlug) {
    throw httpError(422, 'VALIDATION_ERROR', 'Unable to derive slug from tenant name.');
  }

  const adminUser = body.adminUserId || body.adminEmail
    ? await resolveUserByMemberInput({
        userId: body.adminUserId,
        email: body.adminEmail,
      })
    : null;

  if ((body.adminUserId || body.adminEmail) && !adminUser) {
    throw httpError(404, 'USER_NOT_FOUND', 'Admin user was not found.');
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: body.name,
          slug: tenantSlug,
          country: body.country,
        },
      });

      const membership = adminUser
        ? await tx.tenantMembership.create({
            data: {
              tenantId: tenant.id,
              userId: adminUser.id,
              role: TenantRole.tenant_admin,
              status: MembershipStatus.active,
              invitedById: actorUserId,
            },
            include: {
              user: {
                select: { email: true, firstName: true, lastName: true },
              },
            },
          })
        : null;

      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: AuditAction.record_created,
          entityType: 'tenant',
          entityId: tenant.id,
          metadata: { slug: tenant.slug, country: tenant.country },
        },
      });

      if (membership) {
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: AuditAction.permission_changed,
            entityType: 'tenant_membership',
            entityId: membership.id,
            metadata: {
              tenantId: tenant.id,
              userId: membership.userId,
              role: membership.role,
              status: membership.status,
            },
          },
        });
      }

      return { tenant, membership };
    });

    return {
      tenant: mapTenant(result.tenant),
      adminMembership: result.membership ? mapMembership(result.membership) : null,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw httpError(409, 'TENANT_SLUG_TAKEN', 'A tenant with this slug already exists.');
    }
    throw error;
  }
}

export async function selfServeCreateTenant(actorUserId: string, body: SelfServeCreateTenantBody) {
  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: {
      id: true,
      isActive: true,
      emailVerified: true,
    },
  });
  if (!actor) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }
  if (!actor.isActive) {
    throw httpError(403, 'ACCOUNT_INACTIVE', 'Account is disabled.');
  }
  if (!actor.emailVerified) {
    throw httpError(
      403,
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email address before creating an organization.',
    );
  }

  const existingActiveMembership = await prisma.tenantMembership.findFirst({
    where: {
      userId: actorUserId,
      status: MembershipStatus.active,
    },
    select: { id: true, tenantId: true },
  });
  if (existingActiveMembership) {
    throw httpError(
      409,
      'SELF_SERVE_ONBOARDING_NOT_ALLOWED',
      'You already belong to an active organization.',
    );
  }

  const result = await createTenant(actorUserId, {
    name: body.name,
    slug: body.slug,
    country: body.country,
    adminUserId: actorUserId,
  });

  await prisma.user.update({
    where: { id: actorUserId },
    data: { activeTenantId: result.tenant.id },
  });

  return result;
}

export async function addTenantMembership(
  actorUserId: string,
  actorGlobalRole: ActorGlobalRole,
  tenantId: string,
  body: AddTenantMemberBody,
) {
  await ensureTenantExists(tenantId);

  const permission = await resolveMembershipPermissionContext(
    actorUserId,
    actorGlobalRole,
    tenantId,
  );
  if (!permission.manageableRoles.includes(body.role)) {
    throw httpError(
      403,
      'TENANT_MEMBERSHIP_FORBIDDEN',
      'You do not have permission to assign this tenant role.',
    );
  }

  const user = await resolveUserByMemberInput({
    userId: body.userId,
    email: body.email,
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const existingMembership = await prisma.tenantMembership.findUnique({
    where: {
      tenantId_userId: {
        tenantId,
        userId: user.id,
      },
    },
    select: { id: true },
  });

  if (existingMembership) {
    throw httpError(409, 'TENANT_MEMBERSHIP_EXISTS', 'User already belongs to this tenant.');
  }

  const membership = await prisma.tenantMembership.create({
    data: {
      tenantId,
      userId: user.id,
      role: body.role,
      status: body.status,
      invitedById: actorUserId,
    },
    include: {
      user: {
        select: { email: true, firstName: true, lastName: true },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: AuditAction.permission_changed,
      entityType: 'tenant_membership',
      entityId: membership.id,
      metadata: {
        tenantId,
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
      },
    },
  });

  return mapMembership(membership);
}

export async function updateTenantMembership(
  actorUserId: string,
  actorGlobalRole: ActorGlobalRole,
  tenantId: string,
  membershipId: string,
  body: UpdateTenantMemberBody,
) {
  await ensureTenantExists(tenantId);

  const permission = await resolveMembershipPermissionContext(
    actorUserId,
    actorGlobalRole,
    tenantId,
  );
  if (permission.manageableRoles.length === 0) {
    throw httpError(
      403,
      'TENANT_MEMBERSHIP_FORBIDDEN',
      'You do not have permission to update tenant memberships.',
    );
  }

  const existing = await prisma.tenantMembership.findUnique({
    where: { id: membershipId },
    select: { id: true, tenantId: true, role: true },
  });

  if (!existing || existing.tenantId !== tenantId) {
    throw httpError(404, 'TENANT_MEMBERSHIP_NOT_FOUND', 'Tenant membership not found.');
  }

  if (!permission.manageableRoles.includes(existing.role)) {
    throw httpError(
      403,
      'TENANT_MEMBERSHIP_FORBIDDEN',
      'You do not have permission to update this tenant role.',
    );
  }
  if (body.role && !permission.manageableRoles.includes(body.role)) {
    throw httpError(
      403,
      'TENANT_MEMBERSHIP_FORBIDDEN',
      'You do not have permission to assign this tenant role.',
    );
  }

  const membership = await prisma.tenantMembership.update({
    where: { id: membershipId },
    data: {
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    },
    include: {
      user: {
        select: { email: true, firstName: true, lastName: true },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: AuditAction.permission_changed,
      entityType: 'tenant_membership',
      entityId: membership.id,
      metadata: {
        tenantId,
        userId: membership.userId,
        changedFields: Object.keys(body),
      },
    },
  });

  return mapMembership(membership);
}

export async function listTenantInvites(
  actorUserId: string,
  actorGlobalRole: ActorGlobalRole,
  tenantId: string,
  query: ListTenantInvitesQuery,
) {
  await ensureTenantExists(tenantId);

  const actorTenantRole = actorGlobalRole === 'super_admin'
    ? null
    : await resolveActorTenantRole(actorUserId, tenantId);
  const allowedRoles = manageableInviteRoles(actorGlobalRole, actorTenantRole);
  if (allowedRoles.length === 0) {
    throw httpError(
      403,
      'TENANT_INVITE_FORBIDDEN',
      'You do not have permission to view tenant invites.',
    );
  }

  const where: Prisma.TenantInviteWhereInput = {
    tenantId,
    role: { in: allowedRoles },
    ...inviteWhereFromStatus(query.status),
  };

  const skip = (query.page - 1) * query.pageSize;
  const [total, invites] = await Promise.all([
    prisma.tenantInvite.count({ where }),
    prisma.tenantInvite.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.pageSize,
    }),
  ]);

  await logSensitiveReadAccess({
    actorUserId,
    tenantId,
    entityType: 'tenant_invite',
    source: 'tenants.invites.list',
    scope: 'list',
    resultCount: invites.length,
    query: {
      page: query.page,
      pageSize: query.pageSize,
      status: query.status ?? null,
    },
  });

  return {
    data: invites.map(mapInvite),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export async function createTenantInvite(
  actorUserId: string,
  actorGlobalRole: ActorGlobalRole,
  tenantId: string,
  body: CreateTenantInviteBody,
) {
  const tenant = await ensureTenantExists(tenantId);
  if (!tenant.isActive) {
    throw httpError(409, 'TENANT_INACTIVE', 'Tenant is inactive.');
  }

  await assertInvitePermission(actorUserId, actorGlobalRole, tenantId, body.role);

  const email = normalizeEmail(body.email);
  const now = new Date();

  const [existingPendingInvite, user] = await Promise.all([
    prisma.tenantInvite.findFirst({
      where: {
        tenantId,
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { email },
      select: { id: true },
    }),
  ]);

  if (existingPendingInvite) {
    throw httpError(
      409,
      'TENANT_INVITE_EXISTS',
      'A pending invite already exists for this email in the tenant.',
    );
  }

  if (user) {
    const existingMembership = await prisma.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId: user.id,
        },
      },
      select: { status: true },
    });

    if (existingMembership?.status === MembershipStatus.active) {
      throw httpError(409, 'TENANT_MEMBERSHIP_EXISTS', 'User already belongs to this tenant.');
    }
  }

  const inviteToken = randomBytes(INVITE_TOKEN_BYTES).toString('hex');
  const tokenHash = inviteTokenHash(inviteToken);
  const expiresAt = new Date(Date.now() + body.expiresInHours * 60 * 60 * 1_000);

  const invite = await prisma.tenantInvite.create({
    data: {
      tenantId,
      email,
      role: body.role,
      tokenHash,
      invitedById: actorUserId,
      expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: AuditAction.permission_changed,
      entityType: 'tenant_invite',
      entityId: invite.id,
      metadata: {
        tenantId,
        email,
        role: body.role,
        expiresAt: expiresAt.toISOString(),
      },
    },
  });

  // Fire-and-forget: invite creation should succeed even if downstream email delivery fails.
  void sendTenantInviteEmail({
    email,
    tenantName: tenant.name,
    role: body.role,
    inviteToken,
    expiresAt,
  }).catch((err: unknown) => logger.error({ msg: 'Failed to send tenant invite email', err, tenantId, email }));

  return {
    invite: mapInvite(invite),
    inviteToken,
  };
}

export async function acceptTenantInvite(
  actorUserId: string,
  actorEmail: string,
  body: AcceptTenantInviteBody,
) {
  const tokenHash = inviteTokenHash(body.token);
  const invite = await prisma.tenantInvite.findUnique({
    where: { tokenHash },
    include: {
      tenant: { select: { id: true, isActive: true } },
    },
  });

  if (!invite) {
    throw httpError(404, 'TENANT_INVITE_NOT_FOUND', 'Invite was not found or is invalid.');
  }

  if (invite.acceptedAt) {
    throw httpError(409, 'TENANT_INVITE_ALREADY_ACCEPTED', 'Invite has already been accepted.');
  }
  if (invite.revokedAt) {
    throw httpError(409, 'TENANT_INVITE_REVOKED', 'Invite has been revoked.');
  }
  if (invite.expiresAt <= new Date()) {
    throw httpError(410, 'TENANT_INVITE_EXPIRED', 'Invite has expired.');
  }
  if (!invite.tenant.isActive) {
    throw httpError(409, 'TENANT_INACTIVE', 'Tenant is inactive.');
  }
  if (normalizeEmail(actorEmail) !== normalizeEmail(invite.email)) {
    throw httpError(
      403,
      'TENANT_INVITE_EMAIL_MISMATCH',
      'Invite can only be accepted by the invited email address.',
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const existingMembership = await tx.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: invite.tenantId,
          userId: actorUserId,
        },
      },
    });

    const membership = existingMembership
      ? await tx.tenantMembership.update({
          where: { id: existingMembership.id },
          data: {
            role: invite.role,
            status: MembershipStatus.active,
            invitedById: invite.invitedById,
          },
          include: {
            user: { select: { email: true, firstName: true, lastName: true } },
          },
        })
      : await tx.tenantMembership.create({
          data: {
            tenantId: invite.tenantId,
            userId: actorUserId,
            role: invite.role,
            status: MembershipStatus.active,
            invitedById: invite.invitedById,
          },
          include: {
            user: { select: { email: true, firstName: true, lastName: true } },
          },
        });

    const acceptedInvite = await tx.tenantInvite.update({
      where: { id: invite.id },
      data: {
        acceptedAt: new Date(),
        acceptedByUserId: actorUserId,
      },
    });

    await tx.user.updateMany({
      where: { id: actorUserId, activeTenantId: null },
      data: { activeTenantId: invite.tenantId },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: AuditAction.permission_changed,
        entityType: 'tenant_invite',
        entityId: invite.id,
        metadata: {
          tenantId: invite.tenantId,
          role: invite.role,
          acceptedByUserId: actorUserId,
        },
      },
    });

    return { membership, invite: acceptedInvite };
  });

  return {
    membership: mapMembership(result.membership),
    invite: mapInvite(result.invite),
  };
}

export async function revokeTenantInvite(
  actorUserId: string,
  actorGlobalRole: ActorGlobalRole,
  tenantId: string,
  inviteId: string,
) {
  await ensureTenantExists(tenantId);
  const invite = await prisma.tenantInvite.findUnique({
    where: { id: inviteId },
  });

  if (!invite || invite.tenantId !== tenantId) {
    throw httpError(404, 'TENANT_INVITE_NOT_FOUND', 'Invite not found.');
  }

  await assertInvitePermission(actorUserId, actorGlobalRole, tenantId, invite.role);

  if (invite.acceptedAt) {
    throw httpError(409, 'TENANT_INVITE_ALREADY_ACCEPTED', 'Accepted invite cannot be revoked.');
  }

  if (invite.revokedAt) {
    return mapInvite(invite);
  }

  const revokedInvite = await prisma.tenantInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorUserId,
      action: AuditAction.permission_changed,
      entityType: 'tenant_invite',
      entityId: inviteId,
      metadata: { tenantId, role: invite.role, type: 'revoked' },
    },
  });

  return mapInvite(revokedInvite);
}
