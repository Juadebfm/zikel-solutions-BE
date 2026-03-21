# Guardrails: Auth & Tenant Registration Refactor

## What We Are Changing

### Goal
Refactor registration from a 2-step model (account first, tenant second) into two distinct flows:

1. **Care Home Registration** — Public signup creates user + organization in one transaction
2. **Staff Onboarding** — Admin adds staff from dashboard OR shares org invite link

### Changes Overview

| # | Change | Files Affected |
|---|--------|---------------|
| 1 | Modify `POST /auth/register` to accept org fields and create user + tenant + membership atomically | `auth.schema.ts`, `auth.service.ts`, `auth.routes.ts` |
| 2 | Deprecate/remove `POST /tenants/self-serve` (folded into register) | `tenants.service.ts`, `tenants.routes.ts`, `tenants.schema.ts` |
| 3 | Add `POST /tenants/:id/invite-link` — admin generates a reusable invite link per org | `tenants.service.ts`, `tenants.routes.ts`, `tenants.schema.ts` |
| 4 | Add `POST /auth/join/:inviteCode` — staff self-registers via invite link (pending approval) | `auth.service.ts`, `auth.routes.ts`, `auth.schema.ts` |
| 5 | Add staff provisioning endpoint `POST /tenants/:id/staff` — admin creates staff account directly | `tenants.service.ts`, `tenants.routes.ts`, `tenants.schema.ts` |
| 6 | Add `POST /auth/staff-activate` — staff activates pre-provisioned account | `auth.service.ts`, `auth.routes.ts`, `auth.schema.ts` |
| 7 | Prisma schema changes — add `TenantInviteLink` model, add `pending_approval` membership status, add `staff_activation` OTP purpose | `prisma/schema.prisma` |
| 8 | Add `staff_activation` OTP purpose to email subject/action maps | `lib/email.ts` |

---

## Existing Contracts That MUST NOT Break

### 1. Auth Response Shape (`AuthResponse#`)
Every auth endpoint (login, verify-otp, refresh, switch-tenant, mfa/verify) returns:
```json
{
  "success": true,
  "data": {
    "user": { User# },
    "session": { AuthSession# },
    "tokens": { "accessToken": "...", "refreshToken": "..." }
  }
}
```
**Rule:** The `register` endpoint currently returns a DIFFERENT shape (userId + OTP status). This is fine — it does NOT return AuthResponse#. Do NOT change it to return AuthResponse# (registration doesn't log the user in, OTP verify does).

**Files that define this contract:**
- `src/openapi/shared.schemas.ts` — `AuthResponseSchema`, `AuthSessionSchema`, `UserSchema`
- `src/modules/auth/auth.routes.ts` — `signAccessToken()` helper

### 2. JWT Payload Shape (`JwtPayload`)
```typescript
{ sub, email, role, tenantId, tenantRole, mfaVerified }
```
**Rule:** Do NOT add or remove fields from the JWT. All middleware (`mfa.ts`, `rbac.ts`) and every authenticated route destructures this payload.

**Files that consume this:**
- `src/middleware/mfa.ts` — reads `role`, `tenantRole`, `mfaVerified`
- `src/middleware/rbac.ts` — reads `role`, `tenantRole`
- `src/lib/tenant-context.ts` — reads `sub`, `role`
- Every route handler — reads `(request.user as JwtPayload).sub`

### 3. Session Context Resolution (`resolveAuthSessionContext`)
**Rule:** This function is the SINGLE source of truth for building the session after any auth event. It is called from: `verifyOtp`, `login`, `refreshAccessToken`, `verifyMfaChallenge`, `switchTenant`, `requestMfaChallenge`.

**Do NOT:**
- Duplicate its logic in new endpoints
- Skip calling it after creating a new membership
- Change its return type (`AuthSessionContext`)

### 4. Registration Response Shape
Current `POST /auth/register` returns:
```json
{ "userId", "message", "otpDeliveryStatus", "resendAvailableAt" }
```
**Rule:** This response shape can be EXTENDED (add new fields) but the 4 existing fields must remain. The frontend uses `userId` for OTP verification and `otpDeliveryStatus` for UI messaging.

### 5. OTP Flow
**Rule:** The OTP verification flow MUST remain unchanged:
- `register` → creates user with `emailVerified: false` → sends OTP
- `verify-otp` → sets `emailVerified: true` → issues tokens → calls `resolveAuthSessionContext`
- After our change, `verify-otp` will now return a session WITH an active tenant (because register created one). This is the desired behavior — but verify-otp itself must NOT change.

### 6. Login Flow
**Rule:** `POST /auth/login` must continue to work exactly as-is. After our changes, users who registered via the new flow will simply have a tenant already — `resolveAuthSessionContext` will find their membership and return it. No changes to login needed.

### 7. Existing Invite System
**Rule:** The token-based invite system (`POST /:id/invites`, `POST /invites/accept`) must continue working for admin-to-admin invites. We are ADDING new flows, not replacing the existing invite system.

