# Safeguarding Compliance Evidence Checklist

## Technical evidence
- [ ] Runtime env snapshot includes:
  - [ ] `SAFEGUARDING_CHRONOLOGY_RETENTION_DAYS`
  - [ ] `SAFEGUARDING_PATTERNS_RETENTION_DAYS`
  - [ ] `SAFEGUARDING_RISK_ALERT_RETENTION_DAYS`
  - [ ] `SAFEGUARDING_CONFIDENTIALITY_DEFAULT_SCOPE`
  - [ ] `AI_CONTEXT_REDACTION_ENABLED`
  - [ ] `AI_CONTEXT_REDACTION_MODE`
- [ ] API evidence showing confidentiality behavior:
  - [ ] Chronology `standard` scope response (redacted)
  - [ ] Chronology `restricted` scope response (full, authorized account)
  - [ ] Patterns `standard` scope response (redacted)
  - [ ] Risk-alert list/get `standard` scope response (redacted)
- [ ] API evidence showing retention behavior:
  - [ ] Chronology window clamped to retention policy
  - [ ] Patterns window clamped to retention policy
  - [ ] Risk-alert list/get filtered by retention cutoff
- [ ] AI prompt hardening evidence:
  - [ ] Provider request payload snapshot with masked sensitive values
  - [ ] Audit log entry includes prompt redaction metadata

## Operational evidence
- [ ] Residency verification completed for DB and object storage regions
- [ ] Access-control review completed for privileged safeguarding endpoints
- [ ] MFA enforcement confirmed for safeguarding and AI routes
- [ ] Incident response contact list reviewed and current

## Sign-off
- [ ] Security lead approval
- [ ] Safeguarding lead approval
- [ ] Operations approval
- [ ] Release note published
