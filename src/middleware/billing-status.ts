/**
 * Phase 7.7 — billing-state enforcement.
 *
 * `requireActiveSubscription` is mounted on every tenant-side mutating route
 * EXCEPT `/api/v1/billing/*` and `/api/v1/auth/*` (which must stay open so
 * the Owner can pay / log in / reset password). When a tenant's subscription
 * is in a blocking state, the middleware short-circuits with 402 (or 403
 * for incomplete signups).
 *
 * Status → behaviour matrix (locked in payment.md C):
 *
 *   trialing            → all access (default for new + grandfathered tenants)
 *   active              → all access
 *   past_due_grace      → all access (banner shown; cron promotes to readonly)
 *   past_due_readonly   → mutations / AI / exports → 402 SUBSCRIPTION_PAST_DUE
 *   incomplete          → mutations / AI / exports → 402 SUBSCRIPTION_INCOMPLETE
 *   suspended           → handled by existing Phase 6 mechanism (Tenant.isActive=false)
 *   cancelled           → handled by existing Phase 6 mechanism (Tenant.isActive=false)
 *
 * Suspended/cancelled tenants are blocked at login by the existing
 * `Tenant.isActive=false` filter, so this middleware doesn't need to handle
 * those — by the time the request authenticates, isActive=true is guaranteed.
 *
 * `manuallyOverriddenUntil` short-circuits the gate with full access until
 * that timestamp passes — used by platform_admin support escalations.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../types/index.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

const GATED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cache subscription status per-request so multiple middleware invocations
 * (e.g. mounted at the v1 prefix AND on a specific route) don't re-hit the
 * DB. Stored on the request via Symbol so it's invisible to handlers.
 */
const STATUS_CACHE_SYMBOL = Symbol('billingStatusCache');

interface CachedStatus {
  status: string | null;
  manuallyOverriddenUntil: Date | null;
}

async function loadStatusForRequest(
  request: FastifyRequest,
): Promise<CachedStatus> {
  const cached = (request as unknown as Record<symbol, CachedStatus | undefined>)[
    STATUS_CACHE_SYMBOL
  ];
  if (cached) return cached;

  const user = request.user as JwtPayload | undefined;
  if (!user || !user.tenantId) {
    return { status: null, manuallyOverriddenUntil: null };
  }
  // Defensive: if Prisma blows up (model unmocked in tests, transient DB
  // outage, etc.) treat as permissive. Locking real customers out because
  // our infrastructure hiccupped is worse than briefly missing enforcement.
  let subscription: {
    status: string;
    manuallyOverriddenUntil: Date | null;
  } | null = null;
  try {
    subscription = await prisma.subscription.findUnique({
      where: { tenantId: user.tenantId },
      select: { status: true, manuallyOverriddenUntil: true },
    });
  } catch (err) {
    logger.warn({
      msg: 'billing-status middleware: subscription lookup failed; treating as permissive',
      tenantId: user.tenantId,
      err: err instanceof Error ? err.message : 'unknown',
    });
    subscription = null;
  }
  const result: CachedStatus = subscription
    ? {
        status: subscription.status,
        manuallyOverriddenUntil: subscription.manuallyOverriddenUntil ?? null,
      }
    : { status: null, manuallyOverriddenUntil: null };
  (request as unknown as Record<symbol, CachedStatus>)[STATUS_CACHE_SYMBOL] = result;
  return result;
}

/**
 * Blocks mutations / AI / exports when the tenant's subscription is in a
 * non-allowing state. Allow paths: trialing, active, past_due_grace.
 *
 * Apply with `preHandler: [requireActiveSubscription]` on routes that should
 * be gated. Or mount as a global hook on a sub-plugin and use
 * `requireActiveSubscription` plus a per-route bypass for billing/auth.
 *
 * Subscription unconfigured (no row) → ALLOW. The grandfather migration
 * fills these in for existing tenants and the register flow creates them
 * for new ones; the only way to reach this code with no subscription row is
 * a misconfigured test or transitional state. Treat as trialing rather than
 * locking the whole tenant out.
 */
export async function requireActiveSubscription(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user as JwtPayload | undefined;
  if (!user) {
    return reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });
  }

  // GETs always pass through — matches the read-only matrix in payment.md
  // (read access stays open during past_due_readonly so the business doesn't
  // grind to a halt; mutations + AI/exports are blocked instead).
  if (!GATED_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  // Impersonation tokens (platform_admin → tenant) bypass the gate. Support
  // engineers shouldn't be locked out of a past-due tenant they're trying
  // to debug.
  if (user.impersonatorId) {
    return;
  }

  const { status, manuallyOverriddenUntil } = await loadStatusForRequest(request);

  // No subscription row → permissive (transitional state; grandfather will
  // backfill). Logged once at info level if we ever hit this in prod.
  if (!status) {
    return;
  }

  // Manual override (support escalation) — full access until expiry.
  if (
    manuallyOverriddenUntil !== null &&
    manuallyOverriddenUntil.getTime() > Date.now()
  ) {
    return;
  }

  if (status === 'past_due_readonly') {
    return reply.status(402).send({
      success: false,
      error: {
        code: 'SUBSCRIPTION_PAST_DUE',
        message:
          'Subscription is past due. Update your payment method from Settings → Billing to restore access.',
      },
    });
  }
  if (status === 'incomplete') {
    return reply.status(402).send({
      success: false,
      error: {
        code: 'SUBSCRIPTION_INCOMPLETE',
        message:
          'Subscription is not yet active. Complete checkout from Settings → Billing.',
      },
    });
  }
  // suspended / cancelled never reach here — Tenant.isActive=false blocks
  // login. trialing / active / past_due_grace pass through.
}
