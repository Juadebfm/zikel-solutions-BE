#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const DEFAULT_PREFIXES = [
  'qa+',
  'deploy+',
  'perf+',
  'probe+',
  'postdeploy+',
  'test+',
  'smoke+',
  'seedprobe+',
];
const DEFAULT_DOMAIN = 'example.com';
const ARCHIVE_DOMAIN = 'example.invalid';

function printHelp() {
  console.log(`
Archive probe/test accounts safely (without hard-deleting users).

Usage:
  node scripts/archive-probe-accounts.mjs [options]

Options:
  --dry-run            Preview only (default)
  --execute            Apply archival changes
  --domain=<domain>    Email domain to match with --prefix (default: ${DEFAULT_DOMAIN})
  --prefix=<value>     Add a prefix matcher (repeatable), e.g. --prefix=qa+
  --email=<email>      Archive an exact email (repeatable)
  -h, --help           Show this help

Notes:
  - Hard deletes can fail due append-only audit log constraints.
  - This script archives users by disabling them and moving email to @${ARCHIVE_DOMAIN}.
  - Tenant memberships for matched users are removed; empty probe tenants are inactivated.
`.trim());
}

function normalizeDomain(domain) {
  return domain.trim().replace(/^@+/, '').toLowerCase();
}

function parseArgs(argv) {
  const parsed = {
    execute: false,
    domain: DEFAULT_DOMAIN,
    prefixes: [...DEFAULT_PREFIXES],
    emails: [],
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      return { showHelp: true, parsed };
    }
    if (arg === '--execute') {
      parsed.execute = true;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.execute = false;
      continue;
    }
    if (arg.startsWith('--domain=')) {
      parsed.domain = arg.slice('--domain='.length);
      continue;
    }
    if (arg.startsWith('--prefix=')) {
      parsed.prefixes.push(arg.slice('--prefix='.length));
      continue;
    }
    if (arg.startsWith('--email=')) {
      parsed.emails.push(arg.slice('--email='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  parsed.domain = normalizeDomain(parsed.domain);
  if (!parsed.domain) {
    throw new Error('--domain cannot be empty.');
  }

  parsed.prefixes = Array.from(
    new Set(
      parsed.prefixes
        .map((prefix) => prefix.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  parsed.emails = Array.from(
    new Set(
      parsed.emails
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  return { showHelp: false, parsed };
}

function buildCandidateWhere(config) {
  const emailClauses = config.emails.map((email) => ({ email }));
  const prefixClauses = config.prefixes.map((prefix) => ({
    AND: [
      { email: { startsWith: prefix } },
      { email: { endsWith: `@${config.domain}` } },
    ],
  }));

  const orClauses = [...emailClauses, ...prefixClauses];
  if (orClauses.length === 0) {
    throw new Error('No filters were provided. Add --email or --prefix.');
  }

  return { OR: orClauses };
}

function summarizeCandidate(user) {
  return {
    id: user.id,
    email: user.email,
    isActive: user.isActive,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    membershipCount: user.tenantMemberships.length,
    tenantIds: user.tenantMemberships.map((m) => m.tenantId),
  };
}

function tenantHasOperationalData(counts) {
  return (
    counts.tasks > 0 ||
    counts.homes > 0 ||
    counts.youngPeople > 0 ||
    counts.homeEvents > 0 ||
    counts.employeeShifts > 0 ||
    counts.employees > 0 ||
    counts.vehicles > 0 ||
    counts.announcements > 0 ||
    counts.careGroups > 0 ||
    counts.widgets > 0
  );
}

async function main() {
  const { showHelp, parsed } = parseArgs(process.argv.slice(2));
  if (showHelp) {
    printHelp();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const where = buildCandidateWhere(parsed);
    const candidates = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        tenantMemberships: {
          select: {
            tenantId: true,
            role: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const dryRunPayload = {
      mode: 'dry-run',
      domain: parsed.domain,
      prefixes: parsed.prefixes,
      exactEmails: parsed.emails,
      candidateCount: candidates.length,
      candidates: candidates.map(summarizeCandidate),
    };

    if (!parsed.execute) {
      console.log(JSON.stringify(dryRunPayload, null, 2));
      return;
    }

    const touchedTenantIds = new Set();
    const archivedUsers = [];

    for (const user of candidates) {
      for (const membership of user.tenantMemberships) {
        touchedTenantIds.add(membership.tenantId);
      }

      const archivedEmail = `archived+${Date.now()}-${user.id}@${ARCHIVE_DOMAIN}`;

      const result = await prisma.$transaction(async (tx) => {
        const refreshTokensDeleted = await tx.refreshToken.deleteMany({
          where: { userId: user.id },
        });
        const otpCodesDeleted = await tx.otpCode.deleteMany({
          where: { userId: user.id },
        });
        const membershipsDeleted = await tx.tenantMembership.deleteMany({
          where: { userId: user.id },
        });

        const archivedUser = await tx.user.update({
          where: { id: user.id },
          data: {
            email: archivedEmail,
            firstName: 'Archived',
            middleName: null,
            lastName: 'Archived',
            phoneNumber: null,
            isActive: false,
            emailVerified: false,
            activeTenantId: null,
          },
          select: {
            id: true,
            email: true,
            isActive: true,
            emailVerified: true,
            updatedAt: true,
          },
        });

        return {
          refreshTokensDeleted: refreshTokensDeleted.count,
          otpCodesDeleted: otpCodesDeleted.count,
          membershipsDeleted: membershipsDeleted.count,
          archivedUser,
        };
      });

      archivedUsers.push({
        originalEmail: user.email,
        archivedEmail: result.archivedUser.email,
        refreshTokensDeleted: result.refreshTokensDeleted,
        otpCodesDeleted: result.otpCodesDeleted,
        membershipsDeleted: result.membershipsDeleted,
      });
    }

    const archivedTenants = [];
    for (const tenantId of touchedTenantIds) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          _count: {
            select: {
              memberships: true,
              tasks: true,
              homes: true,
              youngPeople: true,
              homeEvents: true,
              employeeShifts: true,
              employees: true,
              vehicles: true,
              announcements: true,
              careGroups: true,
              widgets: true,
            },
          },
        },
      });

      if (!tenant) continue;
      if (tenant._count.memberships > 0) continue;
      if (tenantHasOperationalData(tenant._count)) continue;

      const now = Date.now();
      const suffix = tenant.id.slice(-6);
      const archivedSlug = `archived-probe-${now}-${suffix}`.slice(0, 120);
      const archivedName = `Archived Probe Tenant ${now}`;

      const updatedTenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          isActive: false,
          name: archivedName,
          slug: archivedSlug,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          updatedAt: true,
        },
      });

      archivedTenants.push(updatedTenant);
    }

    const remainingMatches = await prisma.user.count({ where });
    console.log(
      JSON.stringify(
        {
          mode: 'execute',
          domain: parsed.domain,
          prefixes: parsed.prefixes,
          exactEmails: parsed.emails,
          matchedUsers: candidates.length,
          archivedUsersCount: archivedUsers.length,
          archivedUsers,
          archivedTenantsCount: archivedTenants.length,
          archivedTenants,
          remainingMatches,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
