# Migration Backfill and Rollback Plan

## Tenant-Scope Migration Strategy

1. Add nullable `tenantId` columns for legacy tables.
2. Backfill `tenantId` using membership/ownership rules.
3. Add indexes and foreign keys.
4. Enforce non-null constraints only after backfill verification.

## Reversible Approach

- Use idempotent SQL (`IF NOT EXISTS`) for additive operations.
- Keep rollback path documented per migration:
  - mark migration rolled back in staging (`prisma migrate resolve --rolled-back`),
  - re-apply with `prisma migrate deploy`.

## Backfill Validation

- Validate every tenant-owned row has a non-null, valid tenant reference.
- Validate uniqueness boundaries by tenant (`@@unique([tenantId, ...])` where applicable).
- Validate cross-tenant queries fail in integration tests.

## Rollback Triggers

- Migration errors affecting referential integrity.
- Unexpected null ownership rows after backfill.
- Endpoint regressions in security smoke tests.

## Required Commands

```bash
npx prisma migrate status --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
npx prisma migrate resolve --rolled-back <migration_name> --schema prisma/schema.prisma
```
