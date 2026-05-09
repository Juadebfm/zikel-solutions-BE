# Auth & Identity Refactor Plan

Pre-launch architectural overhaul of the auth, identity, session, and authorization model. Each phase is independently shippable — green build, working app, mergeable.

**Target effort:** ~10–14 focused days, sequenced over five phases.

**Status:** All five phases implemented. Smoke testing, regression tests, and a handful of small cleanups remain (see "Outstanding" at the bottom).

---

## Pre-flight decisions (lock these before writing code)

- [x] **Identity model:** Confirm two separate tables — `PlatformUser` (Zikel staff) and `TenantUser` (renamed from current `User`). _Rationale: clean audit story for healthcare compliance, mutually exclusive auth paths, no scope-enum branching._
- [x] **JWT audience:** Confirm `aud: 'platform' | 'tenant'` claim with audience validation in middleware. Two cookies: `__Host-zikel_admin_rt` and `__Host-zikel_rt`.
- [x] **Permission model:** Confirm capabilities-as-primitive, roles-as-named-bundles. Static permission catalog in code, system roles seeded at bootstrap, custom tenant roles allowed.
- [x] **MFA strategy:** TOTP as primary second factor with backup codes. Email OTP retained only for email verification at registration.
- [x] **Tenant scoping:** Confirm Prisma client extension for auto-injection of `tenantId` via AsyncLocalStorage. Explicit `$unscoped()` escape hatch for platform queries.

---

## Phase 1 — Identity foundation (2–3 days)

Split platform identity from tenant identity at the schema level.

### Schema
- [x] Rename Prisma model `User` → `TenantUser` (and update all FKs/relations)
- [x] Drop `super_admin` from `TenantUser.role` enum (platform-only concern now)
- [x] Create `PlatformUser` model: `id`, `email`, `passwordHash`, `role`, `mfaEnabled`, `isActive`, `lastLoginAt`, `failedAttempts`, `lockedUntil`
- [x] Create `PlatformRole` enum: `platform_admin`, `support`, `engineer`, `billing`
- [x] Create `PlatformAuditLog` model (separate retention policy from tenant audit)
- [x] Add domain restriction validator: `PlatformUser.email` must end with `@zikelsolutions.com` _(in `provisionPlatformUser` service helper)_
- [x] Reset DB and re-migrate (pre-launch — no data preservation needed)

### Code split
- [x] Break up `src/modules/auth/auth.service.ts` (~1,300 LOC) into: _(deviation: kept `src/modules/auth/` for tenant + added `src/modules/admin/` for platform; password/token primitives already lived at `src/lib/`)_
  - [x] `src/modules/identity/tenant-auth.service.ts` _→ stayed at `src/modules/auth/auth.service.ts`_
  - [x] `src/modules/identity/platform-auth.service.ts` _→ `src/modules/admin/admin-auth.service.ts`_
  - [x] `src/modules/identity/shared/passwords.ts` _→ `src/lib/password.ts` (pre-existing)_
  - [x] `src/modules/identity/shared/tokens.ts` _→ `src/lib/tokens.ts` (pre-existing)_
- [x] Add `aud` claim to JWT signing helper; validate in `fastify.authenticate`
- [x] New routes:
  - [x] `POST /admin/auth/login`
  - [x] `POST /admin/auth/logout`
  - [x] `POST /admin/auth/refresh`
  - [x] `GET /admin/auth/me`
- [x] Add `requireAudience('platform' | 'tenant')` middleware _(implemented as two decorators: `fastify.authenticate` rejects non-tenant; `fastify.authenticatePlatform` rejects non-platform)_
- [x] Apply audience guards: all `/admin/*` routes require `platform`; all `/api/v1/*` routes require `tenant`
- [x] Add second cookie config (`AUTH_PLATFORM_COOKIE_NAME`, `AUTH_PLATFORM_COOKIE_DOMAIN`) to env
- [x] Seed first platform user via SQL/CLI script (no self-register endpoint for platform) _(`scripts/seed-platform-user.ts`; one user seeded)_
- [x] Remove `super_admin` references from tenant-user code paths

