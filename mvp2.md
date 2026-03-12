# MVP2 - Multi-Tenant Security-First Plan

## Context

We are moving from single-user style onboarding to a true multi-tenant model for care homes.

Target role model:

- Super-admin (Zikel platform operator)
- Tenant admin (organization-level admin)
- Sub-admin (organization/home-level delegated admin)
- Staff (home-level operational user)

Current backend state (before Phase 1 implementation):

- Roles currently available: `staff`, `manager`, `admin`
- No explicit `super_admin` role
- No explicit `tenant` model and no tenant-scoped membership table
- Registration creates a user account only, not a tenant organization

---

## Security Rulebook (Non-Negotiable Guardrails)

These guardrails must be satisfied for every Phase 1 PR.

### 1) Identity, Authentication, and Session Security

- [x] Enforce least privilege by default (`staff` unless explicitly granted elevated role by authorized actor).
- [x] Enforce strong password policy and secure password hashing (migrate to Argon2id target; maintain secure transitional path from bcrypt if needed).
- [x] Add MFA-ready architecture for privileged roles (`super_admin`, `tenant_admin`) even if rollout is staged.
- [x] Enforce token rotation, short-lived access tokens, refresh-token revocation, and replay resistance.
- [x] Implement account lockout/backoff/rate limits for auth endpoints and OTP endpoints.

### 2) Multi-Tenant Isolation

- [x] Every tenant-owned table includes `tenantId`.
- [x] Every read/write query must include tenant scope checks (no unscoped ORM query allowed).
- [x] No IDOR/BOLA: all object access must verify both object ownership and actor permission.
- [x] Add tests for cross-tenant access denial on every sensitive endpoint.
- [x] Add “break-glass” super-admin access with immutable audit logging.

### 3) Authorization Model

- [x] Define role-permission matrix for `super_admin`, `tenant_admin`, `sub_admin`, `staff`.
- [x] Enforce function-level authorization in route handlers and service layer.
- [x] Use explicit allow lists for privileged actions (deny by default).
- [x] Restrict role/permission mutation endpoints to authorized roles only.
- [x] Prevent privilege escalation via request body fields (mass assignment protection).

### 4) Data Protection and Privacy

- [x] Encrypt in transit with TLS everywhere.
- [x] Encrypt data at rest (database/storage/provider-managed encryption).
- [x] Minimize collected data and justify every personal-data field.
- [x] Define retention and deletion policies per data category.
- [x] Protect sensitive logs and backups with strict access controls.

### 5) API and Platform Security

- [x] Apply OWASP API Top 10 controls (BOLA, auth, function-level auth, rate limits, SSRF controls, config hardening).
- [x] Add strict request validation (schema + type checks + allowed enum values).
- [x] Return safe error responses (no internal stack traces/secrets in production).
- [x] Enforce endpoint-level rate limiting and abuse controls.
- [x] Maintain API inventory/versioning and disable unknown/deprecated endpoints.

### 6) Secrets and Configuration Security

- [x] No secrets in git, examples, logs, or CI output.
- [x] Centralize secrets in environment/secret manager with key rotation policy.
- [x] Separate environments (dev/staging/prod) with isolated credentials and data stores.
- [x] Add startup checks for required security env vars and fail-fast behavior.

### 7) Auditability and Monitoring

- [x] Log all privileged actions (role changes, tenant creation, access grants, policy changes).
- [x] Audit logs must include actor, action, target, timestamp, source, result.
- [x] Protect audit logs from tampering and unauthorized deletion.
- [x] Add security alerting for suspicious events (repeated auth failures, cross-tenant attempts, admin changes).

### 8) SDLC and Supply Chain Security

- [x] Threat model required before each major module change.
- [x] Security review checklist must pass before merge.
- [x] Dependency and vulnerability scanning in CI.
- [x] Migration reviews must include data exposure risk and rollback plan.
- [x] Add automated tests for authz, tenancy scope, and security regressions.

### 9) Incident and Breach Readiness

- [x] Maintain incident response runbook with owner and contact tree.
- [x] Keep breach logging and evidence collection procedures ready.
- [x] Test restore and backup recovery paths regularly.
- [x] Define breach-notification workflow and legal escalation path per jurisdiction.

