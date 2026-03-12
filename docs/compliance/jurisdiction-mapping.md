# Jurisdiction Compliance Mapping (UK, Canada, US)

## UK (Primary): UK GDPR + DPA 2018

- Data minimization: documented in `docs/security/data-governance-and-retention.md`.
- Accountability/governance: threat model + role matrix + audit controls.
- DPIA trigger: required for high-risk child-data processing changes.
- Breach handling: 72-hour workflow in `docs/ops/incident-response-and-monitoring.md`.
- Children-data safeguards: tenant-scoped access controls, least privilege, auditability.
- International transfer controls: transfer register per processor/region.

## Canada: PIPEDA

- Safeguards: encryption in transit/rest, scoped authz, immutable auditing.
- Retention/access/openness: retention table + deletion workflow + documented policies.
- Breach notification and records: covered in incident runbook and records retention.
- Processor terms: contract review gate before onboarding non-Canadian processors.

## US

- Baseline controls mapped to OWASP + NIST secure software and API controls.
- HIPAA applicability decision required per tenant onboarding questionnaire.
- If HIPAA applies: enforce Security Rule administrative/technical/physical safeguards and BAAs.
- State-law obligations tracked with legal counsel before regional launch.

## Cross-Border Transfer Register (Required)

Maintain a processor register with:

- Source tenant region.
- Destination region.
- Transfer mechanism (adequacy/SCC/contractual safeguard/exception).
- Sub-processor and contract reference.
- Data category and risk rating.