### 8. RBAC Permission Hierarchy
```
super_admin → can manage all roles
tenant_admin → can manage sub_admin, staff
sub_admin → can manage staff only
staff → cannot manage anyone
```
**Rule:** New endpoints must respect this hierarchy. The staff provisioning endpoint and invite link generation must enforce the same role checks.

### 9. Tenant Slug Uniqueness
**Rule:** `Tenant.slug` has a `@unique` constraint. When auto-generating slugs from org name during registration, we handle collisions by returning `409 ORG_SLUG_TAKEN` so the user can choose a different name or slug.

### 10. MFA Requirement
**Rule:** `tenant_admin` requires MFA for privileged **mutating** actions. After registration, the new admin will have `mfaRequired: true` in their session. Read-only dashboard/bootstrap access is allowed pre-MFA so the frontend can nudge completion, but write endpoints remain blocked until MFA is verified.
ok
### 11. Audit Logging
**Rule:** Every new action must have an audit log entry. Follow existing patterns:
- `AuditAction.register` for registration
- `AuditAction.record_created` for new memberships/tenants
- `AuditAction.permission_changed` for role assignments

### 12. Rate Limiting
**Rule:** New public endpoints MUST have rate limits. Current rate limits:
- Registration: 5/min
- Join via invite link: 5/min
- Staff activate: 10/min
- Validate invite link: 20/min
- OTP verify: 10/min
- Staff provisioning: 20/min

### 13. Password Security
**Rule:** Use existing `hashPassword()` from `lib/password.ts`. Never store plaintext. The existing password schema (12+ chars, uppercase, lowercase, number, special char) must be enforced for any new registration flow.

---

## Regression Checklist

### After EVERY step, verify the following:

#### A. Compilation & Types
- [x] `npx tsc --noEmit --strict` passes with zero errors
- [x] No new `any` types introduced
- [x] All Zod schemas have matching JSON schemas for OpenAPI

#### B. Existing Auth Flows (MUST still work)
- [x] `POST /auth/register` — creates user + sends OTP (now also creates tenant)
- [x] `POST /auth/verify-otp` — activates account, returns tokens + session
- [x] `POST /auth/login` — authenticates, returns tokens + session with tenant context
- [x] `POST /auth/resend-otp` — resends OTP with cooldown
- [x] `POST /auth/refresh` — rotates tokens, returns fresh session
- [x] `POST /auth/logout` — revokes refresh token
- [x] `POST /auth/forgot-password` — sends password reset OTP
- [x] `POST /auth/reset-password` — resets password, revokes all tokens
- [x] `GET /auth/me` — returns current user profile
- [x] `POST /auth/switch-tenant` — switches active tenant
- [x] `POST /auth/mfa/challenge` — sends MFA code
- [x] `POST /auth/mfa/verify` — verifies MFA, escalates session

#### C. Existing Tenant Flows (MUST still work)
- [x] `GET /tenants` — super_admin list tenants
- [x] `GET /tenants/:id` — super_admin get tenant details
- [x] `POST /tenants` — super_admin provision tenant
- [x] `GET /tenants/:id/memberships` — list memberships (scoped)
- [x] `POST /tenants/:id/memberships` — add member (scoped)
- [x] `PATCH /tenants/:id/memberships/:id` — update member (scoped)
- [x] `GET /tenants/:id/invites` — list invites (scoped)
- [x] `POST /tenants/:id/invites` — create invite (scoped)
- [x] `PATCH /tenants/:id/invites/:id/revoke` — revoke invite
- [x] `POST /tenants/invites/accept` — accept invite

#### D. Session Contract
- [x] After register + OTP verify: session has `activeTenantId` set, `memberships` has 1 entry, `activeTenantRole` is `tenant_admin`
- [x] After login (existing user): session resolves correctly with their memberships
- [x] After token refresh: session reflects current membership state
- [x] After switch-tenant: session updates to new tenant context
- [x] `mfaRequired` is `true` when `tenantRole === tenant_admin`

#### E. Database Integrity
- [x] No orphaned users (user without membership after new registration flow)
- [x] No orphaned tenants (tenant without any membership)
- [x] Tenant slug uniqueness enforced (collision handling works)
- [x] All new records use transactions where atomicity is required
- [x] Existing seed script still runs without errors

#### F. Security
- [x] New public endpoints have rate limiting
- [x] Passwords are hashed (never stored in plain text)
- [x] Old TenantInvite tokens are hashed (sha256) before storage. New TenantInviteLink codes are stored plaintext (they are public shareable URLs, not secrets)
- [x] No account enumeration vulnerabilities in new endpoints
- [x] RBAC hierarchy enforced on all new tenant-scoped endpoints
- [x] MFA middleware still applied to all tenant routes