### 10) Compliance-by-Design (UK, US, Canada)

- [x] UK GDPR + DPA 2018 controls embedded (data minimization, accountability, DPIA when high risk, breach handling).
- [x] UK children-data protections considered for child-related data processing context.
- [x] Canada PIPEDA safeguards, consent, retention, access, and breach-record obligations embedded.
- [x] US controls mapped to applicable obligations; if processing ePHI for covered entities/business associates, enforce HIPAA Security Rule controls.
- [x] Cross-border transfer mechanism documented per transfer path (adequacy/safeguards/exception).

---

## Phase 1 Scope (Build Order)

Phase 1 goal: establish secure tenant foundation, not full product parity.

### Phase 1.0 - Foundations and Design Controls

- [x] Finalize role model and permission matrix.
- [x] Produce threat model for tenancy + onboarding + privileged actions.
- [x] Define data classification and sensitive fields list.
- [x] Define audit event taxonomy.

### Phase 1.1 - Data Model and Migrations

- [x] Add `Tenant` table (organization-level unit).
- [x] Add `TenantMembership` table (`userId`, `tenantId`, `role`, status).
- [x] Add tenant ownership links to existing domain tables as needed.
- [x] Add uniqueness/index constraints to enforce safe boundaries.
- [x] Add reversible migration plan and backfill strategy.

### Phase 1.2 - Auth and Token Context

- [x] Extend JWT/session context with active `tenantId` and role in tenant.
- [x] Add secure tenant-switch mechanism with explicit authorization checks.
- [x] Ensure all auth responses safely expose required tenancy metadata.

### Phase 1.3 - Tenant Provisioning and Admin Flows

- [x] Create tenant provisioning endpoint (super-admin only).
- [x] Create tenant-admin invitation flow (tokenized invite with expiry).
- [x] Add sub-admin/staff invite endpoints scoped to tenant.
- [x] Add safe bootstrap path for first tenant admin.

### Phase 1.4 - Tenant Enforcement in Existing Modules

- [x] Scope all list/get/create/update/delete operations by tenant.
- [x] Block cross-tenant operations by default.
- [x] Add tenant-scoped filtering to summaries, dashboards, AI context, and audits.

### Phase 1.5 - Verification and Hardening

- [x] Add integration tests for cross-tenant isolation and authz boundaries.
- [x] Run security test pass (authn, authz, input validation, rate limits, logging).
- [x] Perform migration dry run in staging and rollback simulation.
- [x] Prepare deployment checklist and production verification script.

### Current Backend Status (2026-03-12)

- [x] Prisma schema updated for tenant ownership across core models.
- [x] New migration created: `20260312173000_tenant_scope_core_models`.
- [x] New migration created and applied: `20260312191500_audit_log_append_only`.
- [x] Cross-tenant denial integration tests added for sensitive modules.
- [x] Vehicles, Tasks, and Audit endpoint modules are implemented and registered.
- [x] Apply migration to target database(s): `npx prisma migrate deploy`.
- [x] Code quality checks passed locally (`typecheck`, `lint`, `test`).

### Current Product Gaps (Implement ASAP)

- [x] Add real-time security alert pipeline (webhook/queue/notifications) instead of on-demand aggregation only.
- [x] Enforce automatic break-glass expiry rollback to previous tenant context when `expiresAt` passes.
- [x] Send tenant invite emails automatically on invite creation (instead of manual token sharing only).
- [x] Resolve authorization model mismatch: align route-level global-role guards with tenant-role permissions.
- [x] Add tenant-admin membership management endpoints (list/update members) without requiring super-admin for all actions.
- [x] Add self-serve organization onboarding path (optional controlled flow) or explicit admin-operated onboarding UX.
- [x] Implement and enforce MFA challenge flow for privileged sessions (`super_admin`, `tenant_admin`) instead of metadata-only flags.
- [x] Expand audit coverage to include sensitive read/access events (not only writes/permission changes).
- [x] Standardize audit metadata capture (ip/userAgent/requestId/source) across all privileged actions.
- [x] Add explicit break-glass release/reset endpoint and clearer super-admin cross-tenant audit scope lifecycle.
- [x] Unify password hashing path so all password changes use Argon2id consistently.
- [x] Implement real data sources for summary `comments` and `rewards` metrics (currently placeholders).
- [x] Harmonize deletion/retention strategy across modules (soft-delete vs hard-delete) based on compliance/audit requirements.

