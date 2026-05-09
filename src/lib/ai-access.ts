/**
 * Phase 8.1 — single source of truth for "is AI allowed for this request?".
 *
 * Used by every AI call site (chat, dashboard cards, chronology narrative).
 * Replaces the inconsistent inline checks that existed previously (e.g.
 * `assertAiAccessEnabled` in ai.service.ts which only fired on /ai/ask, never
 * on safeguarding chronology — meaning a user explicitly denied AI access
 * could still trigger expensive OpenAI calls via chronology browsing).
 *
 * Three-tier check:
 *   1. Server-level: `AI_ENABLED` env. If false, returns `globallyEnabled=false`
 *      so the caller can fall back silently. **Never throws on this** — the
 *      env switch is for ops/maintenance, not user-visible denial.
 *   2. Tenant-level: `Tenant.aiEnabled` AND (Phase 7+) subscription state.
 *      Throws 403 / 402 with a user-visible error.
 *   3. User-level: `TenantUser.aiAccessEnabled`. Throws 403 — a tenant Owner
 *      has chosen to deny this user AI access.
 *
 * The `surface` param exists so the helper can be extended to enforce
 * surface-specific limits later (e.g. chronology AI gated separately from
 * chat). It is also passed to `recordAiCall` for usage attribution.
 */

import type { AiCallStatus, AiCallSurface } from '@prisma/client';
import { env } from '../config/env.js';
import { httpError } from './errors.js';
import { prisma } from './prisma.js';

export interface AiAccessCheckArgs {
  userId: string;
  surface: AiCallSurface;
}

export interface AiAccessCheckResult {
  /**
   * True when `AI_ENABLED=true` in env. When false, callers should skip the
   * model call and use their deterministic fallback path. Not a user-visible
   * error — silent.
   */
  globallyEnabled: boolean;
  tenantId: string;
}

export async function assertAiEnabledForRequest(
  args: AiAccessCheckArgs,
): Promise<AiAccessCheckResult> {
  void args.surface;
  const user = await prisma.tenantUser.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      aiAccessEnabled: true,
      activeTenantId: true,
      activeTenant: {
        select: {
          id: true,
          aiEnabled: true,
          isActive: true,
          // Phase 7.1 (Day 2): once `subscriptionStatus` lands, gate billing
          // states here. Until then, any active tenant is treated as "OK".
          // subscriptionStatus: true,
        },
      },
    },
  });

  if (!user) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }
  if (!user.activeTenant) {
    throw httpError(403, 'TENANT_REQUIRED', 'An active tenant is required for AI access.');
  }
  if (!user.activeTenant.isActive) {
    throw httpError(403, 'TENANT_INACTIVE', 'This organisation is currently inactive.');
  }

  // Phase 7.1 will add a billing-state check here. Wired example (do NOT
  // uncomment until subscriptionStatus + Phase 7.1 enforcement middleware
  // ship):
  //
  //   const allowedStates = new Set(['trialing', 'active', 'past_due_grace']);
  //   if (!allowedStates.has(user.activeTenant.subscriptionStatus)) {
  //     throw httpError(
  //       402,
  //       'SUBSCRIPTION_PAST_DUE',
  //       'AI is unavailable while the subscription is past due. Update payment from Settings → Billing.',
  //     );
  //   }

  if (!user.activeTenant.aiEnabled) {
    throw httpError(
      403,
      'AI_DISABLED_FOR_TENANT',
      'AI access is disabled for this organisation. Contact your administrator.',
    );
  }

  if (!user.aiAccessEnabled) {
    throw httpError(
      403,
      'AI_ACCESS_DISABLED',
      'AI access is not enabled for your account. Contact your administrator.',
    );
  }

  return {
    globallyEnabled: env.AI_ENABLED,
    tenantId: user.activeTenant.id,
  };
}

// ─── AiCallEvent writer ──────────────────────────────────────────────────────

export interface RecordAiCallArgs {
  tenantId: string;
  userId: string;
  surface: AiCallSurface;
  model: string | null;
  status: AiCallStatus;
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number | null;
  errorReason?: string | null;
}

/**
 * Writes a row to `AiCallEvent`. Fire-and-forget — never blocks the request,
 * never throws upstream. Captures token counts when available so we can
 * attribute spend per-tenant, per-surface, per-user.
 *
 * Always written regardless of outcome (success / fallback / error /
 * quota_blocked) so spend monitoring is comprehensive.
 */
export async function recordAiCall(args: RecordAiCallArgs): Promise<void> {
  try {
    await prisma.aiCallEvent.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId,
        surface: args.surface,
        model: args.model,
        status: args.status,
        tokensIn: args.tokensIn ?? null,
        tokensOut: args.tokensOut ?? null,
        latencyMs: args.latencyMs ?? null,
        errorReason: args.errorReason ?? null,
      },
    });
  } catch {
    // Intentionally swallow — audit logging must never break the request path.
  }
}
