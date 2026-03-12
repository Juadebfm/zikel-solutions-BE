# Threat Model: Tenancy, Onboarding, and Privileged Actions

## Scope

- Multi-tenant onboarding (`/auth/register`, `/tenants`, invites, membership flows).
- Tenant context switching (`/auth/switch-tenant`, break-glass).
- Tenant-scoped CRUD modules (care groups, homes, employees, young people, vehicles, tasks, announcements, dashboard, AI).
- Privileged actions (permission changes, AI access toggles, break-glass operations).

## Assets

- Credentials and session tokens.
- Tenant-scoped operational records.
- Child-related personal data.
- Audit trail integrity.
- Invitation tokens and OTPs.

## Trust Boundaries

- External client -> API edge.
- API -> database (Neon Postgres over TLS).
- API -> email provider (Resend).
- API -> AI provider (OpenAI-compatible endpoint).

## Key Threats and Mitigations

| Threat | Control |
|---|---|
| BOLA/IDOR cross-tenant access | `tenantId` enforced on domain tables, `requireTenantContext`, scoped `findFirst/findMany`, cross-tenant denial tests. |
| Privilege escalation via payload fields | Explicit allow-list DTOs, Zod validation, no role assignment from user-supplied body in non-admin routes. |
| Credential stuffing / brute force | Endpoint rate limiting, lockout after repeated failures, OTP resend cooldown, failed-login audit events. |
| Session replay | Refresh token rotation + revocation on refresh/logout/password reset. |
| Tenant hijack by super-admin misuse | Break-glass endpoint with reason + expiry metadata and immutable audit logging. |
| Audit tampering | Append-only DB trigger blocks `UPDATE/DELETE` on `AuditLog`. |
| Secrets exposure | `.env.example` sanitized, CI secret scanning, policy in `docs/security/secret-management-policy.md`. |
| SSRF/config abuse via AI URL | Strict env validation and explicit AI base URL configuration in env policy. |

## Residual Risks

- MFA enforcement is staged (architecture-ready flags in auth session); mandatory challenge enforcement is Phase 2.
- Legal/compliance controls require periodic legal review cadence (tracked in ops docs).

## Security Acceptance Criteria (Phase 1)

- Tenant isolation denial verified by automated tests.
- Privileged actions emit auditable, scoped events.
- Unknown endpoints return sanitized 404.
- Validation and authz failures return safe error payloads.
