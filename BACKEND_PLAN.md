# Backend High-Level Plan (Neon + Fly.io)

> Foundational delivery checklist — work through phases in order.
> Tick items as they are implemented and verified.

---

## Purpose

- [ ] Build a production-ready backend from the current frontend domains and flows.
- [x] Use Neon (Postgres) for data storage.
- [ ] Deploy the backend on Fly.io with secure, scalable defaults.

---

## Scope Derived from Frontend

- [ ] Auth and session flows (login, register, OTP verification, logout, current user).
- [x] Role and permission model (staff, manager, admin; server-side RBAC enforcement).
- [x] Core modules: care-groups, homes, employees, young-people, vehicles, tasks, announcements, dashboard.
- [x] Audit and activity tracking for sensitive operations.
- [ ] Replace mock data/services with API-driven data access.

---

## Phase 1 Functional Scope (from UI/UX spec)

### 1) Custom Auth and Signup

- [ ] **4-step signup flow**
  - [ ] Step 1: Country of residence (UK or Nigeria)
  - [ ] Step 2: Basic profile — first name, middle name, surname, gender, email, phone
  - [ ] Step 3: Password setup with full policy enforcement (8+ chars, upper, lower, number, special char, confirm match, accept terms)
  - [ ] Step 4: OTP verification — 6-digit code, resend with cooldown, paste support, clear error states
- [ ] Successful OTP verification activates account
- [ ] Auto-login after successful OTP; fallback to `/login` if auto-login fails
- [ ] Login: email + password, friendly error states, session restore behaviour
- [ ] Redirect authenticated users to `/my-summary`; redirect unauthenticated access to `/login`
- [ ] Session persistence, expiry handling, logout + state clear + redirect

### 2) My Summary Page (`/my-summary`)

- [ ] **Stats overview** — overdue, due today, pending approval, rejected, draft, future, comments, rewards
- [ ] **To-do list panel** — task ID, title, relation, status, assignee, due date; paginated
- [ ] **Tasks to approve panel** — approval queue; view, approve (permission-controlled), process batch (permission-controlled)
- [ ] **Provisions section** — grouped by home; today's events + today's staff shifts per home
- [ ] **Access-control UX** — view-only banner for users lacking approval permission; block protected actions and show permission modal

### 3) My Dashboard Page (`/my-dashboard`)

- [ ] **Stats overview** — same KPI cards as My Summary
- [ ] **Widgets area** — list saved widgets, empty state, remove widget
- [ ] **Add widget flow** — type selection → configure (title, period, reports-on) → save → return to dashboard
- [ ] **Widget persistence** — stored in DB, loaded on page load (replacing local-storage approach)

### 4) Backend API Contracts (Phase 1)

#### Auth endpoints

- [x] `POST /api/v1/auth/register` — contract defined, stub live
- [x] `POST /api/v1/auth/verify-otp` — contract defined, stub live
- [x] `POST /api/v1/auth/resend-otp` — contract defined, stub live
- [x] `POST /api/v1/auth/login` — contract defined, stub live
- [x] `POST /api/v1/auth/logout` — contract defined, stub live
- [x] `GET  /api/v1/auth/me` — contract defined, stub live

#### Summary endpoints

- [x] `GET  /api/v1/summary/stats` — contract defined, stub live
- [x] `GET  /api/v1/summary/todos` — contract defined, stub live
- [x] `GET  /api/v1/summary/tasks-to-approve` — contract defined, stub live
- [x] `POST /api/v1/summary/:id/approve` — contract defined, stub live
- [x] `POST /api/v1/summary/process-batch` — contract defined, stub live
- [x] `GET  /api/v1/summary/provisions` — contract defined, stub live

#### Dashboard endpoints

- [x] `GET    /api/v1/dashboard/stats` — contract defined, stub live
- [x] `GET    /api/v1/dashboard/widgets` — contract defined, stub live
- [x] `POST   /api/v1/dashboard/widgets` — contract defined, stub live
- [x] `DELETE /api/v1/dashboard/widgets/:id` — contract defined, stub live

### 5) Access Control Rules

- [x] Server-side RBAC enforcement for all protected actions
- [x] Consistent 401/403 error shapes for UI handling
- [ ] Permission-controlled: approvals, batch processing, exports, settings, user management

### 6) Phase 1 Acceptance Criteria

- [ ] User can complete 4-step signup, verify OTP, and land in authenticated session
- [ ] User can login/logout reliably with valid session and token lifecycle
- [ ] My Summary loads user-specific stats, tasks, and provisions
- [ ] Restricted users cannot execute approval actions (403 returned + UI blocked)
- [ ] My Dashboard can create, list, and delete widgets via backend APIs

---

## Target Architecture

- [x] Node.js + TypeScript backend service.
- [x] Fastify + Zod request/response validation + JWT auth.
- [x] Prisma ORM + PostgreSQL on Neon.
- [x] Stateless API design for horizontal scaling on Fly.io.
- [x] OpenAPI-first contracts shared with frontend.

---

## Phased Delivery Plan

### Phase 0 — Contract and Planning

- [x] Freeze endpoint contracts from existing frontend types and route usage.
- [x] Publish API module boundaries and ownership.
- [ ] Define non-functional requirements: latency, availability, security baseline.
- [x] Produce OpenAPI draft for auth + core resources.

### Phase 1 — Backend Foundation

- [x] Bootstrap backend project, linting, formatting, test framework.
- [x] Add standardised error handling and response envelope.
- [x] Add `/health` and `/ready` endpoints.
- [ ] Add structured logging with request IDs.
- [x] Add env config schema validation.

### Phase 2 — Data Model and Neon Setup

