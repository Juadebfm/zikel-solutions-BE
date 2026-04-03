# GDPR Technical Controls Mapping

## Scope
Backend technical controls mapped to GDPR-aligned requirements for access control, confidentiality, retention, and auditability.

## Control mapping
- Art. 5(1)(c) Data minimisation:
  - AI context redaction before provider calls (`AI_CONTEXT_REDACTION_*`)
  - Standard confidentiality scope masking for safeguarding insights
- Art. 5(1)(e) Storage limitation:
  - Chronology retention clamp (`SAFEGUARDING_CHRONOLOGY_RETENTION_DAYS`)
  - Pattern retention clamp (`SAFEGUARDING_PATTERNS_RETENTION_DAYS`)
  - Safeguarding risk alert retention filter (`SAFEGUARDING_RISK_ALERT_RETENTION_DAYS`)
- Art. 5(1)(f) Integrity and confidentiality:
  - Role/tenant access checks via tenant-context enforcement
  - Confidentiality scopes (`standard` vs `restricted`)
  - MFA gate on sensitive routes (`requirePrivilegedMfa`)
- Art. 25 Data protection by design and by default:
  - Default confidentiality scope (`SAFEGUARDING_CONFIDENTIALITY_DEFAULT_SCOPE`)
  - Default AI redaction enabled (`AI_CONTEXT_REDACTION_ENABLED=true`)
- Art. 30 Records of processing:
  - Audit log entries for AI usage and safeguarding risk-alert access/updates
- Art. 32 Security of processing:
  - TLS-enforced DB connectivity in staging/production
  - HTTPS-only constraints for public/webhook/storage URLs in production
  - Signed refresh-cookie auth pattern and secure-cookie controls

## Implementation references
- `src/config/env.ts`
- `src/lib/data-protection.ts`
- `src/modules/ai/ai.service.ts`
- `src/modules/safeguarding/safeguarding.service.ts`
- `src/modules/safeguarding/patterns.service.ts`
- `src/modules/safeguarding/risk-alerts.service.ts`
