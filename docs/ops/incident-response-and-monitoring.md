# Incident Response, Breach Workflow, and Monitoring

## Monitoring and Alerting Rules

- Monitor auth failures from `AuditLog` (`entityType=auth_login_failed`).
- Monitor cross-tenant denials from `entityType=cross_tenant_access_blocked`.
- Monitor permission mutations from `action=permission_changed`.
- Monitor break-glass events from `entityType=break_glass_access`.
- API endpoint for aggregated alert view: `GET /api/v1/audit/security-alerts`.

## Incident Roles

- Incident Commander: Platform Security Lead.
- Communications Lead: Product Operations Lead.
- Technical Lead: Backend Engineering Lead.
- Legal/Privacy Escalation: DPO / legal counsel contact.

## Breach Procedure

1. Triage and classify severity (P1/P2/P3).
2. Preserve evidence (logs, request IDs, DB snapshots).
3. Contain access (revoke tokens/keys, disable compromised principals).
4. Assess affected tenants and data categories.
5. Notify internal stakeholders and legal.
6. External notification per jurisdiction obligations.
7. Complete post-incident report with corrective actions.

## Jurisdiction Notification Targets

- UK: ICO notification within 72 hours where required.
- Canada: PIPEDA breach reporting and records workflow.
- US: state/sector-specific notification path; HIPAA path when applicable.

## Backup and Restore Readiness

- Quarterly restore drill required.
- Backup verification checklist:
  - Fresh encrypted backup exists.
  - Restore to staging succeeds.
  - Integrity checks pass on core tables.
  - Recovery time objective documented.

## Evidence Collection Standards

- Include UTC timestamps, actor IDs, tenant IDs, request IDs, and immutable audit entries.
- Store investigation artifacts in restricted access workspace.
