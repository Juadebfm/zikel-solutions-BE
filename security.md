# Security Audit Report

Date: 2026-03-12  
Repository: `zikel-solutions-BE`

## Scope

This audit reviewed the codebase for:

- Exposed API keys/secrets
- Unprotected routes
- Missing authorization checks
- Unsanitized inputs

Review method used static inspection of all route modules, auth middleware usage, environment validation, and secret-pattern scans across tracked files.

## Executive Summary

- No hardcoded API keys/secrets were found in tracked source files.
- Core business modules are generally protected by auth + MFA middleware.
- All identified findings below have now been remediated in code.

## Findings

### 1) Webhook endpoint can be accepted without shared secret (if env not set)
- Severity: **Medium**
- Category: Unprotected route / missing auth hardening
- Status: **Resolved (2026-03-12)**
- Fix applied:
  - Webhook receiver now rejects requests with `503 WEBHOOK_NOT_CONFIGURED` if shared secret is missing.
  - Webhook receiver now enforces `HMAC-SHA256` signature verification via `x-zikel-webhook-signature` and `x-zikel-webhook-timestamp`.
  - Startup validation now requires `SECURITY_ALERT_WEBHOOK_SHARED_SECRET` in staging/production whenever `SECURITY_ALERT_PIPELINE_ENABLED=true`.

### 2) OTP values are logged in non-production environments
- Severity: **Medium**
- Category: Sensitive data exposure
- Status: **Resolved (2026-03-12)**
- Fix applied:
  - OTP logging now excludes the OTP code and logs metadata only.

### 3) Public auth endpoints enable account enumeration
- Severity: **Low**
- Category: Unprotected route behavior
- Status: **Resolved (2026-03-12)**
- Fix applied:
  - `checkEmailAvailability` now returns generic availability without revealing account existence.
  - `resendOtp` no longer returns user-not-found and now returns a generic success response for unknown accounts.
  - `verifyOtp` returns generic OTP invalid errors instead of user-not-found.

### 4) Unescaped user-controlled strings interpolated into HTML email templates
- Severity: **Low** (can become **Medium** depending on email-client behavior)
- Category: Unsanitized input
- Status: **Resolved (2026-03-12)**
- Fix applied:
  - Added HTML escaping helper and applied escaping to user-controlled interpolations in email templates (`firstName`, `serviceLabel`, `tenantName`, `roleLabel`, `inviteToken`, etc.).

### 5) Swagger UI is publicly exposed whenever enabled (staging default)
- Severity: **Low**
- Category: Unprotected route
- Status: **Resolved (2026-03-12)**
- Fix applied:
  - Swagger is now auto-enabled only in development by default.
  - When enabled outside development, docs now require HTTP Basic Auth.
  - Startup validation enforces `SWAGGER_BASIC_AUTH_USERNAME` and `SWAGGER_BASIC_AUTH_PASSWORD` when `SWAGGER_ENABLED=true` outside development.

## Exposed API Key Review

### Result
- No hardcoded API keys/tokens were found in tracked files from secret-pattern scans.
- `.env` is ignored and not tracked:
  - `.gitignore:9`
  - verified by git tracking check (`git ls-files` did not include `.env`).

### Residual Risk
- Local `.env` still contains live secrets by design. Ensure CI/CD and deployment logs never print env values.

## Route Protection Inventory (High Level)

### Auth-protected modules (with `fastify.authenticate` hook)
- `ai`, `announcements`, `audit`, `care-groups`, `dashboard`, `employees`, `homes`, `me`, `summary`, `tasks`, `tenants`, `vehicles`, `young-people`

### Intentionally public endpoints
- Infrastructure/public assets:
  - `/health`, `/ready`, `/assets/white-logo.svg`
- Public marketing endpoints:
  - `/api/v1/public/book-demo`
  - `/api/v1/public/join-waitlist`
  - `/api/v1/public/contact-us`
- Public auth endpoints:
  - `/api/v1/auth/register`
  - `/api/v1/auth/check-email`
  - `/api/v1/auth/verify-otp`
  - `/api/v1/auth/resend-otp`
  - `/api/v1/auth/login`
  - `/api/v1/auth/refresh`
  - `/api/v1/auth/forgot-password`
  - `/api/v1/auth/reset-password`
- Integration receiver:
  - `/api/v1/integrations/security-alerts/webhook`
- Docs (conditional):
  - `/docs` when `SWAGGER_ENABLED=true`

## Priority Remediation Plan

1. Optional hardening implemented: webhook requests now require `HMAC-SHA256` signature + timestamp validation.
2. Optional hardening implemented: CAPTCHA verification middleware now protects public auth endpoints.