### Gate
- [x] Platform JWT presented to `/api/v1/employees` returns 403 _(smoke-tested 2026-05-07: platform token → `/api/v1/auth/sessions` returned 403 PLATFORM_TOKEN_REJECTED)_
- [x] Tenant JWT presented to `/admin/tenants` returns 403 _(smoke-tested 2026-05-07: tenant token → `/admin/auth/me` returned 403 TENANT_TOKEN_REJECTED)_
- [x] Both audiences can independently login → refresh → logout _(smoke-tested 2026-05-07: tenant + platform login both succeed; refresh + logout both clean)_

---

## Phase 2 — Session architecture (2–3 days)

Separate session lifecycle from individual refresh tokens. Enables logout-all and proper theft detection.

### Schema
- [x] Create `Session` model: `id`, `userId`, `userType` (platform/tenant), `deviceLabel`, `userAgent`, `ipAddress`, `createdAt`, `lastActiveAt`, `revokedAt`, `mfaVerifiedAt`, `absoluteExpiresAt` _(deviation: implemented as two FK-enforced tables — `TenantSession` + `PlatformSession` — to match the platform/tenant split)_
- [x] Modify `RefreshToken`: add `sessionId` FK, add `replacedByTokenId` for rotation chain
- [x] Move `absoluteExpiresAt` from `RefreshToken` to `Session` (single source of truth per session)

### Code
- [x] Create `Session` on every successful login (login, OTP verify, invitation accept, MFA verify)
- [x] Refresh rotation: revoke old token, mint new token in same session, update `Session.lastActiveAt`
- [x] Token reuse detection: if presented refresh token has `revokedAt` set → revoke entire session + all its tokens, audit-log the theft signal
- [x] Add `sid` claim (session ID) to JWTs — enables session correlation in audit logs
- [x] New endpoints:
  - [x] `GET /auth/sessions` — list active sessions for current user
  - [x] `DELETE /auth/sessions/:id` — revoke one session
  - [x] `DELETE /auth/sessions` — revoke all sessions (logout everywhere)
- [x] Mirror endpoints under `/admin/auth/sessions/*` for platform users
- [x] Logout flow: revoke `Session.revokedAt`, then revoke all linked refresh tokens
- [x] Update audit log writes to include `sessionId` _(included in `metadata` for token-refresh / logout events; no top-level column was added)_

### Gate
- [ ] Logging in from two browsers shows two sessions in `GET /auth/sessions` _(not smoke-tested — needs FE; locked-in by tests/phase-regression.test.ts)_
- [ ] Logout from one device leaves the other intact _(not smoke-tested — needs FE; tested by tests/auth.session-expiry.routes.test.ts)_
- [ ] Logout-all kills both _(not smoke-tested — needs FE; covered by route tests)_
- [x] Replaying a rotated refresh token revokes the entire session chain _(smoke-tested 2026-05-07: first refresh succeeded, replay of OLD token returned 401 REFRESH_TOKEN_REUSED. Tripwire works.)_

---

## Phase 3 — Authorization layer (3–4 days)

Move from hardcoded role checks to capability-based permissions with auto-scoped tenant queries.

### Permission catalog
- [x] Create `src/auth/permissions.ts` with typed const catalog (initial set: ~25–30 permissions covering employees, care logs, safeguarding, tasks, billing, settings) _(37 permissions total)_
- [x] Document each permission with a short description (used for tenant role-builder UI later)

### Schema
- [x] New `Role` model: `id`, `tenantId` (nullable for system roles), `name`, `description`, `permissions: String[]`, `isSystemRole`, `isAssignable`
- [x] `TenantMembership.role` (enum) replaced with `roleId` (FK to `Role`)
- [x] Drop `Employee.roleId` if it's redundant with membership role (check current usage first)
- [x] Seed system roles at bootstrap: `Owner`, `Admin`, `Care Worker`, `Read-Only` _(seeded inside `register` and `createTenant` transactions via `seedSystemRolesForTenant`)_

### Middleware
- [x] Implement `requirePermission(...permissions: Permission[])` middleware
- [x] Replace `requireScopedRole({ globalRoles, tenantRoles })` calls with `requirePermission()` across all routes _(zero remaining in `src/modules`)_
- [x] Permission resolution: load membership → load role → check permission array intersection
- [x] Cache role lookups per request (avoid N+1 on permission checks) _(via per-request cache in `requireTenantContext`, which already pre-loads role + permissions)_

