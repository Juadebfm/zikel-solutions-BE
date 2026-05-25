/**
 * Plan + TopUpPack seeding.
 *
 * Idempotent (`upsert` keyed on `code`). Reads env vars to populate the
 * `stripePriceId` column on metered tiers (Single Home, Multi-Home). The
 * Group tier is sales-led — it always seeds, even without Stripe env,
 * because there's no Stripe Price to wire and contracts are created manually.
 *
 * Called on app boot (server.ts) so newly-deployed environments have Plan
 * rows ready as soon as Stripe env is set. If the metered env isn't set,
 * Single Home + Multi-Home are skipped (info-logged); Group still seeds.
 *
 * Also deactivates any legacy Plan rows from the pre-tiered model
 * (`standard_monthly`, `standard_annual`) so they stop appearing on the
 * pricing page. They are NOT deleted to preserve FK integrity for any
 * Subscription that still references them in a dev DB.
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
  pricePerBedMinor: number | null;
  maxHomes: number | null;
  maxSeats: number | null;
  bundledCallsPerPeriod: number;
  stripePriceIdEnv: string | undefined;
  /**
   * Sales-led tiers (Group) seed even without a Stripe Price id — there's
   * nothing to wire because contracts are bespoke.
   */
  salesLed: boolean;
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
    code: 'single_home',
    name: 'Zikel Solutions — Single Home',
    interval: 'month',
    unitAmountMinor: 0, // metered: invoice = beds × pricePerBedMinor
    pricePerBedMinor: 700, // £7 / bed / month
    maxHomes: 1,
    maxSeats: 25,
    bundledCallsPerPeriod: 1000,
    stripePriceIdEnv: env.STRIPE_PRICE_ID_SINGLE_HOME,
    salesLed: false,
  },
  {
    code: 'multi_home',
    name: 'Zikel Solutions — Multi-Home',
    interval: 'month',
    unitAmountMinor: 0,
    pricePerBedMinor: 700, // same £7 / bed / month — tier difference is capacity, not rate
    maxHomes: 5,
    maxSeats: 75,
    bundledCallsPerPeriod: 5000,
    stripePriceIdEnv: env.STRIPE_PRICE_ID_MULTI_HOME,
    salesLed: false,
  },
  {
    code: 'group',
    name: 'Zikel Solutions — Group',
    interval: 'month',
    unitAmountMinor: 0,
    pricePerBedMinor: null, // custom — per-contract
    maxHomes: null, // unlimited
    maxSeats: null,
    bundledCallsPerPeriod: 50000, // high default; per-contract Subscription overrides this
    stripePriceIdEnv: undefined,
    salesLed: true,
  },
];

const LEGACY_PLAN_CODES = ['standard_monthly', 'standard_annual'];

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
 * keyed on `code` so values get refreshed if env or seed config changes.
 * Returns counters for plans / top-ups seeded vs skipped.
 */
export async function seedBillingProducts(): Promise<{
  plansSeeded: number;
  plansSkipped: number;
  topUpsSeeded: number;
  topUpsSkipped: number;
  legacyDeactivated: number;
}> {
  let plansSeeded = 0;
  let plansSkipped = 0;
  let topUpsSeeded = 0;
  let topUpsSkipped = 0;

  // Deactivate any legacy pre-tiered plan rows so they stop showing on the
  // pricing page. Soft-deactivate (not delete) to keep FK integrity for any
  // dev Subscription still referencing them.
  const legacy = await prisma.plan.updateMany({
    where: { code: { in: LEGACY_PLAN_CODES }, isActive: true },
    data: { isActive: false },
  });

  for (const seed of PLANS) {
    if (!seed.salesLed && !seed.stripePriceIdEnv) {
      plansSkipped += 1;
      logger.info({
        msg: 'Billing seed: skipping metered plan (no Stripe price id in env)',
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
        pricePerBedMinor: seed.pricePerBedMinor,
        maxHomes: seed.maxHomes,
        maxSeats: seed.maxSeats,
        bundledCallsPerPeriod: seed.bundledCallsPerPeriod,
        stripePriceId: seed.stripePriceIdEnv ?? null,
        isActive: true,
      },
      update: {
        name: seed.name,
        unitAmountMinor: seed.unitAmountMinor,
        pricePerBedMinor: seed.pricePerBedMinor,
        maxHomes: seed.maxHomes,
        maxSeats: seed.maxSeats,
        bundledCallsPerPeriod: seed.bundledCallsPerPeriod,
        stripePriceId: seed.stripePriceIdEnv ?? null,
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

  return {
    plansSeeded,
    plansSkipped,
    topUpsSeeded,
    topUpsSkipped,
    legacyDeactivated: legacy.count,
  };
}
