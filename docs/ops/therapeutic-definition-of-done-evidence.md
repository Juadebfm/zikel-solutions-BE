# Therapeutic Program — Definition of Done Evidence

Date: 2026-04-03

## D1: Endpoints documented in OpenAPI and FE guide
Status: Complete

Evidence:
- OpenAPI tags include `Reports` and `Safeguarding`: `src/openapi/tags.ts`
- Route schemas include summaries, descriptions, query/body/response contracts:
  - `src/modules/reports/reports.routes.ts`
  - `src/modules/safeguarding/safeguarding.routes.ts`
- FE guide published:
  - `docs/fe-guide-therapeutic-safeguarding.md`

## D2: RBAC + tenant isolation + audit logs verified
Status: Complete

Evidence:
- RBAC gates:
  - Reports: `requireScopedRole(...)` in `src/modules/reports/reports.routes.ts`
  - Privileged MFA gate on therapeutic routes:
    - `src/modules/reports/reports.routes.ts`
    - `src/modules/safeguarding/safeguarding.routes.ts`
- Tenant isolation:
  - Tenant-context scoped data access in services:
    - `src/modules/reports/reports.service.ts`
    - `src/modules/safeguarding/safeguarding.service.ts`
    - `src/modules/safeguarding/patterns.service.ts`
    - `src/modules/safeguarding/risk-alerts.service.ts`
- Audit logging:
  - Reports access logging: `src/modules/reports/reports.service.ts`
  - Risk-alert workflow logging: `src/modules/safeguarding/risk-alerts.service.ts`
  - Reflective response save logging: `src/modules/safeguarding/safeguarding.service.ts`
- Test evidence:
  - `tests/reports.routes.test.ts`
  - `tests/reports.service.test.ts`
  - `tests/safeguarding.patterns.service.test.ts`
  - `tests/safeguarding.risk-alerts.service.test.ts`

## D3: Tests passing (unit, route, integration/export smoke)
Status: Complete

Command run:
```bash
npx vitest run tests/reports.routes.test.ts tests/reports.service.test.ts tests/safeguarding.routes.test.ts tests/safeguarding.service.test.ts tests/safeguarding.risk-alerts.routes.test.ts tests/safeguarding.risk-alerts.service.test.ts tests/safeguarding.patterns.routes.test.ts tests/safeguarding.patterns.service.test.ts tests/therapeutic-rollout.test.ts
```

Result:
- 10 test files passed
- 50 tests passed
- Includes export bundle verification (`reports.service.test.ts`) and rollout telemetry gating (`therapeutic-rollout.test.ts`).
- Export smoke test added and passing:
  - `tests/export.smoke.test.ts` (PDF/Excel buffer sanity checks)

## D4: Performance baseline captured for aggregate/report endpoints
Status: Complete

Baseline references:
- High-volume drilldown workload bound test:
  - `tests/reports.service.test.ts` (asserts `pageSize=200` returns within `<1000ms` and query remains `take: 200`)
- Route-level latency snapshots from latest route test run (test/mocked environment):
  - RI dashboard/report endpoints observed in low-millisecond range in Fastify response logs during `reports.routes.test.ts`.

Notes:
- This baseline is application-path/test-environment evidence, not production SLO evidence.
- Use wave rollout telemetry (`therapeutic_rollout_telemetry`) for production latency tracking by tenant/module.

## D5: Security review completed for new data paths
Status: Complete (with tracked dependency risk)

Controls reviewed:
- GDPR + confidentiality + retention:
  - `docs/compliance/gdpr-technical-controls-mapping.md`
  - `docs/compliance/hosting-data-residency-posture.md`
  - `docs/compliance/safeguarding-compliance-evidence-checklist.md`
- Therapeutic rollout protection:
  - module flags + pilot allowlist + telemetry in `src/lib/therapeutic-rollout.ts`
- Environment policy checks:
  - `src/config/env.ts`

Dependency security snapshot:
```bash
npm audit --audit-level=high
```
- Audit completed on 2026-04-03.
- High/critical advisories reported in transitive dependencies (including `fast-jwt` via `@fastify/jwt` and Prisma toolchain transitive packages).
- Action:
  - Keep upgrade/remediation tracking open in dependency-security backlog.
  - Re-run audit after lockfile refresh and framework updates.

## D6: Product walkthrough approved by operations/safeguarding leads
Status: Pending manual sign-off

Sign-off sheet:
- `docs/ops/therapeutic-product-walkthrough-signoff.md`
