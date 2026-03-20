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
| 7 | Prisma schema changes — add `TenantInviteLink` model, add `pendingApproval` membership status | `prisma/schema.prisma` |
| 8 | Update seed script to match new registration flow | `prisma/seed.ts` |
| 9 | Update email templates for new flows (staff invite, invite link, approval notification) | `lib/email.ts` |

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
**Rule:** `Tenant.slug` has a `@unique` constraint. When auto-generating slugs from org name during registration, we MUST check uniqueness and handle collisions (append random suffix).

### 10. MFA Requirement
**Rule:** `tenant_admin` requires MFA. After registration, the new admin will have `mfaRequired: true` in their session. The frontend handles this — do NOT change MFA logic.

### 11. Audit Logging
**Rule:** Every new action must have an audit log entry. Follow existing patterns:
- `AuditAction.register` for registration
- `AuditAction.record_created` for new memberships/tenants
- `AuditAction.permission_changed` for role assignments

### 12. Rate Limiting
**Rule:** New public endpoints MUST have rate limits. Follow existing patterns:
- Registration: 5/min
- OTP verify: 10/min
- Self-serve: 3/10min

### 13. Password Security
**Rule:** Use existing `hashPassword()` from `lib/password.ts`. Never store plaintext. The existing password schema (12+ chars, uppercase, lowercase, number, special char) must be enforced for any new registration flow.

---

## Regression Checklist

### After EVERY step, verify the following:

#### A. Compilation & Types
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] No new `any` types introduced
- [ ] All Zod schemas have matching JSON schemas for OpenAPI

#### B. Existing Auth Flows (MUST still work)
- [ ] `POST /auth/register` — creates user + sends OTP (now also creates tenant)
- [ ] `POST /auth/verify-otp` — activates account, returns tokens + session
- [ ] `POST /auth/login` — authenticates, returns tokens + session with tenant context
- [ ] `POST /auth/resend-otp` — resends OTP with cooldown
- [ ] `POST /auth/refresh` — rotates tokens, returns fresh session
- [ ] `POST /auth/logout` — revokes refresh token
- [ ] `POST /auth/forgot-password` — sends password reset OTP
- [ ] `POST /auth/reset-password` — resets password, revokes all tokens
- [ ] `GET /auth/me` — returns current user profile
- [ ] `POST /auth/switch-tenant` — switches active tenant
- [ ] `POST /auth/mfa/challenge` — sends MFA code
- [ ] `POST /auth/mfa/verify` — verifies MFA, escalates session

#### C. Existing Tenant Flows (MUST still work)
- [ ] `GET /tenants` — super_admin list tenants
- [ ] `GET /tenants/:id` — super_admin get tenant details
- [ ] `POST /tenants` — super_admin provision tenant
- [ ] `GET /tenants/:id/memberships` — list memberships (scoped)
- [ ] `POST /tenants/:id/memberships` — add member (scoped)
- [ ] `PATCH /tenants/:id/memberships/:id` — update member (scoped)
- [ ] `GET /tenants/:id/invites` — list invites (scoped)
- [ ] `POST /tenants/:id/invites` — create invite (scoped)
- [ ] `PATCH /tenants/:id/invites/:id/revoke` — revoke invite
- [ ] `POST /tenants/invites/accept` — accept invite

#### D. Session Contract
- [ ] After register + OTP verify: session has `activeTenantId` set, `memberships` has 1 entry, `activeTenantRole` is `tenant_admin`
- [ ] After login (existing user): session resolves correctly with their memberships
- [ ] After token refresh: session reflects current membership state
- [ ] After switch-tenant: session updates to new tenant context
- [ ] `mfaRequired` is `true` when `tenantRole === tenant_admin`

#### E. Database Integrity
- [ ] No orphaned users (user without membership after new registration flow)
- [ ] No orphaned tenants (tenant without any membership)
- [ ] Tenant slug uniqueness enforced (collision handling works)
- [ ] All new records use transactions where atomicity is required
- [ ] Existing seed script still runs without errors

#### F. Security
- [ ] New public endpoints have rate limiting

- [ ] Passwords are hashed (never stored in plain text)
- [ ] Invite codes/tokens are hashed before storage
- [ ] No account enumeration vulnerabilities in new endpoints
- [ ] RBAC hierarchy enforced on all new tenant-scoped endpoints
- [ ] MFA middleware still applied to all tenant routes

#### G. OpenAPI / Swagger
- [ ] New endpoints appear in Swagger docs
- [ ] Request/response schemas are accurate
- [ ] No broken `$ref` references
- [ ] Deprecated endpoints marked clearly

#### H. Email
- [ ] OTP emails still send correctly for registration
- [ ] New staff invite emails render correctly
- [ ] Invite link emails include correct URL
- [ ] Dev mode (console logging) still works

---

## Implementation Order

### Step 1: Prisma Schema Changes
Add new model(s), update enums if needed. Run migration.
**Check:** A, E

### Step 2: Modify Registration (auth.schema + auth.service)
Add org fields to RegisterBodySchema. Modify `register()` to create user + tenant + membership in transaction.
**Check:** A, B (register + verify-otp + login), D, E, F

### Step 3: Remove Self-Serve Endpoint
Remove `POST /tenants/self-serve` from routes and service.
**Check:** A, C (remaining endpoints), G

### Step 4: Add Staff Provisioning Endpoint
Add `POST /tenants/:id/staff` — admin creates staff account directly.
**Check:** A, C, F, G, H

### Step 5: Add Org Invite Link
Add invite link generation and `POST /auth/join/:inviteCode` for self-service staff registration.
**Check:** A, B, C, F, G, H

### Step 6: Add Staff Activation
Add `POST /auth/staff-activate` for pre-provisioned staff to set their password and activate.
**Check:** A, B, F, G

### Step 7: Update Seed Script
Update seed to use new registration flow.
**Check:** E

### Step 8: Final Integration Test
Run ALL checks A through H.

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
| `src/lib/email.ts` | MODIFY — add staff invite + invite link email templates | LOW |
| `prisma/seed.ts` | MODIFY — update to use new flow | LOW |

### Files We MUST NOT Touch
| File | Reason |
|------|--------|
| `src/middleware/mfa.ts` | MFA logic is correct, no changes needed |
| `src/middleware/rbac.ts` | RBAC hierarchy is correct, no changes needed |
| `src/lib/password.ts` | Password hashing is correct, just USE it |
| `src/lib/break-glass.ts` | Break-glass is unrelated to this change |
| `src/lib/tenant-context.ts` | Tenant context resolution is correct, no changes needed |
| `src/lib/tokens.ts` | Token generation is correct, just USE it |
| `src/plugins/*` | Infrastructure plugins are unrelated |
| `src/types/index.ts` | JwtPayload must NOT change |
| All other module routes/services | employees, homes, tasks, etc. are unrelated |
