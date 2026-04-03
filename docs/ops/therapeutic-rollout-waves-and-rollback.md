# Therapeutic Rollout Waves & Rollback Runbook

## Purpose
Defines production wave promotion and safe rollback procedures for therapeutic safeguarding modules.

## Feature controls
- Per-module flags:
  - `THERAPEUTIC_REG_PACKS_ENABLED`
  - `THERAPEUTIC_CHRONOLOGY_ENABLED`
  - `THERAPEUTIC_RISK_ALERTS_ENABLED`
  - `THERAPEUTIC_PATTERNS_ENABLED`
  - `THERAPEUTIC_RI_DASHBOARD_ENABLED`
  - `THERAPEUTIC_REFLECTIVE_PROMPTS_ENABLED`
- Pilot controls:
  - `THERAPEUTIC_PILOT_MODE_ENABLED`
  - `THERAPEUTIC_PILOT_TENANT_IDS`
- Observability controls:
  - `THERAPEUTIC_TELEMETRY_ENABLED`
  - `THERAPEUTIC_ROLLOUT_WAVE_LABEL`

## Suggested rollout waves

### Wave 0: Internal pilot
- `THERAPEUTIC_PILOT_MODE_ENABLED=true`
- `THERAPEUTIC_PILOT_TENANT_IDS=<internal_tenant_id>`
- `THERAPEUTIC_ROLLOUT_WAVE_LABEL=wave_0_internal`
- Enable all module flags for pilot validation.

### Wave 1: Limited production
- Keep pilot mode enabled.
- Expand `THERAPEUTIC_PILOT_TENANT_IDS` to small approved tenant cohort.
- Set `THERAPEUTIC_ROLLOUT_WAVE_LABEL=wave_1_limited`.
- Monitor telemetry and incident volume for at least 7 days.

### Wave 2: Broad production
- Option A:
  - Keep pilot mode enabled and continue controlled cohort expansion.
- Option B:
  - Disable pilot mode: `THERAPEUTIC_PILOT_MODE_ENABLED=false`
- Set `THERAPEUTIC_ROLLOUT_WAVE_LABEL=wave_2_broad`.

## Promotion checklist per wave
- [ ] UAT completed for target modules.
- [ ] Safeguarding lead + ops sign-off captured.
- [ ] Telemetry dashboards/log alerts prepared.
- [ ] On-call escalation owner assigned.
- [ ] Rollback command path validated before promotion.

## Rollback procedures

### Level 1: Single-module rollback
- Turn off affected module flag (example):
  - `THERAPEUTIC_RISK_ALERTS_ENABLED=false`
- Expected behavior:
  - guarded endpoints return `503 THERAPEUTIC_MODULE_DISABLED`
- Keep unaffected modules live.

### Level 2: Cohort rollback
- Keep module flags on, but restrict pilot:
  - `THERAPEUTIC_PILOT_MODE_ENABLED=true`
  - `THERAPEUTIC_PILOT_TENANT_IDS=<safe_internal_tenant_only>`
- Expected behavior:
  - non-allowlisted tenants return `403 THERAPEUTIC_MODULE_NOT_ENABLED_FOR_TENANT`

### Level 3: Full therapeutic rollback
- Disable all therapeutic module flags.
- Leave telemetry enabled for incident traces during stabilization.

## Post-rollback actions
- Confirm error rate and latency normalize.
- Capture incident timeline and impacted modules/tenants.
- Create remediation ticket with root-cause, fix owner, and re-release criteria.
- Run a focused regression set before re-promotion.

