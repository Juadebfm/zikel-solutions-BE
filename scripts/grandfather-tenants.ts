/**
 * Phase 7.9 — one-shot grandfather migration for existing tenants.
 *
 * Walks every active tenant, idempotently:
 *   - Creates a Subscription row (status=trialing, +30 days)
 *   - Creates the initial TokenAllocation
 *   - Mirrors Tenant.subscriptionStatus
 *   - Writes a tenant_grandfathered BillingEvent
 * Then sends the Owner email (one per tenant). Already-grandfathered tenants
 * are skipped silently — re-running this is safe.
 *
 * Run after deploying the Phase 7 schema migration:
 *
 *   npm run grandfather:tenants
 *
 * Set DRY_RUN=1 to preview the affected tenants without touching anything.
 *
 * Usage notes:
 *   - Requires Stripe env to be set in production. In dev/local it'll create
 *     placeholder customer ids and the email goes to console.
 *   - Sends ONE email per Owner — if a tenant has multiple Owners (rare),
 *     the FIRST one (by membership createdAt) gets emailed. The Stripe
 *     Customer is also keyed to that Owner's email.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/lib/logger.js';
import {
  grandfatherAllActiveTenants,
  type GrandfatherTenantResult,
} from '../src/modules/billing/grandfather.service.js';
import { sendGrandfatheredTrialEmail } from '../src/lib/grandfather-email.js';

const DRY_RUN = process.env.DRY_RUN === '1';
const SKIP_EMAILS = process.env.SKIP_EMAILS === '1';

async function main(): Promise<void> {
  console.log('=== Grandfather migration ===');
  console.log(`DRY_RUN=${DRY_RUN ? 'YES (no DB writes, no emails)' : 'no'}`);
  console.log(`SKIP_EMAILS=${SKIP_EMAILS ? 'yes' : 'no (will fan out emails)'}`);
  console.log('');

  if (DRY_RUN) {
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true, subscription: null },
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`Would grandfather ${tenants.length} active tenants without a Subscription row:`);
    for (const t of tenants) {
      console.log(`  - ${t.name} (${t.slug}) — ${t.id}`);
    }
    await prisma.$disconnect();
    return;
  }

  const { results, errors } = await grandfatherAllActiveTenants();

  const newlyGrandfathered = results.filter((r) => !r.alreadyGrandfathered);
  const alreadyDone = results.filter((r) => r.alreadyGrandfathered);

  console.log(`\nDone:`);
  console.log(`  Newly grandfathered: ${newlyGrandfathered.length}`);
  console.log(`  Already grandfathered (skipped): ${alreadyDone.length}`);
  console.log(`  Errors: ${errors.length}`);
  for (const e of errors) {
    console.log(`    - ${e.tenantId}: ${e.error}`);
  }

  if (SKIP_EMAILS) {
    console.log('\nEmails skipped (SKIP_EMAILS=1).');
  } else if (newlyGrandfathered.length > 0) {
    console.log(`\nSending ${newlyGrandfathered.length} Owner emails…`);
    let sent = 0;
    let skipped = 0;
    for (const r of newlyGrandfathered) {
      if (!r.ownerEmail) {
        skipped += 1;
        logger.warn({
          msg: 'grandfather: tenant has no active Owner — skipping email',
          tenantId: r.tenantId,
        });
        continue;
      }
      await sendGrandfatheredTrialEmail({
        ownerEmail: r.ownerEmail,
        ownerName: r.ownerName ?? '',
        tenantName: r.tenantName,
        trialEndsAt: r.trialEndsAt,
      });
      sent += 1;
    }
    console.log(`  Sent: ${sent}`);
    console.log(`  Skipped (no Owner): ${skipped}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('❌ Grandfather migration failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
