/**
 * One-shot ops script — refreshes the permission list on every active tenant's
 * system Role rows (Owner, Admin, Residential Care Worker, Viewer) to match
 * the current contents of `SYSTEM_ROLE_PERMISSIONS` in src/auth/permissions.ts.
 *
 * Why this exists:
 *   The system-role seeder runs at tenant creation only. When we add a new
 *   permission code to the catalogue (e.g. `generative:create` in AI Phase 1),
 *   existing tenants' Role rows are NOT updated automatically — their
 *   `permissions` arrays stay frozen at whatever shipped on the day they
 *   were created. Without this refresh, users see 403 PERMISSION_DENIED when
 *   calling new endpoints even though their role logically should allow it.
 *
 * Safety:
 *   - Idempotent. The seeder's upsert writes the FULL current permission
 *     list on every call, so running this twice is harmless.
 *   - Only touches rows where `isSystemRole = true`. Custom tenant roles
 *     built via the role-builder UI are not touched.
 *   - DRY_RUN=1 prints what would change without writing.
 *
 * Run AFTER any deploy that adds new permission codes to
 * `src/auth/permissions.ts`:
 *
 *   npm run refresh:role-permissions
 *
 * Or preview first:
 *
 *   DRY_RUN=1 npm run refresh:role-permissions
 */

// Must come before any module that reads process.env. See src/lib/load-env.ts.
import '../src/lib/load-env.js';
import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/lib/logger.js';
import { seedSystemRolesForTenant } from '../src/auth/system-roles.js';
import { SYSTEM_ROLE_NAMES, SYSTEM_ROLE_PERMISSIONS } from '../src/auth/permissions.js';

const DRY_RUN = process.env.DRY_RUN === '1';

interface Diff {
  tenantId: string;
  tenantName: string;
  roleName: string;
  added: string[];
  removed: string[];
}

async function main(): Promise<void> {
  console.log('=== Refresh system role permissions ===');
  console.log(`DRY_RUN=${DRY_RUN ? 'YES (no DB writes)' : 'no'}`);
  console.log('');

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${tenants.length} active tenants.`);
  console.log('');

  const diffs: Diff[] = [];

  for (const tenant of tenants) {
    // Fetch current permissions for the four system roles.
    const existing = await prisma.role.findMany({
      where: {
        tenantId: tenant.id,
        isSystemRole: true,
        name: { in: [...SYSTEM_ROLE_NAMES] },
      },
      select: { name: true, permissions: true },
    });
    const existingByName = new Map(existing.map((r) => [r.name, new Set(r.permissions)]));

    for (const roleName of SYSTEM_ROLE_NAMES) {
      const expected = new Set(SYSTEM_ROLE_PERMISSIONS[roleName]);
      const current = existingByName.get(roleName) ?? new Set<string>();

      const added = [...expected].filter((p) => !current.has(p));
      const removed = [...current].filter((p) => !expected.has(p));

      if (added.length > 0 || removed.length > 0) {
        diffs.push({
          tenantId: tenant.id,
          tenantName: tenant.name,
          roleName,
          added,
          removed,
        });
      }
    }
  }

  if (diffs.length === 0) {
    console.log('All system role permissions already match catalogue. Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${diffs.length} role rows out of sync:`);
  for (const diff of diffs) {
    const adds = diff.added.length ? `+[${diff.added.join(', ')}]` : '';
    const removes = diff.removed.length ? `-[${diff.removed.join(', ')}]` : '';
    console.log(`  ${diff.tenantName} → ${diff.roleName}: ${adds} ${removes}`.trim());
  }
  console.log('');

  if (DRY_RUN) {
    console.log('DRY_RUN — no writes performed. Re-run without DRY_RUN to apply.');
    await prisma.$disconnect();
    return;
  }

  console.log('Applying refresh via seedSystemRolesForTenant() (idempotent upserts)...');
  let refreshed = 0;
  let errors = 0;
  // De-dupe by tenantId so we only call the seeder once per tenant.
  const tenantIds = [...new Set(diffs.map((d) => d.tenantId))];
  for (const tenantId of tenantIds) {
    try {
      await seedSystemRolesForTenant(tenantId);
      refreshed += 1;
    } catch (err) {
      errors += 1;
      logger.error({
        msg: 'refresh-system-role-permissions: failed to refresh tenant',
        tenantId,
        err: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  console.log('');
  console.log(`Done. Refreshed ${refreshed} tenant${refreshed === 1 ? '' : 's'}, ${errors} error${errors === 1 ? '' : 's'}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('❌ refresh-system-role-permissions failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
