# Therapeutic AI + Safeguarding Intelligence — Implementation Checklist

> Status: **READY FOR FINAL SIGN-OFF**
> Created: 2026-04-02

---

## Phase 0: Baseline Already Live

- [x] **0.1** AI Ask endpoint is page-aware (`POST /api/v1/ai/ask`)
- [x] **0.2** Supported pages include `summary` + `daily_logs` + all core entity pages
- [x] **0.3** Role-strength profiles are active (`owner`, `admin`, `staff`)
- [x] **0.4** Structured AI response is live (`analysis.topPriorities`, `risks`, `quickActions`, etc.)
- [x] **0.5** Summary can return consolidated platform snapshot for privileged profiles
- [x] **0.6** Audit trail coverage exists across critical flows
- [x] **0.7** Security alert pipeline foundation exists (auth/cross-tenant/admin-change/break-glass)

---

## Phase 1: One-Click Reg 44 & Reg 45 Evidence Packs

- [x] **1.1** Define Reg 44 evidence pack schema (sections, ordering, mandatory evidence points)
- [x] **1.2** Define Reg 45 evidence pack schema (quality indicators + evidence mapping)
- [x] **1.3** Build BE aggregation service for evidence sources:
  - tasks, daily logs, incidents, approvals, audits, staffing, home events
- [x] **1.4** Add export endpoints:
  - `GET /api/v1/reports/reg44-pack`
  - `GET /api/v1/reports/reg45-pack`
- [x] **1.5** Support export formats (PDF + XLSX + ZIP evidence bundle)
- [x] **1.5a** PDF and XLSX export paths implemented
- [x] **1.5b** ZIP evidence bundle export implemented
- [x] **1.6** Include provenance metadata (who generated, when, tenant, filters, hash/checksum)
- [x] **1.7** Enforce strict RBAC and tenant isolation for evidence generation/download
- [x] **1.8** Add test coverage (unit + route + export smoke)
- [x] **1.8a** Route-level coverage added (auth, RBAC, JSON success, export path)
- [x] **1.8b** Service unit coverage added for pack generation and scope validation

---

## Phase 2: Safeguarding Chronology Auto-Build

- [x] **2.1** Define chronology event model (eventType, timestamp, child/home linkage, severity, evidenceRef)
- [x] **2.2** Build chronology builder service:
  - merges incidents, daily logs, notes, approvals, tasks, key audit events
- [x] **2.3** Add endpoints:
  - `GET /api/v1/safeguarding/chronology/young-people/:id`
  - `GET /api/v1/safeguarding/chronology/homes/:id`
- [x] **2.4** Add filtering (date window, event type, severity, source)
- [x] **2.5** Add AI narrative summarization for chronology (child-centred, evidence-linked)
- [x] **2.6** Add test coverage for ordering, dedupe, and evidence links

---

## Phase 3: Safeguarding Risk Escalation Alerts

- [x] **3.1** Define risk rules catalog (severity thresholds, trigger windows, repeat-event logic)
- [x] **3.2** Implement risk evaluation engine (event-driven + scheduled backfill)
- [x] **3.3** Add safeguarding-specific alert types (separate from platform security alerts)
- [x] **3.4** Add routing:
  - in-app notifications
  - webhook dispatch
  - optional email hooks
- [x] **3.5** Add alert workflow states (new, acknowledged, in_progress, resolved)
- [x] **3.6** Add endpoints for acknowledgement/ownership/escalation notes
- [x] **3.7** Add test coverage (rule correctness + dedupe + escalation chain)

---

## Phase 4: Pattern Mapping Across Incidents

- [x] **4.1** Define normalized incident feature schema (time, location, trigger, involved roles, outcomes)
- [x] **4.2** Build pattern detection service (frequency, clusters, recurrence windows, co-occurrence)
- [x] **4.3** Add trend endpoints:
  - `GET /api/v1/safeguarding/patterns/young-people/:id`
  - `GET /api/v1/safeguarding/patterns/homes/:id`
- [x] **4.4** Add explainability fields (`whyFlagged`, confidence, evidence references)
- [x] **4.5** Add tests for false-positive controls and tenant isolation

---

## Phase 5: Internal Monitoring Dashboard for RIs

- [x] **5.1** Define RI KPI contract (compliance, safeguarding risk, staffing pressure, action completion)
- [x] **5.2** Build aggregate query service and paginated drill-down endpoints
- [x] **5.3** Add date-range and home/care-group filters
- [x] **5.4** Add export endpoints for RI dashboard views
- [x] **5.5** Add audit logging for dashboard data access
- [x] **5.6** Add load/performance tests on aggregate endpoints

---

## Phase 6: Reflective Recording Prompts (Therapeutic Guidance)

- [x] **6.1** Define reflective prompt library by context (incident type, child profile, safeguarding class)
- [x] **6.2** Include mandatory non-blaming prompt sets:
  - “What might the child have been communicating?”
  - “What emotion may have been underneath the behaviour?”
  - “What helped regulate the situation?”
- [x] **6.3** Add prompt versioning + rollout flags
- [x] **6.4** Add API fields so FE can request prompt set by form/task context
- [x] **6.5** Persist reflective responses in structured payload sections
- [x] **6.6** Add validation + tests for prompt retrieval and response storage

---

## Phase 7: PACE-Aligned Product Behavior

- [x] **7.1** Playfulness: define minimal-response mode fields for low cognitive load UIs
- [x] **7.2** Acceptance: enforce non-blaming language guardrails in AI system prompts
- [x] **7.3** Curiosity: expose pattern insight summaries and “what to explore next” suggestions
- [x] **7.4** Empathy: chronology summaries must stay child-centred and evidence-grounded
- [x] **7.5** Add prompt QA rubric and regression tests for language safety

---

## Phase 8: Data Protection & Confidentiality Hardening

- [x] **8.1** Verify and document hosting/data residency posture for target deployments
- [x] **8.2** Map technical controls to GDPR articles (access control, retention, auditability)
- [x] **8.3** Add retention policies for chronology/pattern/risk artifacts
- [x] **8.4** Add policy-based redaction for sensitive fields in AI/context payloads
- [x] **8.5** Add confidentiality access scopes for safeguarding insights
- [x] **8.6** Update docs with compliance evidence checklist (technical + operational)

---

## Phase 9: Rollout & Adoption

- [x] **9.1** Add feature flags per module (`reg_packs`, `chronology`, `risk_alerts`, `patterns`, `ri_dashboard`, `reflective_prompts`)
- [x] **9.2** Enable internal pilot tenant
- [x] **9.3** Capture telemetry (usage, latency, failure, alert volume, action completion)
- [x] **9.4** Run safeguarding scenario UAT with domain stakeholders
- [x] **9.5** Promote to production tenant waves with rollback plan

Phase 9 operational references:
- UAT scenario pack: `docs/ops/therapeutic-safeguarding-uat-scenarios.md`
- Wave + rollback runbook: `docs/ops/therapeutic-rollout-waves-and-rollback.md`

---

## Definition of Done (Global)

- [x] **D1** All new endpoints are documented in OpenAPI and FE guide
- [x] **D2** RBAC + tenant isolation + audit logs verified
- [x] **D3** Tests passing (unit, route, integration, export smoke)
- [x] **D4** Performance baseline captured for aggregate/report endpoints
- [x] **D5** Security review completed for new data paths
- [ ] **D6** Product walkthrough approved by operations/safeguarding leads

DoD evidence references:
- `docs/ops/therapeutic-definition-of-done-evidence.md`
- `docs/ops/therapeutic-product-walkthrough-signoff.md`
