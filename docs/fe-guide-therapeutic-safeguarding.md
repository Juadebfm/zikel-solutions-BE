# FE Guide: Therapeutic Safeguarding APIs

## Scope
This guide covers the therapeutic and safeguarding endpoints introduced across Phases 1–9.

Base prefix: `/api/v1`

## Authentication and gating
- All endpoints in this guide require authenticated user context.
- Therapeutic modules are guarded by backend feature flags and pilot allowlist.
- Common gate errors:
  - `503 THERAPEUTIC_MODULE_DISABLED`
  - `403 THERAPEUTIC_MODULE_NOT_ENABLED_FOR_TENANT`

## Reports APIs

### GET `/reports/reg44-pack`
### GET `/reports/reg45-pack`
Query:
- `format`: `json | pdf | excel | zip` (default `json`)
- `homeId?`, `careGroupId?`, `dateFrom?`, `dateTo?`, `timezone?`
- `maxEvidenceItems?` (default 200)

Notes:
- `json` returns structured pack payload.
- `pdf`, `excel`, `zip` return file responses with `Content-Disposition`.
- `zip` returns evidence bundle (pack JSON + exports + evidence files).

### GET `/reports/ri-dashboard`
Query:
- `format`: `json | pdf | excel` (default `json`)
- `homeId?`, `careGroupId?`, `dateFrom?`, `dateTo?`, `timezone?`

### GET `/reports/ri-dashboard/drilldown`
Query:
- `metric`: `compliance | safeguarding_risk | staffing_pressure | action_completion`
- `page?`, `pageSize?`
- `format`: `json | pdf | excel` (default `json`)
- `homeId?`, `careGroupId?`, `dateFrom?`, `dateTo?`, `timezone?`

## Safeguarding APIs

### Chronology
- GET `/safeguarding/chronology/young-people/:id`
- GET `/safeguarding/chronology/homes/:id`

Query:
- `dateFrom?`, `dateTo?`
- `eventType?`, `severity?`, `source?`
- `maxEvents?` (default 200)
- `includeNarrative?` (default `true`)
- `confidentialityScope?`: `standard | restricted`

### Pattern mapping
- GET `/safeguarding/patterns/young-people/:id`
- GET `/safeguarding/patterns/homes/:id`

Query:
- `dateFrom?`, `dateTo?`
- `maxIncidents?`, `minOccurrences?`, `maxPatterns?`
- `confidenceThreshold?`
- `confidentialityScope?`: `standard | restricted`

### Risk alerts
- GET `/safeguarding/risk-alerts/rules`
- GET `/safeguarding/risk-alerts`
- GET `/safeguarding/risk-alerts/:id`
- POST `/safeguarding/risk-alerts/evaluate`
- POST `/safeguarding/risk-alerts/:id/acknowledge`
- POST `/safeguarding/risk-alerts/:id/in-progress`
- POST `/safeguarding/risk-alerts/:id/resolve`
- POST `/safeguarding/risk-alerts/:id/notes`

### Reflective prompts
- GET `/safeguarding/reflective-prompts`
- POST `/safeguarding/reflective-prompts/tasks/:id/responses`

## FE implementation guidance
- Handle `json` and file-download responses differently for report exports.
- Treat `THERAPEUTIC_MODULE_DISABLED` and `THERAPEUTIC_MODULE_NOT_ENABLED_FOR_TENANT` as non-retryable business gates.
- Show contextual UX copy for gated responses (feature unavailable, not enabled for tenant).
- Continue normal auth handling for `401`/`403` auth failures.

## Source references
- Routes registration: `src/routes/index.ts`
- Reports route schemas: `src/modules/reports/reports.routes.ts`
- Safeguarding route schemas: `src/modules/safeguarding/safeguarding.routes.ts`
- OpenAPI tags: `src/openapi/tags.ts`

