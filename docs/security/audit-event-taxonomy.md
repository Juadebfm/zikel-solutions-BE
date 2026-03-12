# Audit Event Taxonomy

## Required Fields Per Event

- `actor`: `userId` (nullable only for system events).
- `action`: enum (`login`, `logout`, `register`, `password_change`, `otp_verified`, `record_created`, `record_updated`, `record_deleted`, `permission_changed`).
- `target`: `entityType` + `entityId`.
- `timestamp`: `createdAt` (UTC).
- `source`: `ipAddress` + `userAgent` when available.
- `result/context`: `metadata`.

## Standard Entity Types

- `tenant`, `tenant_membership`, `tenant_invite`
- `auth_session`, `auth_login_failed`
- `care_group`, `home`, `employee`, `young_person`
- `vehicle`, `task`, `task_approval`, `task_approval_batch`
- `announcement`, `widget`
- `user_ai_access`, `ai_ask`
- `cross_tenant_access_blocked`
- `break_glass_access`

## Alert-Critical Events

- Repeated `auth_login_failed`.
- `cross_tenant_access_blocked`.
- `permission_changed` for privileged entities.
- `break_glass_access`.
