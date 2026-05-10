/**
 * Phase 7.5 — Plan + TopUpPack seeding.
 *
 * Idempotent (`upsert` keyed on `code`). Reads env vars to populate the
 * `stripePriceId` column so the service can hand the right priceId to Stripe
 * Checkout. Safe to call repeatedly — running it again with new env values
 * updates the existing rows.
 *
 * Called on app boot (server.ts) so that newly-deployed environments have
 * Plan rows ready as soon as Stripe env is set. If env isn't set, the seeder
 * is a no-op (logged at info level so engineers know billing isn't wired).
 */

import type { PlanInterval } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

interface PlanSeed {
  code: string;
  name: string;
  interval: PlanInterval;
  unitAmountMinor: number;
  bundledCallsPerPeriod: number;
  stripePriceIdEnv: string | undefined;
}

interface TopUpSeed {
  code: string;
  name: string;
  unitAmountMinor: number;
  calls: number;
  stripePriceIdEnv: string | undefined;
}

const PLANS: PlanSeed[] = [
  {
    code: 'standard_monthly',
    name: 'Zikel Solutions — Standard (Monthly)',
    interval: 'month',
    unitAmountMinor: 3000, // £30.00
    bundledCallsPerPeriod: 1000,
    stripePriceIdEnv: env.STRIPE_PRICE_ID_MONTHLY,
  },
  {
    code: 'standard_annual',
    name: 'Zikel Solutions — Standard (Annual)',
    interval: 'year',
    unitAmountMinor: 30000, // £300.00 (= 2 months free)
    bundledCallsPerPeriod: 1000,
    stripePriceIdEnv: env.STRIPE_PRICE_ID_ANNUAL,
  },
];

const TOP_UPS: TopUpSeed[] = [
  {
    code: 'topup_small',
    name: 'Zikel Solutions — 250 AI Calls Top-Up',
    unitAmountMinor: 500, // £5.00
    calls: 250,
    stripePriceIdEnv: env.STRIPE_PRICE_ID_TOPUP_SMALL,
  },
  {
    code: 'topup_medium',
    name: 'Zikel Solutions — 1,000 AI Calls Top-Up',
    unitAmountMinor: 1500, // £15.00
    calls: 1000,
    stripePriceIdEnv: env.STRIPE_PRICE_ID_TOPUP_MEDIUM,
  },
  {
    code: 'topup_large',
    name: 'Zikel Solutions — 5,000 AI Calls Top-Up',
    unitAmountMinor: 4000, // £40.00
    calls: 5000,
    stripePriceIdEnv: env.STRIPE_PRICE_ID_TOPUP_LARGE,
  },
];

/**
 * Upsert Plan + TopUpPack rows. Safe to call on every boot — uses `upsert`
 * keyed on `code` so values get refreshed if env changes. Returns the number
 * of plans seeded vs skipped (skipped = no env value for stripePriceId).
 */
export async function seedBillingProducts(): Promise<{
  plansSeeded: number;
  plansSkipped: number;
  topUpsSeeded: number;
  topUpsSkipped: number;
}> {
  let plansSeeded = 0;
  let plansSkipped = 0;
  let topUpsSeeded = 0;
  let topUpsSkipped = 0;

  for (const seed of PLANS) {
    if (!seed.stripePriceIdEnv) {
      plansSkipped += 1;
      logger.info({
        msg: 'Billing seed: skipping plan (no Stripe price id in env)',
        code: seed.code,
      });
      continue;
    }
    await prisma.plan.upsert({
      where: { code: seed.code },
      create: {
        code: seed.code,
        name: seed.name,
        interval: seed.interval,
        unitAmountMinor: seed.unitAmountMinor,
        bundledCallsPerPeriod: seed.bundledCallsPerPeriod,
        stripePriceId: seed.stripePriceIdEnv,
        isActive: true,
      },
      update: {
        name: seed.name,
        unitAmountMinor: seed.unitAmountMinor,
        bundledCallsPerPeriod: seed.bundledCallsPerPeriod,
        stripePriceId: seed.stripePriceIdEnv,
        isActive: true,
      },
    });
    plansSeeded += 1;
  }

  for (const seed of TOP_UPS) {
    if (!seed.stripePriceIdEnv) {
      topUpsSkipped += 1;
      logger.info({
        msg: 'Billing seed: skipping top-up pack (no Stripe price id in env)',
        code: seed.code,
      });
      continue;
    }
    await prisma.topUpPack.upsert({
      where: { code: seed.code },
      create: {
        code: seed.code,
        name: seed.name,
        unitAmountMinor: seed.unitAmountMinor,
        calls: seed.calls,
        stripePriceId: seed.stripePriceIdEnv,
        isActive: true,
      },
      update: {
        name: seed.name,
        unitAmountMinor: seed.unitAmountMinor,
        calls: seed.calls,
        stripePriceId: seed.stripePriceIdEnv,
        isActive: true,
      },
    });
    topUpsSeeded += 1;
  }

  return { plansSeeded, plansSkipped, topUpsSeeded, topUpsSkipped };
}
