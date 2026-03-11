# ⚡ Production Backend Security & Architecture Guide
### Agent Guardrails for Building Resilient, Secure Systems
*Version 1.1 · Comprehensive Reference · 2026*

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [Input Validation & Injection Prevention](#2-input-validation--injection-prevention)
3. [Transport & Network Security](#3-transport--network-security)
4. [Rate Limiting & DoS Protection](#4-rate-limiting--dos-protection)
5. [Data Security & Privacy](#5-data-security--privacy)
6. [Secure Architectural Patterns](#6-secure-architectural-patterns)
7. [Logging, Monitoring & Incident Response](#7-logging-monitoring--incident-response)
8. [Secure API Design](#8-secure-api-design)
9. [Infrastructure & Deployment Security](#9-infrastructure--deployment-security)
10. [Business Logic & Advanced Patterns](#10-business-logic--advanced-patterns)
11. [Agent Quick-Reference Checklists](#11-agent-quick-reference-checklists)
12. [zikel-solutions Therapeutic, Safeguarding & Compliance Guardrails](#12-zikel-solutions-therapeutic-safeguarding--compliance-guardrails-product-specific)

---

## 1. Authentication & Authorization

### 1.1 Password & Credential Handling

- **Never store plaintext passwords** — always hash with `bcrypt` (cost ≥12), `argon2id`, or `scrypt`
  - bcrypt: work factor 12+ (benchmark to ~100ms on prod hardware)
  - argon2id: memory=64MB, iterations=3, parallelism=4 — preferred for new systems
- Enforce minimum password **entropy**, not just length; use `zxcvbn` or similar scoring
- Implement **credential stuffing protection**: rate-limit + device fingerprinting on login
- Never log, store, or transmit raw credentials in any form — including in error messages
- Use **timing-safe comparison** functions for all credential checks (prevents timing attacks)

### 1.2 Token Strategy

- JWTs: **short-lived access tokens** (15 min), **long-lived refresh tokens** (7–30 days)
  - Sign with RS256/ES256 (asymmetric) — never HS256 in distributed systems
  - Always validate: signature, expiry, issuer, audience, and token type
  - Never store sensitive data in JWT payloads — they are base64-encoded, not encrypted
- Implement **refresh token rotation**: invalidate old token on each use
- Maintain a server-side **token revocation list** (Redis blacklist) for logout and compromise response
- Store tokens in `HttpOnly`, `Secure`, `SameSite=Strict` cookies — **never `localStorage`**

### 1.3 OAuth 2.0 / OIDC

- Always use **PKCE** (Proof Key for Code Exchange) for all public clients
- Validate `state` parameter to prevent CSRF on OAuth flows
- Use short-lived authorization codes (< 60 seconds)
- Validate `redirect_uri` exactly against a whitelist — no partial matches, no wildcards
- Introspect and validate third-party tokens server-side before trusting them

### 1.4 API Key Management

- **Hash API keys at rest** (SHA-256); only display once at creation time
- Prefix keys with a recognizable prefix (e.g., `sk_live_`, `sk_test_`) for scanning in logs/code
- Scope every API key to minimum required permissions (principle of least privilege)
- Implement **key rotation without downtime** — support two valid keys during rotation window
- Log all key usage with timestamp, IP, and user-agent for audit trails

### 1.5 Multi-Factor Authentication

- Require MFA for admin accounts and any privileged operations — **non-negotiable**
- Support TOTP (RFC 6238) as baseline; FIDO2/WebAuthn for high-security contexts
- Implement MFA backup codes: store hashed, one-time-use, 10–16 codes
- Rate-limit MFA attempts; lock after 5 failures with exponential backoff

> 🚨 **CRITICAL AUTH RULE**: Any endpoint that modifies data, accesses PII, or triggers financial operations MUST require authentication AND authorization checks — never rely on the client to enforce this.

---

## 2. Input Validation & Injection Prevention

### 2.1 Input Validation Principles

- Validate **ALL inputs on the server** — client-side validation is UX only, never security
- **Whitelist** acceptable values rather than blacklisting known-bad patterns
- Validate: type, format, length (min AND max), range, encoding, and business logic
- Reject requests with unexpected fields; use strict schema validation (Zod, Joi, Pydantic)
- Normalize inputs before validation (trim whitespace, decode URL encoding, normalize Unicode)
- Validate file uploads: check magic bytes (not just extension), MIME type, size, and scan content

### 2.2 SQL Injection Prevention

- **Use parameterized queries / prepared statements — ALWAYS, without exception**
  - ORM does not guarantee safety — validate that your ORM uses parameterization
  - Never use string concatenation or interpolation to build SQL queries
- Apply principle of least privilege on database users — app user cannot DROP tables
- Use stored procedures with fixed signatures for complex operations
- Enable database query logging in dev/staging; audit suspicious patterns

```js
// ❌ VULNERABLE
db.query(`SELECT * FROM users WHERE id = ${userId}`);

// ✅ SAFE — parameterized query
db.query('SELECT * FROM users WHERE id = $1', [userId]);
```

### 2.3 NoSQL Injection

- Sanitize and type-check all MongoDB/Redis query inputs
- Never allow raw operator injection (e.g., `$where`, `$regex` from user input)
- Use schema validation at the ODM layer (Mongoose strict mode)
- Disable JavaScript execution in MongoDB (`--noscripting` flag)

### 2.4 XSS Prevention

- Encode all output rendered in HTML contexts — use context-aware encoding
- Set `Content-Security-Policy` headers to restrict inline scripts and unauthorized origins
- Never use `innerHTML`, `document.write()`, or `eval()` with user-controlled data
- Use `HttpOnly` cookies to protect session tokens from XSS exfiltration
- Sanitize rich text / HTML input with an allowlist library (DOMPurify, bleach)

### 2.5 Command & Path Injection

- Never pass user input to shell commands; use language-native APIs instead
- If shell execution is required, use argument arrays (never `shell=True` in Python)
- Canonicalize file paths and verify they remain within expected directories (path traversal)

```js
// ❌ VULNERABLE
exec(`convert ${filename} output.jpg`);

// ✅ SAFE
execFile('convert', [filename, 'output.jpg']);
```

### 2.6 SSRF (Server-Side Request Forgery)

- Validate and whitelist all URLs before making outbound server requests
- Block requests to private IP ranges: `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `localhost`
- Use a dedicated outbound proxy with allowlist enforcement
- Never expose raw HTTP response bodies from internal SSRF-triggerable services

---

## 3. Transport & Network Security

### 3.1 TLS Configuration

- Enforce **TLS 1.2 minimum**; TLS 1.3 preferred — disable TLS 1.0 and 1.1 completely
- Use strong cipher suites; disable RC4, 3DES, NULL, EXPORT ciphers
- Enable **HSTS** with min `max-age=31536000; includeSubDomains`
- Implement certificate pinning for mobile clients and high-security API consumers
- Enable OCSP stapling for certificate revocation checking
- Automate certificate renewal (Let's Encrypt / cert-manager) — never let certs expire

### 3.2 Security Headers

| Header | Recommended Value | Purpose |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Force HTTPS |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'` | Prevent XSS |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` | Restrict browser APIs |
| `Cache-Control` | `no-store` (for sensitive endpoints) | Prevent caching PII |

### 3.3 CORS Configuration

- Define an explicit **allowlist** of permitted origins — never use wildcard `*` in production
- Restrict allowed methods to only those required by the API
- Do not reflect the `Origin` header back without validation
- Set `Access-Control-Allow-Credentials: true` only when strictly necessary and origin is exact
- Pre-flight cache duration (`max-age`) should be short in development, longer in stable prod

---

## 4. Rate Limiting & DoS Protection

### 4.1 Rate Limiting Strategy

- Apply rate limiting at multiple layers: API gateway, load balancer, and application level
- Rate limit by: IP address, user ID, API key, and endpoint — not just globally
- Use **sliding window** or **token bucket** algorithms (not fixed window — susceptible to boundary attacks)
- Return `429 Too Many Requests` with `Retry-After` header; never silently drop requests
- Whitelist internal service IPs and health check paths from rate limiting

### 4.2 Per-Endpoint Limits (Reference)

| Endpoint Type | Suggested Limit | Window | Notes |
|---|---|---|---|
| Login / Auth | 5–10 req | per minute per IP | Lock after 5 failures |
| Password Reset | 3 req | per hour per email | Token expiry 15 min |
| Public API (unauth) | 60 req | per minute per IP | Return 429 with header |
| Authenticated API | 1000 req | per minute per user | Adjust per plan tier |
| File Upload | 10 req | per hour per user | Validate size + type |
| Webhook / Callbacks | 500 req | per minute | Queue-based processing |

### 4.3 DDoS Mitigation

- Use a CDN with DDoS protection (Cloudflare, AWS Shield) as the first line of defense
- Enable connection limits and slowloris protection at the web server level
- Implement request size limits — reject oversized payloads before processing
- Use async processing + queues to decouple ingestion from computation
- Set timeouts on all outbound calls to prevent resource exhaustion from slow upstreams

---

## 5. Data Security & Privacy

### 5.1 Encryption at Rest

- Encrypt all databases, file stores, and backups using **AES-256-GCM**
- Use **envelope encryption**: data encrypted with DEK, DEK encrypted with KMS-managed KEK
- Rotate encryption keys on a regular schedule; maintain key version history for decryption
- Store secrets (API keys, DB passwords, certs) in a dedicated vault — **never in code or env files committed to source control**
- Use services like HashiCorp Vault, AWS Secrets Manager, or GCP Secret Manager

### 5.2 PII & Sensitive Data Handling

- Classify all data fields: Public, Internal, Confidential, Restricted — enforce accordingly
- **Mask or tokenize PII** in logs, error messages, and analytics pipelines
- Implement data minimization: collect only what is strictly necessary
- Define and enforce data retention policies — auto-delete expired records
- Anonymize or pseudonymize data used in dev/staging environments
- Implement right-to-erasure workflows compliant with GDPR/CCPA

### 5.3 Database Security

- Separate database users by role: read-only, read-write, migrations — **never use root**
- Disable remote root access; use SSH tunnels or VPN for DBA access
- Enable database-level audit logging for DDL and sensitive DML operations
- Encrypt data in transit to the database (TLS for all DB connections)
- Use row-level security (RLS) in PostgreSQL for multi-tenant data isolation
- Regular automated backups with encrypted offsite storage; test restores quarterly

---

## 6. Secure Architectural Patterns

### 6.1 Zero Trust Architecture

- **Never trust, always verify** — authenticate and authorize every request, even internal ones
- Treat the internal network as hostile; mTLS between all microservices
- Issue short-lived service credentials; rotate automatically via service mesh (Istio, Linkerd)
- Log and monitor all east-west traffic (service-to-service), not just north-south

### 6.2 Defense in Depth

- Layer multiple security controls — no single point of failure in your security posture
- WAF → API Gateway → Load Balancer → App → Database
- Each layer should fail closed: **deny by default**, permit by exception
- Security controls should be independent — compromise of one layer shouldn't cascade

### 6.3 Principle of Least Privilege

- Every service, user, and process gets only the **minimum permissions required**
- IAM roles for cloud services — never use long-lived access keys on EC2/containers
- Scope database roles: reporting service gets `SELECT` only, never `INSERT/DELETE`
- Network segmentation: services communicate only on required ports to required peers
- Regularly audit and prune unused permissions, roles, and service accounts

### 6.4 Secrets Management

- **Zero secrets in source code** — enforce with pre-commit hooks (`git-secrets`, `truffleHog`)
- Inject secrets at runtime via vault agent, Kubernetes secrets, or environment injection
- Rotate all secrets automatically; applications must gracefully handle rotation
- Audit all secret access — who accessed what secret, when, from where

```python
# ❌ NEVER — secrets in code
DB_PASSWORD = 'superSecret123'

# ✅ ALWAYS — from environment / vault at runtime
DB_PASSWORD = os.environ.get('DB_PASSWORD')  # Injected by secrets manager
```

### 6.5 Microservices Security

- Service-to-service authentication: mTLS or short-lived JWT with service identity
- API Gateway as single entry point — handle auth, rate limiting, and routing centrally
- Service mesh for observability, mTLS, and traffic policy without app-level changes
- Container security: run as non-root, read-only filesystem, drop Linux capabilities
- Network policies: default-deny all ingress/egress, explicitly allow required paths
- Image security: scan images in CI/CD, use distroless/minimal base images, pin digests

---

## 7. Logging, Monitoring & Incident Response

### 7.1 Security Logging

- Log all **authentication events**: success, failure, MFA, password change, logout
- Log all **authorization decisions**: granted and denied, with resource and actor
- Log all **admin actions** and privilege escalations with full context
- Log API access: method, path, response code, latency, user/IP — never log request bodies with PII
- Use structured logging (JSON) with consistent fields: `timestamp`, `severity`, `trace_id`, `user_id`
- Centralize logs to a SIEM (Splunk, Elastic, Datadog) — logs on local disk are not monitoring

### 7.2 What NOT to Log

> ⚠️ **WARNING**: Never log passwords, tokens, API keys, full credit card numbers, SSNs, or any secret material. Mask or omit these fields before writing to logs.

### 7.3 Monitoring & Alerting

- Alert on: repeated auth failures (brute force), unusual geo/time logins, mass data exports
- Alert on: privilege escalation, new admin accounts, secret access anomalies
- Alert on: service error rate spikes (P99 latency, 5xx rate) — set baselines and thresholds
- Use distributed tracing (OpenTelemetry) to correlate requests across services
- Implement canary analysis on deployments — auto-rollback on error rate increase

### 7.4 Incident Response

- Document and rehearse a runbook for: data breach, account takeover, service outage, ransomware
- Implement automated alerting with PagerDuty/OpsGenie routing to on-call engineers
- Maintain tamper-proof audit logs in separate write-once storage
- Practice chaos engineering and tabletop exercises quarterly
- Post-mortems required for all P0/P1 incidents — blameless, action-item focused

---

## 8. Secure API Design

### 8.1 REST API Security

- Use nouns for resources, never verbs — `GET /users/:id`, not `GET /getUser`
- Return minimum required data — never expose internal IDs, metadata, or stack traces
- Use **opaque IDs** (UUIDs) for resources — never sequential integer IDs (enumeration attack)
- Implement **idempotency keys** for POST operations that create or modify state
- Version your API from day one — `/v1/`, `/v2/` — never break backward compatibility without versioning

### 8.2 Error Handling

- Return **generic error messages** to clients — never expose stack traces, SQL errors, or internals
- Log full error details server-side with a correlation ID returned to the client
- Use consistent error schema: `{ error: { code, message, request_id } }`
- Map internal errors to appropriate HTTP status codes — 400, 401, 403, 404, 500

```json
// ❌ LEAKS internals
{ "error": "ERROR: duplicate key value violates unique constraint \"users_email_key\"" }

// ✅ Safe — generic message + traceable ID
{ "error": { "code": "CONFLICT", "message": "Email already in use.", "request_id": "abc123" } }
```

### 8.3 GraphQL-Specific Security

- **Disable introspection** in production environments
- Implement query depth and complexity limits to prevent DoS via nested queries
- Use persisted queries to prevent arbitrary query injection
- Field-level authorization — never rely solely on resolver-level checks
- Rate-limit by query complexity, not just request count

---

## 9. Infrastructure & Deployment Security

### 9.1 Cloud Security Posture

- Enable CloudTrail/Cloud Audit Logs — log all API calls to your cloud provider
- Use SCPs (Service Control Policies) in AWS Organizations to enforce guardrails
- Enable GuardDuty / Security Command Center for threat detection
- **Block public access** to S3 buckets / Cloud Storage at the org level by default
- Tag all resources with environment, owner, and cost-center for governance
- Enable MFA delete on S3 buckets containing critical data or backups

### 9.2 CI/CD Pipeline Security

- Treat CI/CD as a critical attack surface — compromise = full deployment access
- Never store long-lived credentials in CI/CD; use OIDC federation with short-lived tokens
- Sign all container images (cosign) and verify signatures in deployment pipeline
- **SAST** (Static Analysis): run on every PR — Semgrep, Bandit, ESLint security rules
- **SCA** (Software Composition Analysis): scan dependencies for CVEs — Snyk, Dependabot
- Secret scanning on every commit; block pushes containing detected secrets
- **DAST** (Dynamic Analysis): run against staging environment on release candidates

### 9.3 Container & Kubernetes Security

- Never run containers as root — specify `runAsNonRoot: true` and `runAsUser` in pod spec
- Use read-only root filesystem where possible; mount writable volumes explicitly
- Drop all Linux capabilities; add back only required ones (e.g., `NET_BIND_SERVICE`)
- Use Pod Security Standards (**Restricted** policy) in Kubernetes
- Enable network policies: default deny all, explicit allow for required communication
- Scan running containers for vulnerabilities (Falco, Trivy) — not just at build time
- Use workload identity (IRSA, Workload Identity) — no static secrets in pods

### 9.4 Patch Management

- Automate OS and dependency patching — unpatched systems are the #1 breach vector
- Define patch SLAs: **Critical CVE ≤ 24h**, High ≤ 7 days, Medium ≤ 30 days
- Immutable infrastructure: rebuild and redeploy rather than patch in place
- Subscribe to CVE feeds for all dependencies; triage weekly

---

## 10. Business Logic & Advanced Patterns

### 10.1 OWASP Top 10 Checklist

| # | Vulnerability | Primary Mitigation |
|---|---|---|
| A01 | Broken Access Control | Enforce authz on every endpoint; deny by default |
| A02 | Cryptographic Failures | TLS everywhere; AES-256 at rest; no MD5/SHA1 |
| A03 | Injection | Parameterized queries; input validation; WAF |
| A04 | Insecure Design | Threat modeling; defense in depth; security reviews |
| A05 | Security Misconfiguration | IaC scanning; hardened defaults; disable debug |
| A06 | Vulnerable Components | SCA scanning; automated patching; SBOM |
| A07 | Auth & Session Failures | MFA; secure cookies; token rotation; lockouts |
| A08 | Software & Data Integrity | Signed artifacts; integrity checks; SAST |
| A09 | Logging & Monitoring Failures | Centralized SIEM; alerts; audit trails |
| A10 | SSRF | Outbound allowlist; block private IPs; proxy |

### 10.2 Idempotency & Safe Retries

- Assign **idempotency keys** to all mutating operations (POST, DELETE)
- Store idempotency key → result mapping with TTL in Redis or DB
- Return cached result on duplicate key — never process twice
- Use database transactions with proper isolation levels to prevent race conditions
- Implement **optimistic locking** (version columns) for concurrent update scenarios

### 10.3 Background Jobs & Queues

- Never process user-controlled job parameters without validation
- Implement **job-level authorization** — verify the enqueuing user can perform the action
- Limit job retry counts; implement dead-letter queues for failed jobs
- Sanitize job payloads — treat them as untrusted input even from internal producers
- Set timeouts on all background jobs to prevent runaway resource consumption

### 10.4 File Upload Security

- Validate file type by **magic bytes**, not file extension — extensions are trivially spoofed
- Set strict file size limits; enforce at the gateway before reaching app logic
- Store uploads **outside the web root**; never serve uploaded files with their original name
- Scan uploads with antivirus / malware detection before storing or processing
- Generate random, unguessable filenames for stored files
- Use pre-signed URLs for direct-to-S3 uploads; never proxy large files through the app server

### 10.5 Dependency & Supply Chain Security

- Lock all dependencies to exact versions in lock files (`package-lock.json`, `poetry.lock`)
- Generate and maintain an **SBOM** (Software Bill of Materials)
- Review new dependencies before adoption — check maintainer reputation, download count, last update
- Prefer dependencies with few transitive dependencies; audit the full tree
- Use private package mirrors for critical packages; prevent **dependency confusion attacks**

---

## 11. Agent Quick-Reference Checklists

### Pre-Deployment Security Checklist

- [ ] All endpoints require authentication (unless explicitly public)
- [ ] All endpoints have authorization checks (not just authentication)
- [ ] All inputs validated server-side with strict schemas
- [ ] All DB queries use parameterization / ORM safe queries
- [ ] All secrets loaded from vault/env — none in source code
- [ ] TLS enforced on all external and internal connections
- [ ] Security headers configured (HSTS, CSP, X-Frame-Options, etc.)
- [ ] Rate limiting applied to all public endpoints
- [ ] Error responses don't leak internals (stack traces, SQL errors)
- [ ] CORS configured with explicit allowlist
- [ ] Dependency vulnerabilities scanned and resolved
- [ ] Logging configured — auth events, errors, admin actions
- [ ] Sensitive data masked in logs
- [ ] Container runs as non-root with minimal capabilities
- [ ] Backups automated, encrypted, and restore-tested

### Code Review Security Gates

- [ ] No hardcoded secrets or credentials of any kind
- [ ] No use of `eval()`, `exec()` with user-controlled input
- [ ] No `innerHTML` or `dangerouslySetInnerHTML` with unsanitized data
- [ ] No raw string interpolation in DB queries
- [ ] No catch-all error handlers that swallow exceptions silently
- [ ] No disabled SSL certificate verification (`verify=False`)
- [ ] No overly permissive CORS (`Access-Control-Allow-Origin: *`)
- [ ] No debug endpoints or verbose error modes left enabled

---

## 12. zikel-solutions Therapeutic, Safeguarding & Compliance Guardrails (Product-Specific)

### 12.1 Therapeutic Recording Principles (PACE)

- **Playfulness**: keep recording flows simple and uncluttered; use progressive disclosure so staff only see fields needed for the current context
- **Acceptance**: prompts and labels must use non-blaming language; prohibit wording that frames children as "problematic" rather than describing observed behaviour
- **Curiosity**: prompt for hypotheses and contextual understanding, not just event logging
- **Empathy**: chronology views must remain child-centred and developmental, not only compliance-centric

### 12.2 Reflective Recording Prompt Guardrails

- Reflective prompts must never replace core safeguarding facts (who, what, where, when) — facts first, reflection second
- Prompt set must include therapeutic cues such as:
  - "What might the child have been communicating?"
  - "What emotion may have been underneath the behaviour?"
  - "What helped regulate the situation?"
- Prompt templates must be versioned; store `promptTemplateId` and `promptTemplateVersion` with each response
- If prompt generation services fail, recording must still continue with a safe fallback template (no workflow blocking)
- Never auto-generate clinical diagnoses or legal conclusions from prompt responses

### 12.3 One-Click Reg 44 & Reg 45 Evidence Packs

- Evidence pack generation must be asynchronous and tracked as a job (queued, processing, completed, failed)
- Each pack must include a manifest listing source records, source timestamps, and generation timestamp
- Pack outputs must be immutable snapshots with tamper-evident hashing
- Access to generate/download packs must be explicitly permission-gated (manager/admin/RI scope)
- Include field-level redaction support for sensitive third-party data where legally required

### 12.4 Safeguarding Chronology Auto-Build

- Chronologies must be built from a canonical event stream (incidents, IOI logs, tasks, approvals, comments)
- Timeline ordering should be deterministic: `eventOccurredAt` first, then `recordedAt` as secondary
- Late-entered records must be visibly flagged to preserve factual auditability
- Chronology rebuild operations must be idempotent and auditable

### 12.5 Risk Escalation Alerts

- Escalation rules must be explicit, configurable, and testable (no opaque hidden thresholds)
- Alert lifecycle states must be tracked: `new`, `acknowledged`, `in_progress`, `resolved`, `dismissed`
- Every state transition must capture actor, timestamp, and rationale in audit logs
- Alerting must support severity tiers (`low`, `medium`, `high`, `critical`) and route accordingly
- No automated punitive actions should be triggered solely from pattern flags; human review is mandatory

### 12.6 Pattern Mapping Across Incidents

- Pattern outputs must include explainability fields (`matchedSignals`, `window`, `confidenceBand`)
- Distinguish correlation from causation in all UI/API language
- Pattern results should support home-level and child-level filtering with role-scoped visibility
- Retain an analyst feedback loop (`confirmed`, `not_useful`, `false_positive`) to improve rule quality

### 12.7 Internal Monitoring Dashboard for Responsible Individuals (RIs)

- Dashboard must expose safeguarding and compliance KPIs by home, period, and severity
- RI access must be permission-based and auditable; all dashboard views/downloads are logged
- Dashboard drill-down must preserve least-privilege access (summary for broad users, detailed records for authorized users only)
- Support one-click navigation from KPI cards to chronology, incident, and evidence-pack context

### 12.8 Safeguarding Includes Data Protection

- Data residency: host production data on UK-hosted secure infrastructure
- Regulatory baseline: comply with UK GDPR + Data Protection Act 2018 requirements
- Security controls: align with ISO 27001/ISO-aligned information security practices
- Access governance: enforce role-based access controls and least-privilege defaults
- Full audit trails: immutable logging for data access, exports, edits, approvals, and escalations
- Confidentiality: enforce purpose-limited access, masking/redaction, and strict retention/deletion policies

### 12.9 Product-Specific Delivery Rule

- Recording workflows must support therapeutic thinking and safeguarding outcomes while remaining audit-ready.
- Compliance evidence is a by-product of good care documentation, not the sole UX goal.

---

> ✅ **SECURITY IS A PROCESS**: This document covers foundational patterns. Security requires ongoing threat modeling, penetration testing, security reviews on new features, and staying current with emerging vulnerabilities. Treat this as a living document — review and update quarterly.

---

*Production Backend Security & Architecture Guide · v1.0 · 2025*