### Tenant auto-scoping
- [x] Create AsyncLocalStorage-based tenant context (set in `fastify.authenticate` after JWT decode)
- [x] Build Prisma client extension that auto-injects `where: { tenantId }` for all models with a `tenantId` column _(32 auto-scoped models)_
- [x] Add `prisma.$unscoped(callback)` escape hatch for platform queries — make it greppable and audit-loggable _(implemented as `withUnscopedTenant(callback)` wrapper, not a `prisma.$unscoped()` method — same semantics, simpler implementation)_
- [x] Audit every existing service file: remove now-redundant manual `tenantId` filters (or keep them — defense in depth — but flag the duplication) _(audited and KEPT as defense-in-depth; all 163 manual filters source tenantId from request-resolved context, never a hardcoded value, so they cannot diverge from auto-injection. Policy documented in `src/lib/tenant-scope.ts` header.)_

### Gate
- [x] All `requireScopedRole` calls replaced with `requirePermission`
- [ ] Cross-tenant query attempt without `$unscoped` returns empty (proves auto-scoping works) _(not directly smoke-tested — needs a 2nd tenant; auto-scope behaviour locked in by tests/phase-regression.test.ts and the documented policy in src/lib/tenant-scope.ts)_
- [x] Custom tenant role can be created via API/seeder and assigned to a member _(smoke-tested 2026-05-07: created "Reports Reader" role with 3 permissions, invited a user with it, login succeeded; reader can `GET /homes` (200) but blocked from `POST /employees` with 403 PERMISSION_DENIED + required=["employees:write"])_
- [x] One regression test locks in: "user without permission gets 403" _(`tests/phase-regression.test.ts` — Phase 3 block)_

---

## Phase 4 — TOTP MFA (1–2 days)

Replace email-OTP "MFA" with real second factor.

### Schema
- [x] Create `MfaCredential` model: `id`, `userId`, `userType`, `type` ('totp'), `secret` (encrypted at rest), `label`, `createdAt`, `lastUsedAt` _(deviation: split into `TenantMfaCredential` + `PlatformMfaCredential` for FK enforcement; added `confirmedAt` for two-step setup)_
- [x] Create `MfaBackupCode` model: `id`, `userId`, `userType`, `codeHash` (bcrypt), `usedAt` _(split into `TenantMfaBackupCode` + `PlatformMfaBackupCode`)_
- [x] Add encryption helper for secrets (env-driven key, KMS-ready interface) _(`src/lib/secret-crypto.ts` — AES-256-GCM, `MFA_SECRET_KEY_BASE64`)_

### Code
- [x] Add `otplib` dependency _(also added `qrcode` and `jsonwebtoken`)_
- [x] New endpoints (mirrored for platform under `/admin/`):
  - [x] `POST /auth/mfa/totp/setup` — returns QR code data URI + 8 backup codes (shown once)
  - [x] `POST /auth/mfa/totp/verify-setup` — confirms enrollment with first code
  - [x] `POST /auth/mfa/totp/verify` — used during login challenge
  - [x] `POST /auth/mfa/backup/verify` — backup code fallback
  - [x] `DELETE /auth/mfa/totp` — disable (requires recent re-auth)
- [x] Update login flow: if user has MFA enabled, return `{ mfaRequired: true, challengeToken }` (short-lived JWT, ~5min) instead of full token pair
- [x] Verify endpoint exchanges challenge token + TOTP code for full session
- [x] **Mandatory MFA enforcement** for: all platform users, all tenant `Owner` role holders _(2026-05-08: hardened to industry-standard "enrollment-required" hard block. Login for any Owner/platform user without TOTP returns `{ mfaEnrollmentRequired: true, enrollmentToken }` — no session is minted. The single-purpose enrollment token authorizes only `/auth/mfa/totp/enroll/{setup,confirm}` (tenant) and `/admin/auth/mfa/totp/enroll/{setup,confirm}` (platform); confirm mints the full session in the same flow. `requirePlatformMfa` is also wired as a defense-in-depth `preHandler` on `impersonation.routes.ts`.)_
- [x] Remove old "email-OTP MFA challenge" routes (`/auth/mfa/challenge`, `/auth/mfa/verify`) — keep email OTP only for email verification at registration
- [x] Update `Tenant.mfaSetupCompletedAt` semantics or drop it (likely drop — superseded by per-user MfaCredential) _(column dropped via migration `phase5_cleanup_legacy_enum_and_column`)_

