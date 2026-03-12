# OWASP API Top 10 and NIST Baseline Mapping

## OWASP API Top 10 (2023) Mapping

| Control Area | Implementation Status |
|---|---|
| API1 Broken Object Level Authorization | Tenant-scoped queries + ownership checks + cross-tenant denial tests. |
| API2 Broken Authentication | OTP verification, lockout/backoff, refresh token rotation, sanitized auth errors. |
| API3 Broken Object Property Level Authorization | Strict schemas, mass-assignment prevention, allow-list updates. |
| API4 Unrestricted Resource Consumption | Global + endpoint rate limiting, body size limits, timeout controls. |
| API5 Broken Function Level Authorization | Route/service role checks and scoped membership checks. |
| API6 Unrestricted Access to Sensitive Business Flows | Rate limits on auth/OTP and privileged endpoint constraints. |
| API7 SSRF | Controlled outbound AI/email integrations; validated environment endpoints. |
| API8 Security Misconfiguration | Fail-fast env validation, secure headers, strict CORS in production. |
| API9 Improper Inventory Management | Versioned `/api/v1`, documented inventory, unknown route shutdown. |
| API10 Unsafe Consumption of APIs | Timeout-bound provider calls, fallback behavior, safe error handling. |

## NIST-Oriented Baseline

- Identity and access: least privilege role model + tenant membership controls.
- Data protection: transport encryption and provider at-rest encryption requirements.
- Logging and monitoring: immutable audit logs + security alert derivation endpoint.
- Secure development lifecycle: CI lint/typecheck/test + dependency scan + secret scan.
