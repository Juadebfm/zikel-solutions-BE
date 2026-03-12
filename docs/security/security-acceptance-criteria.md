# Security Acceptance Criteria (Phase 1)

Ticket/Release is accepted only if all criteria pass:

1. Tenant isolation
- Cross-tenant access tests pass for sensitive endpoints.
- No unscoped domain query introduced for tenant-owned entities.

2. Authentication and session controls
- Password policy and hashing checks pass.
- Refresh-token rotation and revocation tests pass.
- Auth lockout/rate limits validated.

3. Authorization and auditability
- Privileged endpoints enforce role + tenant checks.
- Privileged operations create audit entries with actor/action/target/result metadata.
- Audit logs remain append-only.

4. API hardening
- Request validation in place for all write routes.
- Error responses are sanitized in production mode.
- Unknown/deprecated endpoints return controlled 404.

5. Operational readiness
- Migration dry run + rollback simulation completed.
- Security smoke tests pass on target environment.
- Monitoring and alert rules enabled for auth failures, cross-tenant blocks, and admin changes.
