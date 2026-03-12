# Encryption Controls

## In Transit

- Public API must be served behind TLS 1.2+.
- Staging/production env checks enforce `https://` public URLs and origins.
- Database connections in staging/production require `sslmode=require`.

## At Rest

- Postgres, object storage, and backups must use provider-managed encryption at rest.
- Backup artifacts must remain encrypted and access-restricted.
- Key rotation follows secret management policy cadence.

## Verification

- Startup validation fails if staging/production config violates TLS expectations.
- Deployment checklist requires verification of TLS endpoints and encrypted DB config.
