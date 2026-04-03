# Therapeutic Safeguarding UAT Scenarios

## Purpose
Operational UAT checklist for Phase 9 rollout readiness across therapeutic safeguarding modules.

## Scope
- `reg_packs`
- `chronology`
- `risk_alerts`
- `patterns`
- `ri_dashboard`
- `reflective_prompts`

## Entry criteria
- Pilot controls configured for internal tenant:
  - `THERAPEUTIC_PILOT_MODE_ENABLED=true`
  - `THERAPEUTIC_PILOT_TENANT_IDS=<internal_tenant_id>`
  - `THERAPEUTIC_ROLLOUT_WAVE_LABEL=wave_internal_pilot`
- Module flags enabled for modules in test scope.
- Telemetry enabled: `THERAPEUTIC_TELEMETRY_ENABLED=true`.
- UAT users available across roles: owner/admin/staff.

## Scenario checklist

### UAT-01 Reg evidence packs
- [ ] `GET /api/v1/reports/reg44-pack` returns JSON/PDF/XLSX/ZIP for pilot tenant.
- [ ] `GET /api/v1/reports/reg45-pack` returns JSON/PDF/XLSX/ZIP for pilot tenant.
- [ ] Generated pack includes provenance metadata and checksum.
- [ ] Non-privileged role is denied (403).

### UAT-02 Chronology
- [ ] `GET /api/v1/safeguarding/chronology/young-people/:id` returns ordered chronology with evidence refs.
- [ ] `GET /api/v1/safeguarding/chronology/homes/:id` returns filtered chronology by date/source/severity.
- [ ] Narrative summary remains child-centred and evidence-grounded.

### UAT-03 Risk escalation alerts
- [ ] `POST /api/v1/safeguarding/risk-alerts/evaluate` creates/updates alerts as expected.
- [ ] Alert lifecycle transitions work end-to-end:
  - acknowledge -> in_progress -> resolve
- [ ] Alert notes and ownership updates are persisted and visible.

### UAT-04 Pattern mapping
- [ ] `GET /api/v1/safeguarding/patterns/young-people/:id` returns pattern clusters and explainability.
- [ ] `GET /api/v1/safeguarding/patterns/homes/:id` returns recurrence/co-occurrence summaries.
- [ ] `whyFlagged`, confidence, and evidence references are present.

### UAT-05 RI dashboard
- [ ] `GET /api/v1/reports/ri-dashboard` returns KPI aggregates.
- [ ] `GET /api/v1/reports/ri-dashboard/drilldown` returns paginated metric drilldowns.
- [ ] Export formats are valid for dashboard endpoints.

### UAT-06 Reflective prompts
- [ ] `GET /api/v1/safeguarding/reflective-prompts` returns prompt set for task/form context.
- [ ] `POST /api/v1/safeguarding/reflective-prompts/tasks/:id/responses` stores structured responses.
- [ ] Mandatory prompts enforce non-blaming reflective capture.

### UAT-07 Feature flag gating
- [ ] Disable one module flag (for example `THERAPEUTIC_PATTERNS_ENABLED=false`) and confirm endpoint returns:
  - `503 THERAPEUTIC_MODULE_DISABLED`
- [ ] Re-enable flag and confirm access restored.

### UAT-08 Pilot tenant gating
- [ ] With pilot mode enabled, allowed tenant gets success response.
- [ ] Non-pilot tenant is blocked with:
  - `403 THERAPEUTIC_MODULE_NOT_ENABLED_FOR_TENANT`

### UAT-09 Telemetry verification
- [ ] Successful calls emit telemetry log with:
  - module, action, latency, usageCount, rolloutWave
- [ ] Failed gated calls emit telemetry log with:
  - failureCount > 0
- [ ] Risk evaluation/resolve actions emit alert volume or action completion counters.

## Exit criteria
- All UAT scenarios marked pass.
- Safeguarding lead sign-off captured.
- Operations sign-off captured.
- Known issues logged with owner/date, and no unresolved critical defects.

