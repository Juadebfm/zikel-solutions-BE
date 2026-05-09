import { AuditAction, MembershipStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import { withUnscopedTenant } from '../../lib/request-context.js';
import {
  sendTenantSuspendedEmail,
  sendTenantReactivatedEmail,
} from '../../lib/tenant-lifecycle-email.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logPlatformAudit(args: {
  platformUserId: string;
  action: AuditAction;
  targetTenantId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.platformAuditLog.create({
      data: {
        platformUserId: args.platformUserId,
        action: args.action,
        targetTenantId: args.targetTenantId ?? null,
        entityType: args.entityType ?? null,
        entityId: args.entityId ?? null,
        metadata: args.metadata ?? Prisma.JsonNull,
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
      },
    });
  } catch {
    // Fire-and-forget: never block a request on audit-log failure.
  }
}

// ─── Listing ─────────────────────────────────────────────────────────────────

export interface ListTenantsArgs {
  page: number;
  pageSize: number;
  search?: string;
  isActive?: boolean;
  country?: 'UK' | 'Nigeria';
}

export async function listTenantsForPlatform(args: ListTenantsArgs) {
  const where: Prisma.TenantWhereInput = {};
  if (args.isActive !== undefined) where.isActive = args.isActive;
  if (args.country) where.country = args.country;
  if (args.search) {
    where.OR = [
      { name: { contains: args.search, mode: 'insensitive' } },
      { slug: { contains: args.search, mode: 'insensitive' } },
    ];
  }

  return withUnscopedTenant(async () => {
    const [total, rows] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (args.page - 1) * args.pageSize,
        take: args.pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          country: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              memberships: { where: { status: MembershipStatus.active } },
              homes: true,
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        country: t.country,
        isActive: t.isActive,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        activeMemberCount: t._count.memberships,
        homeCount: t._count.homes,
      })),
      meta: {
        total,
        page: args.page,
        pageSize: args.pageSize,
        totalPages: Math.max(1, Math.ceil(total / args.pageSize)),
      },
    };
  });
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export async function getTenantForPlatform(tenantId: string) {
  return withUnscopedTenant(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        country: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            memberships: { where: { status: MembershipStatus.active } },
            homes: true,
            youngPeople: true,
            employees: true,
          },
        },
      },
    });
    if (!tenant) {
      throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }

    // Surface the Owner(s) so platform staff can see who to contact.
    const owners = await prisma.tenantMembership.findMany({
      where: {
        tenantId,
        status: MembershipStatus.active,
        role: { name: 'Owner' },
      },
      select: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      country: tenant.country,
      isActive: tenant.isActive,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      stats: {
        activeMemberCount: tenant._count.memberships,
        homeCount: tenant._count.homes,
        youngPeopleCount: tenant._count.youngPeople,
        employeeCount: tenant._count.employees,
      },
      owners: owners.map((o) => o.user),
    };
  });
}

// ─── Suspend / reactivate ────────────────────────────────────────────────────

/**
 * Resolves the Owner contacts for a tenant and the platform user's email.
 * Used by suspend/reactivate to populate the lifecycle notification email.
 * Returns empty arrays/null if the lookup fails — caller treats as "no
 * recipients" and the email step is silently skipped.
 */
async function resolveLifecycleEmailRecipients(args: {
  tenantId: string;
  platformUserId: string;
}): Promise<{
  owners: Array<{ email: string; firstName: string; lastName: string }>;
  platformUserEmail: string | null;
}> {
  try {
    const [owners, platformUser] = await Promise.all([
      prisma.tenantMembership.findMany({
        where: {
          tenantId: args.tenantId,
          status: MembershipStatus.active,
          role: { name: 'Owner' },
        },
        select: {
          user: {
            select: { email: true, firstName: true, lastName: true, isActive: true },
          },
        },
      }),
      prisma.platformUser.findUnique({
        where: { id: args.platformUserId },
        select: { email: true },
      }),
    ]);
    return {
      owners: owners
        .map((o) => o.user)
        .filter((u) => u.isActive)
        .map((u) => ({ email: u.email, firstName: u.firstName, lastName: u.lastName })),
      platformUserEmail: platformUser?.email ?? null,
    };
  } catch {
    return { owners: [], platformUserEmail: null };
  }
}

export async function suspendTenant(args: {
  platformUserId: string;
  tenantId: string;
  reason: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return withUnscopedTenant(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { id: true, isActive: true, name: true },
    });
    if (!tenant) {
      throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }
    if (!tenant.isActive) {
      throw httpError(409, 'TENANT_ALREADY_SUSPENDED', 'Tenant is already suspended.');
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.tenant.update({
        where: { id: tenant.id },
        data: { isActive: false },
      }),
      // Revoke all active sessions and refresh tokens for the tenant's users
      // so they cannot continue using the system after suspension takes effect.
      prisma.tenantSession.updateMany({
        where: {
          revokedAt: null,
          user: { tenantMemberships: { some: { tenantId: tenant.id } } },
        },
        data: { revokedAt: now },
      }),
      prisma.refreshToken.updateMany({
        where: {
          revokedAt: null,
          user: { tenantMemberships: { some: { tenantId: tenant.id } } },
        },
        data: { revokedAt: now },
      }),
    ]);

    void logPlatformAudit({
      platformUserId: args.platformUserId,
      action: AuditAction.permission_changed,
      targetTenantId: tenant.id,
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: { event: 'tenant_suspended', reason: args.reason, name: tenant.name },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });

    // Best-effort Owner notification (one email per Owner). Fire-and-forget:
    // the suspension already took effect transactionally — don't gate the
    // response on email delivery.
    void (async () => {
      const recipients = await resolveLifecycleEmailRecipients({
        tenantId: tenant.id,
        platformUserId: args.platformUserId,
      });
      const platformUserEmail = recipients.platformUserEmail ?? 'Zikel Support';
      for (const owner of recipients.owners) {
        await sendTenantSuspendedEmail({
          ownerEmail: owner.email,
          ownerName: `${owner.firstName} ${owner.lastName}`.trim(),
          tenantName: tenant.name,
          reason: args.reason,
          platformUserEmail,
          actionedAt: now,
        });
      }
    })();

    return { id: tenant.id, isActive: false };
  });
}

export async function reactivateTenant(args: {
  platformUserId: string;
  tenantId: string;
  reason: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  return withUnscopedTenant(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { id: true, isActive: true, name: true },
    });
    if (!tenant) {
      throw httpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }
    if (tenant.isActive) {
      throw httpError(409, 'TENANT_ALREADY_ACTIVE', 'Tenant is already active.');
    }

    const now = new Date();
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { isActive: true },
    });

    void logPlatformAudit({
      platformUserId: args.platformUserId,
      action: AuditAction.permission_changed,
      targetTenantId: tenant.id,
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: { event: 'tenant_reactivated', reason: args.reason, name: tenant.name },
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    });

    // Best-effort Owner notification — same fire-and-forget pattern as suspend.
    void (async () => {
      const recipients = await resolveLifecycleEmailRecipients({
        tenantId: tenant.id,
        platformUserId: args.platformUserId,
      });
      const platformUserEmail = recipients.platformUserEmail ?? 'Zikel Support';
      for (const owner of recipients.owners) {
        await sendTenantReactivatedEmail({
          ownerEmail: owner.email,
          ownerName: `${owner.firstName} ${owner.lastName}`.trim(),
          tenantName: tenant.name,
          reason: args.reason,
          platformUserEmail,
          actionedAt: now,
        });
      }
    })();

    return { id: tenant.id, isActive: true };
  });
}
