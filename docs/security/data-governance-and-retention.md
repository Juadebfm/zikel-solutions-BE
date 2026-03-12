# Data Governance, Minimization, and Retention

## Data Classification

- `Restricted`: password hashes, refresh tokens, OTP codes, invite token hashes.
- `Confidential`: user profile data, tenant membership/roles, child-related records.
- `Internal`: operational metadata, non-sensitive analytics counters.
- `Public`: marketing/demo/contact submissions intended for business outreach.

## Minimization Decisions

- Authentication stores hashed credentials only; no plaintext secrets.
- Tenant-scoped tables store `tenantId` for strict partitioning and scoped retrieval.
- Audit metadata excludes raw passwords, OTP values, refresh tokens, or API keys.
- AI endpoints process query/context only and return operational guidance; no sensitive provider response storage.

## Retention Policy

| Data Category | Retention | Deletion/Archival Rule |
|---|---|---|
| Audit logs | 24 months minimum | Archive to WORM-capable storage; no in-place update/delete. |
| OTP codes | 30 days max | Expired/used OTP cleanup job (scheduled housekeeping). |
| Refresh tokens | Until expiry/revocation + 30 days | Revoke on logout/password reset; prune stale rows. |
| Tenant invites | 12 months | Expired/revoked invites archived then purged. |
| Public contact/demo/waitlist submissions | 12 months | Purge unless active sales/legal basis extends retention. |
| Child/person operational records | Contract/legal retention window | Tenant offboarding workflow + legal hold checks before destruction. |

## Backup and Log Protection

- Backups must be encrypted at rest (provider-managed encryption + key management policy).
- Access to logs/backups is limited to ops/security roles with least privilege.
- Production credentials are environment-isolated and never shared with lower environments.

## Deletion Workflow

1. Tenant-admin or authorized operator submits deletion request.
2. Verify legal hold/contract requirements.
3. Queue deletion tasks per table category.
4. Record deletion intent/result in audit log.
5. Produce completion report for compliance evidence.
