import { prisma } from '../lib/prisma.js';
import { SYSTEM_ROLE_NAMES, SYSTEM_ROLE_PERMISSIONS, type SystemRoleName } from './permissions.js';

// Accept any Prisma client-like object (the global extended client OR a
// TransactionClient inside $transaction). The minimal contract we need is
// the `role` model accessor with upsert/findUnique.
type PrismaLike = { role: typeof prisma.role };

/**
 * Seeds the four system roles (Owner, Admin, Care Worker, Read-Only) for a tenant.
 * Idempotent — safe to call on tenant creation. Uses upsert so it can also be
 * used to refresh permission lists if the catalog changes.
 *
 * Pass an optional `tx` to participate in an outer Prisma transaction.
 *
 * Returns a map of role-name → role-id so the caller can assign membership roles.
 */
export async function seedSystemRolesForTenant(
  tenantId: string,
  tx?: PrismaLike,
): Promise<Record<SystemRoleName, string>> {
  const client = tx ?? prisma;
  const result = {} as Record<SystemRoleName, string>;

  for (const name of SYSTEM_ROLE_NAMES) {
    const role = await client.role.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {
        permissions: SYSTEM_ROLE_PERMISSIONS[name],
      },
      create: {
        tenantId,
        name,
        description: descriptionFor(name),
        permissions: SYSTEM_ROLE_PERMISSIONS[name],
        isSystemRole: true,
        isAssignable: true,
      },
    });
    result[name] = role.id;
  }

  return result;
}

/**
 * Looks up a tenant's system role by name. Throws if missing — system roles must
 * exist post-tenant-creation; an absence indicates a seeding failure.
 */
export async function getSystemRoleId(
  tenantId: string,
  name: SystemRoleName,
  tx?: PrismaLike,
): Promise<string> {
  const client = tx ?? prisma;
  const role = await client.role.findUnique({
    where: { tenantId_name: { tenantId, name } },
    select: { id: true },
  });
  if (!role) {
    throw new Error(`System role "${name}" not found for tenant ${tenantId}.`);
  }
  return role.id;
}

function descriptionFor(name: SystemRoleName): string {
  switch (name) {
    case 'Owner':
      return 'Full access. Cannot be modified or deleted. One per tenant.';
    case 'Admin':
      return 'Full operational access excluding billing changes and ownership transfer.';
    case 'Care Worker':
      return 'Day-to-day frontline staff: read tenant data, write care logs and tasks.';
    case 'Read-Only':
      return 'Observer access for auditors, regulators, parent portals.';
  }
}