- [x] Design normalised schema for all frontend domains.
- [x] Add migration pipeline and seed scripts from current mock data.
- [x] Create indexes for list filters/sorts used by UI tables.
- [ ] Configure Neon environments: dev, staging, prod.
- [x] Configure pooled runtime URL and direct migration URL separation.

### Phase 3 — Auth and Authorisation

- [ ] Implement login / register / verify-otp / resend-otp / logout / me endpoints.
- [ ] Implement secure password hashing and token lifecycle.
- [ ] Add server-side RBAC middleware and permission checks.
- [ ] Add auth/audit events for login and permission-sensitive actions.

### Phase 4 — Core Feature APIs

- [ ] Implement CRUD/list endpoints with pagination, filtering, sorting.
- [ ] Implement dashboard aggregation endpoints.
- [ ] Implement task explorer search endpoints.
- [ ] Implement announcements list/detail endpoints.
- [ ] Implement audit read endpoints.

### Phase 5 — Fly.io Deployment

- [x] Add Dockerfile and fly.toml.
- [ ] Configure Fly secrets and runtime envs.
- [x] Add release command for migrations.
- [x] Configure health checks, autoscaling, and rollback path.
- [ ] Deploy staging, run smoke tests, then promote to production.

### Phase 6 — Frontend Integration and Cutover

- [ ] Replace mock auth service with real backend auth.
- [ ] Replace mock list/data modules with React Query API hooks.
- [ ] Add feature flags for controlled rollout.
- [ ] Remove local mock persistence once endpoints are stable.
- [ ] Run end-to-end acceptance checks and regression tests.

---

## Security Baseline Checklist (Required)

- [ ] Threat model and data classification (PII / sensitive records / audit).
- [x] HTTPS-only and modern TLS in all environments.
- [x] Strict CORS allowlist (no wildcard in production).
- [x] Secure HTTP headers baseline.
- [x] Request schema validation for every endpoint.
- [ ] Output encoding and input sanitisation where applicable.
- [x] Server-side authorisation for every protected route.
- [ ] Password hashing with strong parameters (bcrypt / argon2, cost factor tuned).
- [ ] Access token expiry + refresh token rotation / revocation.
- [x] Endpoint and auth rate limiting.
- [ ] Brute-force protection and lockout / backoff policy.
- [x] SQL injection prevention (parameterised queries only — Prisma enforces this).
- [ ] Payload size limits and parser hardening.
- [x] Secrets in Fly secrets only; no secrets in repository.
- [ ] Secret / key rotation policy documented.
- [ ] Audit logs for auth, permission changes, destructive actions.
- [x] Secure error handling (no sensitive internals in responses).
- [ ] Dependency scanning and patching policy.
- [ ] SAST in CI and protected branches.
- [ ] Backup and tested restore runbook.

---

## Scalability Checklist (Required)

- [x] Stateless services for horizontal scaling.
- [x] Correct connection pooling strategy for Neon (PgBouncer via pooled URL).
- [ ] DB connection cap per instance.
- [x] Pagination on all list endpoints.
- [ ] Idempotency for retried writes.
- [ ] Queue / background jobs for heavy workloads (exports, emails).
- [ ] Caching strategy (what, where, invalidation rules).
- [ ] Timeout / retry / circuit-breaker policy for external dependencies.
- [ ] Avoid synchronous heavy work in request path.
- [x] Autoscaling thresholds and min/max machine policy on Fly.
- [ ] Load testing and capacity targets before production cutover.
- [x] Environment isolation across dev / staging / prod.

---

## Performance and Optimisation Checklist (Required)

- [x] Query-driven index design from real frontend filters.
- [x] Composite indexes for common where + sort patterns.
- [ ] `EXPLAIN ANALYZE` review for hot queries.
- [ ] Eliminate N+1 query patterns.
- [ ] Return only required fields in responses.
- [ ] Compression for suitable payloads.
- [ ] Cache headers / ETags for read-heavy resources.
- [ ] Async generation for long-running reports / exports.
- [ ] Endpoint SLOs with p95 / p99 targets.
- [ ] Continuous slow-query monitoring.
- [ ] Graceful degradation for non-critical features.
- [ ] Startup and memory profile tuning for Fly Machines.

---

## Reliability and Operations Checklist

- [x] Health / readiness probes wired to orchestration.
- [x] Structured logs with correlation IDs.
- [ ] Metrics and traces (OpenTelemetry recommended).
- [ ] SLOs and alerting for latency / error / availability.
- [ ] Centralised error tracking.
- [ ] Backward-compatible migration strategy.
- [ ] Rollback playbook tested in staging.
- [ ] DR objectives (RPO / RTO) defined and exercised.

---

## Neon-Specific Checklist

- [x] Runtime traffic uses pooled Neon connection URL.
- [x] Migrations use direct Neon connection URL.
- [ ] Branch strategy for preview / test environments.
- [x] Automated migration deploy in CI/CD release step.
- [ ] Data retention / backups and restore verification.
- [ ] Region alignment with Fly app for latency reduction.

---

## Fly.io-Specific Checklist

- [x] `fly.toml` with region, services, health checks, concurrency.
- [ ] Secrets managed only with Fly secrets.
- [x] Release command runs migrations before app traffic.
- [ ] Rolling deployment with rollback command documented.
- [x] Autoscaling policy and baseline machine counts defined.
- [ ] Observability sink configured for logs / metrics / traces.

---

## Definition of Done

- [ ] All critical frontend paths use backend APIs (no mock fallback in production).
- [ ] Security checklist complete and verified.
- [ ] Load test passes agreed throughput / latency targets.
- [ ] Staging and production deployment runbooks validated.
- [ ] Monitoring and alerts operational before go-live.
