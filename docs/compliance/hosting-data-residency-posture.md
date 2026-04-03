# Hosting & Data Residency Posture

## Purpose
This document records the current backend data-hosting posture and the controls used to keep data processing within approved deployment regions.

## Current posture
- Application runtime: managed cloud deployment (`PUBLIC_BASE_URL` + deployment target environment)
- Primary data store: Postgres over TLS (`DATABASE_URL`/`DIRECT_URL` with `sslmode=require`)
- Object storage (optional): S3-compatible (`UPLOADS_*` controls)

## Residency control points
- `DATABASE_URL` and `DIRECT_URL` determine database hosting region/provider.
- `UPLOADS_S3_REGION` and `UPLOADS_S3_ENDPOINT` determine file-storage geography.
- `PUBLIC_BASE_URL` identifies public API host used by clients and outbound links.
- `CORS_ORIGINS` limits which frontends can call the API in production.

## Operational checks
- Verify production DB region matches contractual residency requirements.
- Verify object storage region and backup region policy.
- Verify no wildcard CORS in production.
- Verify TLS-only DB and HTTPS public URL.

## Evidence to retain
- Deployment config export (without secrets)
- Cloud region screenshot or provider API output for DB/object storage
- `.env.example` and runtime env key inventory
- Change log for residency-affecting configuration changes
