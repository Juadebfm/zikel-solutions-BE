# Deployment, Migration, and Rollback Checklists

## Security Test Pass

Run before deploy:

```bash
npm run typecheck
npm run lint
npm test
./scripts/security-smoke.sh <BASE_URL> [ACCESS_TOKEN]
```

## Migration Dry Run (Staging)

```bash
./scripts/migration-dry-run.sh prisma/schema.prisma
```

Checklist:

- Migration applies cleanly.
- Staging app boots with new schema.
- Tenant-scoped CRUD endpoints pass smoke tests.
- Rollback simulation executed using `prisma migrate resolve --rolled-back`.

## Backup + Restore Verification

- Confirm pre-migration backup timestamp.
- Restore backup snapshot in staging.
- Validate core table counts and referential integrity.
- Document restore duration and integrity check result.

## Production Verification

```bash
./scripts/production-verification.sh <BASE_URL> <ADMIN_ACCESS_TOKEN>
```

Checks:

- Health endpoint reachable.
- Tenant, vehicles, tasks, and audit endpoints available.
- Authz controls behave as expected.
- Monitoring/alert rules are active.

## Post-Deploy

- Verify tenant creation and invite flows.
- Verify cross-tenant access denials.
- Verify privileged action audit entries.
- Verify incident contact path validity.