---

## Implementation Checklist (Use During Development)

### Pre-PR Checklist

- [x] Threat model updated.
- [x] Security acceptance criteria written for the ticket.
- [x] Data minimization decision documented for new fields.
- [x] Tenant isolation test cases added.

### PR Review Checklist

- [x] No unscoped queries.
- [x] No role escalation path from request body.
- [x] No secrets or sensitive data in logs.
- [x] Audit logging added for privileged operations.
- [x] Error responses are sanitized.
- [x] Rate limiting present for sensitive endpoints.

### Pre-Deploy Checklist

- [x] Migration tested in staging with realistic data volume.
- [x] Backup + restore verified before production migration.
- [x] Rollback plan tested.
- [x] Security smoke tests passed.
- [x] Monitoring and alerting rules enabled.

### Post-Deploy Checklist

- [x] Verify tenant creation flow.
- [x] Verify tenant admin invite and role assignment flow.
- [x] Verify cross-tenant access is blocked.
- [x] Verify audit logs for privileged actions are present and correct.
- [x] Verify incident/breach contact path is current.

---

## Compliance Mapping Checklist (Jurisdiction Overlay)

### UK (Primary)

- [x] UK GDPR principles mapped to system controls.
- [x] DPA 2018 considerations documented.
- [x] DPIA process embedded for high-risk processing.
- [x] 72-hour breach response workflow documented and tested.
- [x] International transfer mechanism documented for each non-UK transfer path.

### Canada

- [x] PIPEDA principles mapped to controls (especially safeguards, retention, access, openness).
- [x] Breach notification + records process implemented for PIPEDA obligations.
- [x] Data transfer and processor contract terms aligned with PIPEDA expectations.

### US

- [x] Baseline security controls mapped to NIST/OWASP.
- [x] Determine whether HIPAA applies per tenant use case.
- [x] If HIPAA applies, enforce Security Rule administrative/technical/physical safeguards.
- [x] State-law/privacy obligations review tracked with legal counsel.

---

## References (Authoritative Sources Used)

- ICO - Accountability and governance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/
- ICO - DPIA trigger guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/
- ICO - Personal data breaches (72-hour rule): https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/personal-data-breaches-a-guide/
- ICO - Data minimization principle: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/
- ICO - International transfers: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/
- ICO - Adequacy regulations (includes Canada partial adequacy scope): https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/adequacy-regulations/is-the-restricted-transfer-covered-by-adequacy-regulations/
- UK Government - Data Protection Act 2018: https://www.gov.uk/government/collections/data-protection-act-2018
- ICO - Children's code (Age appropriate design code): https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-code
- OWASP API Security Top 10 (2023): https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- NIST SSDF SP 800-218: https://csrc.nist.gov/pubs/sp/800/218/final
- NIST Digital Identity SP 800-63-4: https://www.nist.gov/publications/nist-sp-800-63-4-digital-identity-guidelines
- CISA Secure by Design: https://www.cisa.gov/securebydesign
- Office of the Privacy Commissioner of Canada - PIPEDA principles: https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/
- OPC Canada - PIPEDA Principle 7 (Safeguards): https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_safeguards/
- OPC Canada - PIPEDA breach reporting: https://www.priv.gc.ca/en/privacy-topics/business-privacy/safeguards-and-breaches/privacy-breaches/respond-to-a-privacy-breach-at-your-business/gd_pb_201810/
- Justice Laws (Canada) - PIPEDA Act text: https://laws-lois.justice.gc.ca/eng/acts/P-8.6/
- HHS - HIPAA Security Rule: https://www.hhs.gov/ocr/privacy/hipaa/administrative/securityrule/index.html

---

## Decision Log

- [x] Legal review checkpoint scheduled for jurisdiction-specific obligations before production launch in each region.
- [x] Security architecture review required before moving from Phase 1.1 to Phase 1.2.
- [x] No phase completion accepted unless all relevant checkboxes above are complete.