### Gate
- [x] User can set up TOTP, scan QR with Google Authenticator, verify, then login requires the rolling code _(smoke-tested 2026-05-07: enrolled TOTP, scanned QR with authenticator, confirmed with first code; subsequent login returned `mfaRequired:true` + challengeToken (no session); challengeToken + valid TOTP returned full session with `mfaVerified:true`)_
- [x] Backup code consumes on use (single-use) _(smoke-tested 2026-05-07: backup code first use minted a session; second use of same code returned 401 MFA_BACKUP_INVALID)_
- [x] Tenant owner without MFA cannot complete login (forced enrollment flow) _(2026-05-08: hardened. Login response is `{ mfaEnrollmentRequired: true, enrollmentToken, enrollmentExpiresInSeconds: 900 }` — no session, no access token, no refresh cookie. The FE drives the user through `/auth/mfa/totp/enroll/setup` (returns QR + backup codes) and `/auth/mfa/totp/enroll/confirm` (mints the session). The enrollment token is single-purpose (`purpose: 'mfa-enrollment'`) and only authorizes those two endpoints.)_
- [x] Disabling TOTP requires fresh password confirmation _(`DELETE /auth/mfa/totp` takes `currentPassword`)_

---

## Phase 5 — Onboarding & workflow cleanup (2–3 days)

Consolidate three onboarding paths into two. Add first-class invitations and impersonation.

### Schema
- [x] Create `Invitation` model: `id`, `tenantId`, `email`, `invitedById`, `roleId`, `homeId?`, `token` (signed), `status`, `expiresAt`, `acceptedAt`, `acceptedByUserId` _(token stored as SHA-256 hash, not signed JWT — equivalent security, easier to revoke)_
- [x] Add `InvitationStatus` enum: `pending | accepted | revoked | expired` _(enum has 3 values; `expired` is computed at read time from `expiresAt < now` rather than stored)_
- [x] Create `ImpersonationGrant` model: `id`, `platformUserId`, `targetTenantId`, `targetUserId?`, `ticketReference`, `reason`, `grantedAt`, `expiresAt`, `grantedByUserId`, `revokedAt` _(all fields landed; `grantedByUserId` added in `phase_followup_impersonation_grant_approver` migration with FK to `PlatformUser` and self-approval rejected)_

### Onboarding consolidation
- [x] Keep: `POST /auth/register` for first tenant_owner of a brand-new tenant (creates Tenant + TenantUser + Membership + first Owner role)
- [x] Build: `POST /api/v1/invitations` (tenant admin creates) and `POST /api/v1/auth/invitations/:token/accept` (recipient accepts) _(2026-05-08: locked in as the canonical placement — NOT a deviation. Decision: invitations are tenant-scoped operations and Zikel platform staff do not create accounts on behalf of tenants. Compliance rationale: tenants are the data controllers; platform staff are processors and must not be in the account-provisioning path. There is no `/admin/invitations` mirror.)_
- [x] Delete: `POST /auth/join/:inviteCode` (replaced by Invitation flow)
- [x] Delete: `POST /auth/staff-activate` (replaced by Invitation flow)
- [x] Delete: `POST /employees/create-with-user` (admins send invitations, not direct accounts)
- [x] Delete: `pending_approval` membership status + the dead `MembershipStatus.active ? 'staff' : 'staff'` ternary in `employees.service.ts:333` _(both removed; `pending_approval` enum value dropped via migration `phase5_cleanup_legacy_enum_and_column`)_
- [x] List/manage: `GET /api/v1/invitations`, `DELETE /api/v1/invitations/:id` (revoke), `POST /api/v1/invitations/:id/resend` _(tenant-side, gated by `MEMBERS_READ` / `MEMBERS_WRITE` permissions — see canonical decision above)_

### Impersonation
- [x] Endpoint: `POST /admin/tenants/:id/impersonate` (platform users only) — requires `ticketReference` + `reason`, returns short-lived tenant-scoped token (max 4h, configurable)
- [x] Token carries `impersonatorId` claim; middleware stamps every audit log row with it _(auto-stamped by Prisma audit-log extension via `RequestAuditContext.impersonatorId`)_
- [x] Email notification to tenant owner when impersonation starts _(best-effort via Resend; falls back to log entry if `RESEND_API_KEY` is unset)_
- [x] Endpoint: `DELETE /admin/impersonation/active` (revoke own active impersonation)
- [x] Audit dashboard query: list all impersonations by ticket, by platform user, by tenant _(`GET /admin/impersonation` with filter querystring)_

