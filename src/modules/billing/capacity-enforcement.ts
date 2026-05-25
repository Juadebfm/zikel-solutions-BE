/**
 * Plan-tier capacity enforcement.
 *
 * Each Plan defines `maxHomes` and `maxSeats` caps. Each Subscription can
 * override them per-tenant (`maxHomesOverride` / `maxSeatsOverride`) — used for
 * Group-tier bespoke contracts. Null = unlimited.
 *
 * Effective cap = `subscription.<x>Override ?? subscription.plan.<x>`.
 *
 * Called from:
 *   - `homes.service.createHome`  → `assertHomeCapAvailable`
 *   - `invitations.service.createInvitation` → `assertSeatCapAvailable`
 *
 * Throws `httpError(402, ...)` when at or over cap. 402 ("Payment Required") is
 * the spec-correct status for "you can do this if you upgrade your plan."
 */

import { InvitationStatus, MembershipStatus } from '@prisma/client';
import { httpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

export async function assertHomeCapAvailable(tenantId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    select: {
      maxHomesOverride: true,
      plan: { select: { maxHomes: true, code: true, name: true } },
    },
  });

  if (!subscription) {
    // Pre-Subscription state — should not happen in production (every tenant
    // gets a Subscription on signup). Log loudly and let the operation through
    // rather than block legitimate dev/test work.
    logger.warn({
      msg: 'assertHomeCapAvailable: tenant has no Subscription; skipping cap check',
      tenantId,
    });
    return;
  }

  const effectiveMax = subscription.maxHomesOverride ?? subscription.plan.maxHomes;
  if (effectiveMax === null) return; // Group tier or explicit override to unlimited.

  const current = await prisma.home.count({
    where: { tenantId, isActive: true },
  });

  if (current >= effectiveMax) {
    throw httpError(
      402,
      'HOME_LIMIT_REACHED',
      `Home limit reached. You're using ${current} of ${effectiveMax} ` +
        `home${effectiveMax === 1 ? '' : 's'} on the ${subscription.plan.name} plan. ` +
        `Upgrade your plan to add more homes.`,
    );
  }
}

export async function assertSeatCapAvailable(tenantId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    select: {
      maxSeatsOverride: true,
      plan: { select: { maxSeats: true, code: true, name: true } },
    },
  });

  if (!subscription) {
    logger.warn({
      msg: 'assertSeatCapAvailable: tenant has no Subscription; skipping cap check',
      tenantId,
    });
    return;
  }

  const effectiveMax = subscription.maxSeatsOverride ?? subscription.plan.maxSeats;
  if (effectiveMax === null) return;

  // A "seat" is one of: an active membership, or an outstanding non-expired
  // pending invitation. Pending invites count so a tenant can't blast 100
  // invitations to bypass the cap before any redeem.
  const now = new Date();
  const [activeMembers, pendingInvites] = await Promise.all([
    prisma.tenantMembership.count({
      where: { tenantId, status: MembershipStatus.active },
    }),
    prisma.invitation.count({
      where: {
        tenantId,
        status: InvitationStatus.pending,
        expiresAt: { gt: now },
      },
    }),
  ]);
  const current = activeMembers + pendingInvites;

  if (current >= effectiveMax) {
    throw httpError(
      402,
      'SEAT_LIMIT_REACHED',
      `Staff seat limit reached. You're using ${current} of ${effectiveMax} ` +
        `seats on the ${subscription.plan.name} plan ` +
        `(${activeMembers} active, ${pendingInvites} pending invitation${pendingInvites === 1 ? '' : 's'}). ` +
        `Upgrade your plan to invite more staff.`,
    );
  }
}
