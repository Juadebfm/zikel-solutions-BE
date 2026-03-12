# Review Gates and Decision Log

## Legal Review Checkpoints

- UK launch legal checkpoint: required before production cutover.
- Canada launch legal checkpoint: required before tenant onboarding in Canada.
- US launch legal checkpoint: required before tenant onboarding in US states.

Owner: Compliance Lead  
Cadence: before regional go-live and quarterly thereafter.

## Security Architecture Review Gate

- Mandatory architecture review before moving from foundational schema work to expanded authz flows.
- Review scope:
  - tenant boundary enforcement,
  - privileged action controls,
  - incident readiness,
  - migration rollback strategy.

Owner: Security Architect + Backend Lead.

## Phase Completion Rule

- No phase is marked complete unless all phase-relevant checklist items in `mvp2.md` are checked and evidenced by:
  - code/tests,
  - deployment/migration scripts,
  - security/compliance documentation.