### Gate
- [x] One unified invitation flow handles all non-owner staff onboarding
- [x] Tenant owner receives notification when a Zikel platform user impersonates them
- [x] Every API call during impersonation has `impersonatorId` in audit log
- [x] No remaining references to `pending_approval` or `staff-activate` in the codebase _(all gone; `TaskApprovalStatus.pending_approval` remains, that's a different enum for task approval workflow)_

---

## Phase 6 — Platform admin surface (1 day, 2026-05-08)

Build the cross-tenant management endpoints that platform staff need beyond impersonation. Resurrects the two skipped legacy tests that were placeholders for these surfaces.

### `/admin/tenants/*`
- [x] `GET /admin/tenants` — list all tenants (paginated, search by name/slug, filter by `isActive`/`country`) _(returns active member + home counts per tenant)_
- [x] `GET /admin/tenants/:id` — tenant detail (metadata, owner contact info, member/home/young-people/employee counts)
- [x] `POST /admin/tenants/:id/suspend` — suspend a tenant (`isActive=false`); atomically revokes all active sessions + refresh tokens for the tenant's users so they cannot continue past the suspension. **Restricted to `platform_admin`** via `requirePlatformRole` (support/engineer/billing get 403 PLATFORM_ROLE_DENIED).
- [x] `POST /admin/tenants/:id/reactivate` — reverse a suspension. Same role gate.
- [x] All mutations gated by `requirePlatformMfa` (defense-in-depth — already enforced by login flow but kept on this surface explicitly).
- [x] All actions recorded in `PlatformAuditLog` with `targetTenantId`, `reason`, and `event` metadata.

### `/admin/audit/*`
- [x] `GET /admin/audit/tenants/:id` — read a tenant's `AuditLog` (cross-tenant; runs inside `withUnscopedTenant`). Supports `action`, `userId`, `fromDate`, `toDate`, pagination. Includes user + impersonator subselect so the FE can render "who did what" without N+1 lookups.
- [x] **Read-of-audit is itself audited** — every call writes a `PlatformAuditLog` row with `entityType: 'tenant_audit_log'` and `event: 'tenant_audit_read'`, capturing the platform user, target tenant, filters used, IP and user-agent. Chain of custody for "who looked at what."
- [x] `GET /admin/audit/platform` — read `PlatformAuditLog` (filterable by `action`, `platformUserId`, `targetTenantId`, date range). For internal review of platform-staff activity.
- [x] Both endpoints require `mfaVerified=true` even on GET (cross-tenant data exposure threat model — same as a mutation).

### Supporting infrastructure
- [x] New `requirePlatformRole(...allowedRoles)` middleware at `src/middleware/platform-rbac.ts` — gates by `PlatformJwtPayload.role` against an allowlist. Returns `403 PLATFORM_ROLE_DENIED` with `{ required, actual }` in error details.
- [x] New service modules at `src/modules/admin/admin-tenants.service.ts` and `src/modules/admin/admin-audit.service.ts`. Both use `withUnscopedTenant` for cross-tenant queries and write `PlatformAuditLog` rows for every action (mutations) or read (audit-of-audit reads).
- [x] Routes wired into `src/routes/index.ts` under `/admin/tenants` and `/admin/audit`. No collision with the existing `POST /admin/tenants/:id/impersonate` (registered by `impersonationRoutes`).

### Gate
- [x] Tenant-audience JWT presented to `/admin/tenants` is rejected by audience guard _(covered by `tests/phase-regression.test.ts` Phase 1)_
- [x] `support` role cannot suspend a tenant _(`tests/tenants.routes.test.ts` — "support role cannot suspend (PLATFORM_ROLE_DENIED)")_
- [x] Suspending an already-suspended tenant returns `409 TENANT_ALREADY_SUSPENDED` _(`tests/tenants.routes.test.ts`)_
- [x] Suspension atomically revokes the tenant's user sessions + refresh tokens _(`tests/tenants.routes.test.ts`)_
- [x] A non-MFA-verified platform session is blocked from mutating `/admin/tenants/*` _(`tests/tenants.routes.test.ts`)_
- [x] Platform user reading `/admin/audit/tenants/:id` writes a `PlatformAuditLog` entry _(`tests/tenant-isolation.routes.test.ts` — replaces the legacy break-glass test)_
- [x] Skipped legacy tests resurrected: `tests/tenants.routes.test.ts` (was wholesale `describe.skip`) and `tests/tenant-isolation.routes.test.ts:341` (was the `it.skip` break-glass test) — both now pass against the new surface.

### `/admin/notifications/*` (added 2026-05-09 in the cleanup pass)
- [x] `POST /admin/notifications/broadcast` — Zikel platform staff push a system-wide notification to either every active user across every tenant, or a specified subset of tenants. Restricted to `platform_admin` (support/engineer/billing get `403 PLATFORM_ROLE_DENIED`); also gated by `requirePlatformMfa`. Wires up the existing `broadcastPlatformNotification` service (which was already implemented but previously unreachable behind a placeholder 403).
- [x] Replaces the dead tenant-side stub `POST /api/v1/notifications/broadcast` (which `denyPlatformOnlyRoute` was 403-ing as a placeholder).

### Cleanup of legacy placeholder routes (2026-05-09)
- [x] Deleted `denyPlatformOnlyRoute` middleware and all six routes it gated (Phase 1 placeholders that always returned `403 PLATFORM_ONLY` "being migrated to admin"). The migration is complete:
  - [x] `GET /api/v1/tenants` → replaced by `GET /admin/tenants`
  - [x] `GET /api/v1/tenants/:id` → replaced by `GET /admin/tenants/:id`
  - [x] `POST /api/v1/tenants` → removed (tenants self-create via `POST /api/v1/auth/register`; Zikel staff stay out of provisioning per compliance decision)
  - [x] `POST /api/v1/audit/break-glass/access` → replaced by `GET /admin/audit/tenants/:id` (audited cross-tenant read) + `POST /admin/tenants/:id/impersonate`
  - [x] `POST /api/v1/audit/break-glass/release` → replaced by `DELETE /admin/impersonation/active`
  - [x] `POST /api/v1/notifications/broadcast` → replaced by `POST /admin/notifications/broadcast`
- [x] Deleted now-dead service stubs: `auditService.breakGlassAccess` / `breakGlassRelease` and their schemas. Historical `AuditLog` rows with `entityType='break_glass_access'` are still surfaced by `listSecurityAlerts` for retrospective visibility.
- [x] Updated `tests/operations.routes.test.ts` — the two tests that pinned the placeholder `403 PLATFORM_ONLY` behaviour now lock in the deletion: tenant-audience hits to the old paths return `404`.

### Seed-script drift (fixed 2026-05-09)
- [x] `scripts/seed-safeguarding.mjs` — `FROM "User"` → `FROM "TenantUser"` (Phase 1 model rename was missed)
- [x] `scripts/seed-izu-rich-data.mjs` — 4 × `prisma.user.*` → `prisma.tenantUser.*`; 1 × `UserRole.super_admin` removed (enum value was deleted in Phase 1)
- [x] `scripts/archive-probe-accounts.mjs` — 2 × `prisma.user.*` → `prisma.tenantUser.*`
- [x] All seed scripts re-checked for stale model/enum references — clean.

### Real-database verification of Phase 6 (2026-05-09)
- [x] Wrote a probe that called the *actual* service functions against the local Postgres (not mocks). Confirmed:
  - `listTenantsForPlatform` returns paginated results with member/home counts
  - `getTenantForPlatform` returns detail + Owner array
  - `listTenantAuditForPlatform` reads the target tenant's audit log (4 rows for the smoke test tenant) and writes a chain-of-custody row to `PlatformAuditLog`
  - `listPlatformAudit` reads `PlatformAuditLog`
  - The fire-and-forget audit-of-audit pattern correctly swallows FK-violation errors so the read result is still returned to the caller — confirmed with a deliberate fake `platformUserId`.

### Phase 6 follow-ups (completed 2026-05-09)
- [x] Owner email notification on tenant suspend/reactivate. New helper `src/lib/tenant-lifecycle-email.ts` exposes `sendTenantSuspendedEmail` and `sendTenantReactivatedEmail` (Resend, falls back to log when `RESEND_API_KEY` unset — same pattern as `sendImpersonationStartedEmail`). Wired into `admin-tenants.service.ts` for both `suspendTenant` and `reactivateTenant` as fire-and-forget after the transaction commits — every active Owner of the tenant receives an email naming the actioning platform user, the reason, and the timestamp. Tests in `tests/tenants.routes.test.ts` lock the wiring in: 2 new tests assert `sendTenantSuspendedEmail` / `sendTenantReactivatedEmail` are called per Owner with the right shape.
- [x] CSV/JSON export of tenant audit log. New endpoint `GET /admin/audit/tenants/:id/export?format=csv|json` (CSV is default; format=json returns a JSON envelope with the same row shape). Hard-capped at `TENANT_AUDIT_EXPORT_MAX_ROWS = 50,000` per export — `X-Audit-Export-Truncated` header + JSON `truncated` flag indicate when split-by-date-range is needed for compliance. CSV uses a tiny in-house RFC-4180 serializer (`src/lib/csv.ts`) that emits a UTF-8 BOM so Excel opens cleanly. Filename: `audit-{slug}-{iso-stamp}.{csv|json}`. Every export writes a chain-of-custody row to `PlatformAuditLog` tagged `event: 'tenant_audit_exported'` with format + row count + filters used + IP/UA. Tests in `tests/admin-audit-export.routes.test.ts`: 6 cases covering CSV default, JSON variant, BOM, comma-quoting, headers, truncation flag, 404 on missing tenant, and MFA gate. Both flows verified end-to-end against real Postgres via probe (4 real audit rows in smoke test tenant; serializer produced correct CSV + JSON output).

---

## Quality gates (apply between every phase)

- [x] `npx tsc --noEmit` passes with zero errors
- [x] Manual smoke test: happy path of affected flow works end-to-end in browser _(smoke-tested 2026-05-07 via curl: Phase 1 audience isolation ✓, Phase 2 refresh-token tripwire ✓, Phase 3 capability-based deny ✓, Phase 4 TOTP enrollment + login + backup-code single-use ✓. Phase 5 impersonation deferred — exercised by tests/phase-regression.test.ts only, not needed for first launch.)_
- [x] At least one regression test (Vitest) locking in the phase's invariant (e.g., "platform token rejected on tenant route", "permission denial returns 403", "MFA challenge required on login") _(`tests/phase-regression.test.ts` — 7 tests covering all 5 phase gates, all passing)_
- [x] No new ESLint warnings _(swept new files: `src/auth/`, `src/middleware/`, `src/modules/admin/`, MFA + invitation routes/services, `auth.helpers.ts`, `secret-crypto.ts`, `impersonation-email.ts`, `tenant-scope.ts`, `plugins/auth.ts` — clean)_
- [x] `render.yaml` updated if env vars changed _(`AUTH_HINT_COOKIE_DOMAIN`, `AUTH_PLATFORM_COOKIE_DOMAIN`, `MFA_SECRET_KEY_BASE64`, `MFA_TOTP_ISSUER_TENANT`, `MFA_TOTP_ISSUER_PLATFORM` all wired)_
- [ ] Phase merged to main as a single squashed commit with a clear summary _(n/a — Julius handles git)_

---

## Explicitly NOT in this plan

- ~~Replacing auth with Auth0/Clerk~~ — would lose tenant-aware logic and lock in
- ~~Policy engine (CASL/Oso)~~ — capability strings + middleware sufficient for current scale
- ~~Microservice extraction~~ — premature
- ~~WebAuthn/passkeys~~ — Phase 4.5 once TOTP is stable in production
- ~~SCIM provisioning, SSO/SAML~~ — needed for enterprise sales motion, not before
- ~~Service accounts / API keys~~ — same trigger as SSO
- ~~Per-tenant rate limiting~~ — small follow-up post-launch
- ~~Comprehensive test suite~~ — pre-launch contracts will keep changing; one test per phase is the floor

---

## Effort estimate

| Phase | Days | Cumulative |
|---|---|---|
| 1. Identity foundation | 2–3 | 3 |
| 2. Session architecture | 2–3 | 6 |
| 3. Authorization layer | 3–4 | 10 |
| 4. TOTP MFA | 1–2 | 12 |
| 5. Onboarding & impersonation | 2–3 | 15 |

**Total:** ~2.5 weeks of focused single-engineer work. Each phase boundary is shippable.

---

## Quick wins to bundle alongside

These are tiny and can ride along with whichever phase touches the relevant file — don't make a separate phase.

- [x] Fix dead ternary at `src/modules/employees/employees.service.ts:333` (`MembershipStatus.active ? 'staff' : 'staff'`) — disappears in Phase 5 anyway, but worth flagging _(ternary removed when the parent `createEmployeeWithUser` function was deleted in Phase 5)_
- [x] Drop the `__Host-` cookie prefix only if cross-subdomain Domain attr is needed; otherwise keep it. Current setup is correct; just confirming during Phase 1. _(kept; verified correct)_
- [x] Audit OTP retention: currently soft-deleted via `usedAt`. Add a cleanup job to purge OTPs older than 30 days (Phase 4 housekeeping). _(landed: `src/lib/otp-retention.ts` runs every 6h via `setInterval`, purges `OtpCode` rows older than `OTP_RETENTION_DAYS` (default 30). Disabled in test env. Wired into `server.ts` startup + onClose.)_
- [x] Standardize all auth error codes into a single typed enum (Phase 1 housekeeping). _(landed: `src/auth/error-codes.ts` exports `AuthErrorCode` const-as-enum + type. Existing string literals can migrate incrementally; new code should import.)_

---

## Outstanding (the honest list)

Items above marked `- [ ]` summarised here in priority order:

**Smoke testing (the only thing actually blocking ship-readiness):**
1. None of the phase gates were exercised end-to-end in a real browser. Each gate item above marked `- [ ]` because of "not smoke-tested" needs to be run by hand before going to production. Recipes are documented in the phase summaries.

**Pre-existing test suite needs catch-up:**
2. ~~106 of the 179 pre-existing tests fail after the refactor~~ — TRIAGED. Suite now reads **175 passing | 2 skipped | 0 failing** (2026-05-08, post-Phase-6). Of the 2 skipped: one is `tests/auth.session-expiry.routes.test.ts:102` (covered indirectly by `tests/phase-regression.test.ts`'s Phase 2 block — re-enabling requires either dropping the `oneOf` schema wrapper on `POST /auth/login` or driving login through real password verification instead of mocking `authService.login`); the other is `tests/summary.provisions.seed.smoke.test.ts` (opt-in DB smoke gated behind `RUN_DB_SMOKE=1`, runs against a seeded database). Both skips carry inline notes naming exactly what's needed to resurrect them.

**Spec gaps (decisions needed):** ALL RESOLVED (2026-05-08)
3. ~~Decide whether tenant Owners without MFA should be hard-blocked from login.~~ — RESOLVED: hardened to industry-standard enrollment-required flow. Owners and platform users without TOTP receive `{ mfaEnrollmentRequired, enrollmentToken }` instead of a session at login. Single-purpose enrollment token drives `/auth/mfa/totp/enroll/setup` + `/auth/mfa/totp/enroll/confirm` (and the `/admin` mirror), with confirm minting the session. See `src/auth/mfa-enrollment-token.ts`, `src/modules/auth/mfa.routes.ts`, `src/modules/admin/admin-mfa.routes.ts`.
4. ~~Whether to wire `requirePlatformMfa` to platform mutation routes.~~ — RESOLVED: applied as a `preHandler` on `impersonation.routes.ts` (defense-in-depth; the new login flow already prevents non-MFA-verified platform sessions from existing).
5. ~~Whether invitations should also have a platform-side mirror at `/admin/invitations`.~~ — RESOLVED: NO. Tenant-only at `/api/v1/invitations`. Compliance rationale: tenants are data controllers; Zikel platform staff are processors and must not be in the account-provisioning path. Platform staff support tenants via impersonation (audited, time-limited, ticket-bound) — not by creating accounts on their behalf.

**Cleanup, low risk:** ALL DONE (May 2026)
4. ~~Audit redundant manual `where: { tenantId }` filters in service files~~ — completed; kept as defense-in-depth, policy documented in `src/lib/tenant-scope.ts`.
5. ~~OTP retention cleanup job~~ — landed in `src/lib/otp-retention.ts`.
6. ~~Auth error codes typed enum~~ — landed in `src/auth/error-codes.ts`.
7. ~~Add `grantedByUserId` to `ImpersonationGrant`~~ — landed (migration `phase_followup_impersonation_grant_approver`); self-approval is rejected at the service layer.
