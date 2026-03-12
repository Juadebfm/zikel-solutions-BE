# MFA-Ready Architecture (Phase 1 Staged)

## Current Backend Readiness

- Auth session now returns:
  - `mfaRequired`
  - `mfaVerified`
- `mfaRequired` is true for privileged contexts:
  - `super_admin`
  - active tenant role `tenant_admin`
- JWT payload includes `mfaVerified` claim for downstream policy hooks.

## Why This Is Staged

- Phase 1 establishes enforcement hooks without forcing immediate UX rollout.
- Existing flows remain functional while frontend and support runbooks are finalized.

## Phase 2 Enforcement Plan

1. Add second-factor enrollment endpoint(s) and secure secret storage.
2. Require MFA challenge on privileged login/session elevation.
3. Gate privileged endpoints on `mfaVerified=true` + freshness window.
4. Add backup code management and recovery workflow.