#### G. OpenAPI / Swagger
- [x] New endpoints appear in Swagger docs (JSON schemas defined for all new routes)
- [x] Request/response schemas are accurate
- [x] No broken `$ref` references
- [x] No deprecated endpoints (self-serve was removed, not deprecated)

#### H. Email
- [x] OTP emails still send correctly for registration
- [x] Staff activation emails send via existing OTP email template with `staff_activation` purpose
- [x] Dev mode (console logging) still works

---

## Implementation Order (completed 2026-03-19)

All steps completed. `npx tsc --noEmit --strict` passes. 98 tests pass, 0 failures.

### Step 1: Prisma Schema Changes — DONE
Added `TenantInviteLink` model, `pending_approval` to MembershipStatus, `staff_activation` to OtpPurpose.

### Step 2: Modify Registration — DONE
`register()` now creates user + tenant + membership in a `$transaction`. Added `organizationName` and `organizationSlug` fields.

### Step 3: Remove Self-Serve Endpoint — DONE
Removed `POST /tenants/self-serve` from routes, service, and imports.

### Step 4: Add Staff Provisioning Endpoint — DONE
Added `POST /tenants/:id/staff` with RBAC, rate limiting, audit logging, and activation OTP email.

### Step 5: Add Org Invite Link — DONE
Added `POST /tenants/:id/invite-link`, `GET /tenants/:id/invite-links`, `PATCH /tenants/:id/invite-links/:id/revoke`, `GET /auth/join/:code`, `POST /auth/join/:code`.

### Step 6: Add Staff Activation — DONE
Added `POST /auth/staff-activate` — returns full AuthResponse on success.

### Step 7: Seed Script — NO CHANGES NEEDED
Seed uses Prisma directly (not the register function), so no changes required. Still compiles and runs.

### Step 8: Captcha Removal — DONE (added post-plan)
Removed `src/middleware/captcha.ts`, `src/lib/captcha.ts`, `tests/auth.captcha.routes.test.ts`. Stripped all `requireCaptcha` preHandlers, captcha env vars, and `X-Captcha-Token` CORS header.

---

## Files Inventory (touch list)

| File | Action | Risk |
|------|--------|------|
| `prisma/schema.prisma` | MODIFY — add TenantInviteLink model, possibly new enum value | HIGH — migration affects all environments |
| `src/modules/auth/auth.schema.ts` | MODIFY — extend RegisterBodySchema with org fields | MEDIUM — must keep backward compat |
| `src/modules/auth/auth.service.ts` | MODIFY — register() creates org atomically | HIGH — core auth logic |
| `src/modules/auth/auth.routes.ts` | MODIFY — update register route schema, add new routes | HIGH — public API surface |
| `src/modules/tenants/tenants.schema.ts` | MODIFY — add staff provisioning + invite link schemas | LOW |
| `src/modules/tenants/tenants.service.ts` | MODIFY — add staff provisioning + invite link logic, remove self-serve | MEDIUM |
| `src/modules/tenants/tenants.routes.ts` | MODIFY — add new routes, remove self-serve | MEDIUM |
| `src/openapi/shared.schemas.ts` | POSSIBLY MODIFY — if new shared types needed | LOW |
| `src/lib/email.ts` | MODIFY — add `staff_activation` OTP purpose to subject/action maps | LOW |
| `src/plugins/cors.ts` | MODIFY — removed X-Captcha-Token from allowed headers | LOW |
| `tests/tenants.routes.test.ts` | MODIFY — replaced self-serve test with staff provisioning test | LOW |
| `tests/auth.service.test.ts` | MODIFY — updated register tests for new transaction flow | LOW |
| `src/middleware/captcha.ts` | DELETED — captcha removed from project | LOW |
| `src/lib/captcha.ts` | DELETED — captcha removed from project | LOW |
| `tests/auth.captcha.routes.test.ts` | DELETED — captcha tests removed | LOW |
| `src/config/env.ts` | MODIFY — removed captcha env vars | LOW |
| `.env.example` | MODIFY — removed captcha section | LOW |

### Files We MUST NOT Touch
| File | Reason |
|------|--------|
| `src/middleware/mfa.ts` | MFA logic is correct, no changes needed |
| `src/middleware/rbac.ts` | RBAC hierarchy is correct, no changes needed |
| `src/lib/password.ts` | Password hashing is correct, just USE it |
| `src/lib/break-glass.ts` | Break-glass is unrelated to this change |
| `src/lib/tenant-context.ts` | Tenant context resolution is correct, no changes needed |
| `src/lib/tokens.ts` | Token generation is correct, just USE it |
| `src/plugins/rate-limit.ts`, `src/plugins/helmet.ts`, `src/plugins/swagger.ts`, `src/plugins/auth.ts` | Infrastructure plugins are unrelated |
| `src/types/index.ts` | JwtPayload must NOT change |
| All other module routes/services | employees, homes, tasks, etc. are unrelated |
