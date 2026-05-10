/**
 * Phase 7.3 — Stripe SDK singleton.
 *
 * The Stripe API version is **pinned** via `STRIPE_API_VERSION` env. Stripe
 * ships breaking changes between versions; do NOT let the SDK pick the
 * default. When upgrading, do it deliberately and run the full Stripe-sandbox
 * probe.
 *
 * In dev/test, `STRIPE_SECRET_KEY` may be unset — `getStripeClient()` returns
 * `null` in that case. Callers that need a client (any billing route) should
 * call `requireStripeClient()` which throws 503 if billing is unconfigured.
 */

import Stripe from 'stripe';
import { env } from '../config/env.js';
import { httpError } from './errors.js';

let cached: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  if (cached) return cached;
  if (!env.STRIPE_SECRET_KEY) return null;
  cached = new Stripe(env.STRIPE_SECRET_KEY, {
    // Pin the API version — required for production stability. The cast is
    // necessary because Stripe's SDK types lock `apiVersion` to a literal
    // union of known SDK versions; we want to honor the env value (which a
    // careful upgrade may set to a newer version) without bumping the SDK.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiVersion: env.STRIPE_API_VERSION as any,
    // Helpful telemetry for Stripe support if a request misbehaves.
    appInfo: {
      name: 'Zikel Solutions',
      version: '1.0.0',
    },
    // Slightly higher timeout for Checkout / Portal session creation.
    timeout: 20_000,
  });
  return cached;
}

/**
 * Loads the singleton or throws 503 if Stripe isn't configured. Use this in
 * any billing service that needs the SDK (checkout-session creation, portal
 * URL, etc).
 */
export function requireStripeClient(): Stripe {
  const client = getStripeClient();
  if (!client) {
    throw httpError(
      503,
      'BILLING_NOT_CONFIGURED',
      'Billing is not configured for this environment. Contact support.',
    );
  }
  return client;
}

/**
 * Test-only helper to reset the cached client between tests. Calling it in
 * production code paths is a logic error.
 */
export function __resetStripeClientForTests(): void {
  cached = null;
}
