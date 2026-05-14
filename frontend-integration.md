# Zikel Solutions — Complete Frontend Integration Reference

**Backend:** Fastify + Prisma + PostgreSQL (Neon) + Stripe
**Generated:** 2026-05-11
**Source of truth for schemas:** `/docs` (Swagger UI) — every endpoint with full request/response schemas
**Source of truth for workflows / conventions:** this document

---

## Table of Contents

1. [Base URLs & Environments](#1-base-urls)
2. [Response Envelope](#2-response-envelope)
3. [Authentication](#3-authentication)
4. [JWT Structure](#4-jwt-structure)
5. [Error Code Catalog](#5-error-code-catalog)
6. [Permission Catalog](#6-permission-catalog)
7. [Pagination, Rate Limits, Files](#7-conventions)
8. [Subscription State Machine](#8-subscription-state-machine)
9. **Module Reference (tenant-side `/api/v1/*`)**
   - [Public](#m1-public) · [Auth](#m2-auth) · [MFA](#m3-mfa) · [Invitations](#m4-invitations) · [Me](#m5-me) · [Tenants](#m6-tenants)
   - [Billing ⭐](#m7-billing) · [AI ⭐](#m8-ai) · [AI Conversations ⭐](#m9-ai-conversations)
   - [Homes](#m10-homes) · [Employees](#m11-employees) · [Young People](#m12-young-people) · [Vehicles](#m13-vehicles) · [Tasks](#m14-tasks) · [Daily Logs](#m15-daily-logs) · [Care Groups](#m16-care-groups)
   - [Documents](#m17-documents) · [Forms](#m18-forms) · [Uploads](#m19-uploads)
   - [Announcements](#m20-announcements) · [Audit](#m21-audit) · [Calendar](#m22-calendar) · [Dashboard](#m23-dashboard) · [Exports](#m24-exports) · [Groupings](#m25-groupings) · [Help Center](#m26-help-center) · [Notifications](#m27-notifications) · [Regions](#m28-regions) · [Reports](#m29-reports) · [Roles](#m30-roles) · [Rotas](#m31-rotas) · [Safeguarding](#m32-safeguarding) · [Sensitive Data](#m33-sensitive-data) · [Settings](#m34-settings) · [Summary](#m35-summary) · [Webhooks](#m36-webhooks) · [Integrations](#m37-integrations)
10. **Module Reference (platform admin `/admin/*`)**
    - [Admin Auth](#m38-admin-auth) · [Admin MFA](#m39-admin-mfa) · [Admin Tenants](#m40-admin-tenants) · [Admin Audit](#m41-admin-audit) · [Admin Notifications](#m42-admin-notifications) · [Admin Billing](#m43-admin-billing) · [Admin Impersonation](#m44-admin-impersonation)
11. [Suggested FE Redesign Focus](#11-fe-redesign-focus)
12. [Quick Test Commands](#12-quick-test)

---

## 1. Base URLs

| Environment | URL |
|---|---|
| Production (custom domain — DNS migrating to Cloudflare) | `https://api.zikelsolutions.com` |
| Production (Render direct, always works) | `https://zikel-solutions-be.onrender.com` |
| Local dev | `http://localhost:8080` |

**Path prefixes:**
- `/api/v1/*` — tenant-side (care home staff, JWT audience `tenant`)
- `/admin/*` — platform staff (Zikel internal, JWT audience `platform`)
- `/health` — unauthenticated probe (no prefix)
- `/docs` — Swagger UI (interactive OpenAPI) — bookmark this

---

## 2. Response Envelope

All endpoints return one of two shapes. **Always.**

### Success

```json
{
  "success": true,
  "data": { /* resource or array */ },
  "meta": { /* optional: pagination etc. */ }
}
```

### Error

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable, safe to show users",
    "details": { /* optional: field-level validation */ }
  }
}
```

**FE rule:** Never display raw error JSON. Use `error.message` for display. Use `error.code` to drive logic (redirects, retries, banners).

---

## 3. Authentication

### Token model

- **Access token** — JWT, ~15 min lifetime, sent via `Authorization: Bearer <token>` header
- **Refresh token** — HttpOnly cookie, rotated on every refresh, single-use (replayed tokens kill the session)
- **Idle timeout:** 15 minutes of inactivity
- **Absolute timeout:** 12 hours from login
- **Cookies:**
  - Tenant: `__Host-refresh_token` (HttpOnly, Secure, SameSite=Lax)
  - Tenant hint (non-HttpOnly, lets marketing site know user is logged in): `__Host-auth_hint`
  - Platform: separate cookie name for admin sessions
- **Always send `credentials: 'include'`** on `fetch()` calls to your API

### Two audiences

- `aud='tenant'` — care home staff. Mounted under `/api/v1`.
- `aud='platform'` — Zikel internal staff. Mounted under `/admin`. **Different login endpoint, different cookie, different session pool.**

Tokens from one audience are rejected by the other (`TENANT_TOKEN_REJECTED` / `PLATFORM_TOKEN_REJECTED`).

### Required headers

```
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Tenant ID is NOT sent in headers** — it's encoded in the JWT and applied automatically server-side via Prisma extensions. FE never has to think about tenant scoping. Switch tenants via `POST /auth/switch-tenant`.

### Auto-refresh strategy

When an authenticated request returns `401 UNAUTHENTICATED`:
1. Call `POST /api/v1/auth/refresh` (cookie auto-sends)
2. If it returns 200 → retry the original request with the new access token
3. If it returns 401 → fully logout, redirect to login

Use `GET /api/v1/auth/session-expiry` for countdown UIs synced to server time.

---

## 4. JWT Structure

```typescript
interface TenantJwtPayload {
  sub: string;                    // user id
  email: string;
  role: 'staff' | 'manager' | 'admin';
  tenantId: string | null;
  tenantRole: 'tenant_admin' | 'sub_admin' | 'staff' | null;
  mfaVerified: boolean;           // whether MFA passed this session
  sid?: string;                   // session id (for revocation)
  impersonatorId?: string;        // if platform staff is impersonating
  impersonationGrantId?: string;
  aud: 'tenant';
  iat: number;
  exp: number;
}
```

FE can decode (don't verify — server does that) to read `role`, `tenantRole`, `mfaVerified` for UI gating. Don't trust these for security — server re-checks on every request.

---

## 5. Error Code Catalog

Full list — `error.code` values FE may encounter.

### Authentication / token

| Code | Status | When | UX |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing/invalid Authorization header | Try `/auth/refresh` once, else logout |
| `INVALID_CREDENTIALS` | 401 | Email/password mismatch | "Email or password incorrect" |
| `ACCOUNT_LOCKED` | 403 | Locked after failed login attempts | Show lockout banner with retry-after |
| `FORBIDDEN` | 403 | Lacks generic capability | Hide action |
| `TENANT_TOKEN_REJECTED` | 401 | Tenant JWT on platform route | Restart auth flow |
| `PLATFORM_TOKEN_REJECTED` | 401 | Platform JWT on tenant route | Restart auth flow |
| `PLATFORM_ONLY` | 403 | Tenant user hitting admin route | Redirect to tenant home |

### Sessions / refresh

| Code | Status | When | UX |
|---|---|---|---|
| `NO_REFRESH_TOKEN` | 401 | Refresh attempted without token | Logout, login screen |
| `REFRESH_TOKEN_INVALID` | 401 | Malformed/expired/unknown token | Logout |
| `INVALID_REFRESH_TOKEN` | 401 | Same as above (alias) | Logout |
| `REFRESH_TOKEN_REUSED` | 401 | Single-use token replayed (security violation — entire session killed) | Logout immediately |
| `SESSION_REVOKED` | 401 | Session explicitly revoked / user deactivated | Logout |
| `SESSION_IDLE_EXPIRED` | 401 | 15 min inactivity | "Session expired" → login |
| `SESSION_ABSOLUTE_EXPIRED` | 401 | 12 h absolute timeout | "Please sign in again" |

### Tenant / membership

| Code | Status | When | UX |
|---|---|---|---|
| `TENANT_CONTEXT_REQUIRED` | 401 | Route needs tenantId, JWT has none | Prompt tenant pick / switch-tenant |
| `TENANT_ACCESS_DENIED` | 403 | User not a member of target tenant | "You don't have access" |
| `TENANT_INACTIVE` | 403 | Org suspended/cancelled by Zikel | Logout + "Contact support" |
| `TENANT_NOT_FOUND` | 404 | Bad tenantId | Generic not-found |
| `USER_NOT_FOUND` | 404 | Bad userId | Generic not-found |

### Capability / MFA

| Code | Status | When | UX |
|---|---|---|---|
| `PERMISSION_DENIED` | 403 | User's role lacks permission | Hide / disable the button |
| `MFA_REQUIRED` | 401 | TOTP needed before access | Show MFA challenge UI |
| `MFA_NOT_FOUND` | 404 | No MFA credential enrolled | Send to enrollment |
| `MFA_ALREADY_CONFIRMED` | 409 | Tried to re-enroll | "Already enrolled" |
| `MFA_CODE_INVALID` | 401 | Wrong TOTP code | "Code incorrect" + retry |
| `MFA_BACKUP_INVALID` | 401 | Wrong/used backup code | "Code incorrect or used" |
| `MFA_CHALLENGE_INVALID` | 401 | Challenge token expired (5 min) | Restart login |
| `MFA_CHALLENGE_AUDIENCE` | 401 | Wrong-audience challenge | Restart login |

### Validation / data

| Code | Status | When | UX |
|---|---|---|---|
| `VALIDATION_ERROR` | 422 | Zod schema failed | Map `error.details` onto form fields |
| `OTP_INVALID` | 400 | Wrong/expired/used OTP code | "Code incorrect" + offer resend |

### Subscription / billing

| Code | Status | When | UX |
|---|---|---|---|
| `SUBSCRIPTION_PAST_DUE` | 402 | Status = `past_due_readonly` blocking write | Red banner + redirect to billing |
| `SUBSCRIPTION_INCOMPLETE` | 402 | Status = `incomplete` blocking write | "Complete payment" CTA |
| `SUBSCRIPTION_REQUIRED` | 409 | Top-up attempted with no active sub | "Subscribe first" CTA |
| `BILLING_NOT_CONFIGURED` | 503 | Stripe unconfigured (dev/test) | Hide billing UI in this env |

### Impersonation

| Code | Status | When | UX |
|---|---|---|---|
| `IMPERSONATION_ACTIVE` | 409 | Cannot perform op while impersonating | Banner: "Impersonating — end session first" |
| `IMPERSONATION_REVOKED` | 401 | Grant was revoked mid-session | End impersonation, return to platform |
| `INVALID_DURATION` | 422 | Duration outside 5–240 minutes | Show range hint |

### Rate limit

| Code | Status | When | UX |
|---|---|---|---|
| `RATE_LIMIT_EXCEEDED` | 429 | Bucket exhausted | Toast + back off. Headers tell you when (see §7). |

---

## 6. Permission Catalog

Used by `requirePermission(P.XXX)` middleware. FE can request `GET /api/v1/me/permissions` for a derived summary, or decode role and check capabilities client-side.

| Permission | Description |
|---|---|
| **Employees** | |
| `employees:read` | View employee list and profiles |
| `employees:write` | Create or update employee records |
| `employees:deactivate` | Soft-delete / deactivate employees |
| `employees:invite` | Send staff onboarding invitations |
| **Homes** | |
| `homes:read` | View homes |
| `homes:write` | Create / update homes, events, shifts |
| **Care Groups** | |
| `care_groups:read` | View care groups |
| `care_groups:write` | Create / update care groups |
| **Young People** | |
| `young_people:read` | View resident records |
| `young_people:write` | Create / update resident records |
| `young_people:sensitive_read` | View confidential / restricted fields |
| **Tasks / Care logs** | |
| `tasks:read` / `tasks:write` / `tasks:approve` | View / edit / approve |
| `care_logs:read` / `care_logs:write` | View / edit daily logs |
| **Safeguarding** | |
| `safeguarding:read` / `safeguarding:write` / `safeguarding:escalate` | View / edit / acknowledge alerts |
| **Reports** | |
| `reports:read` / `reports:export` | View / export |
| **Audit** | |
| `audit:read` | View audit logs |
| **Settings** | |
| `settings:read` / `settings:write` | View / edit tenant settings |
| **Members & roles** | |
| `members:read` / `members:write` | Invite/role-change/suspend |
| `roles:read` / `roles:write` | View / manage custom roles |
| **Billing** ⭐ | |
| `billing:read` | View subscription, plans, quota, invoices |
| `billing:write` | Subscribe, cancel, top-up, manage restrictions (Owner only) |
| **AI** ⭐ | |
| `ai:use` | Use AI assistant |
| `ai:admin` | Set AI access for staff |
| **Other** | |
| `announcements:read` / `announcements:write` | View / create announcements |
| `vehicles:read` / `vehicles:write` | View / edit vehicles |
| `help_center:admin` | Manage FAQ articles, tickets |

---

## 7. Conventions

### Pagination

**Request:** `?page=1&pageSize=20`
**Response:**

```json
{
  "data": [ /* items */ ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 142,
    "totalPages": 8,
    "hasMore": true
  }
}
```

Default `pageSize` varies (20 most, 50 audit, 100 max usually). Always provide `page` and `pageSize` explicitly to avoid surprises.

### Rate limits

Selected limits FE should know about (per IP unless noted):

| Endpoint pattern | Limit |
|---|---|
| `/auth/login` | 10 / min |
| `/auth/register` | 5 / min |
| `/auth/resend-otp`, `/auth/forgot-password`, `/auth/reset-password` | 5 / min |
| `/auth/refresh` | 20 / min |
| `/auth/mfa/totp/verify`, `/auth/mfa/totp/enroll/confirm` | 10 / min |
| `/auth/mfa/backup/verify` | 5 / 5 min |
| `/auth/mfa/totp/setup`, `/auth/mfa/totp/enroll/setup` | 5 / min |
| `/auth/mfa/totp DELETE` | 5 / 5 min |
| `/me/change-password` | 5 / min |
| `/billing/checkout-session`, `/billing/topup-checkout-session` | 10 / 5 min |
| `/billing/portal-session` | 30 / 5 min |
| `/billing/cancel` | 5 / 5 min |
| `/ai/ask` | 20 / min |
| `/ai/conversations/*` mutations | 30 / min |
| `/admin/auth/login` | 10 / min |
| Public forms (`/public/*`) | 10 / 10 min |
| Tenant suspend / reactivate / impersonate | 10 / 5 min |
| Admin billing override | 30 / 5 min |
| Broadcast notifications | 10 / 5 min |

**When hit:**

```
HTTP/2 429
x-ratelimit-limit: 30
x-ratelimit-remaining: 0
x-ratelimit-reset: 27        ← seconds until the bucket refills (primary, integer)
retry-after: 27              ← same value in seconds (HTTP standard, fallback)
{
  "success": false,
  "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "..." }
}
```

**FE rule:** read `x-ratelimit-reset` first; fall back to `retry-after` if absent. Both are always present on this stack but `retry-after` is the standard header — use it for any generic HTTP client / library defaults.

### File uploads

Two-step signed-URL flow:

1. `POST /api/v1/uploads/sessions` with `{ fileName, contentType, sizeBytes, purpose, checksumSha256? }`
   → returns `{ file, upload: { method: 'PUT', url, expiresAt, headers } }`
2. PUT the file body directly to `upload.url` (S3) with the headers provided.
3. `POST /api/v1/uploads/:id/complete` to confirm.

Use the returned `file.id` as the reference in subsequent resource creates (`avatarFileId`, `signatureFileId`, etc.).

### File downloads

Exports return raw file bodies with:

```
Content-Type: application/pdf  |  application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="employees_2026-05-10T14-30-45.xlsx"
```

**Don't `.json()` these** — use `.blob()` and trigger a download:

```js
const blob = await response.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url; a.download = filenameFromHeader; a.click();
```

### CORS

Server-side allowlist. If FE is on a new domain, ask BE to add it. Local dev (`http://localhost:*`) is typically allowed.

---

## 8. Subscription State Machine

This is the most important new concept for the redesign.

### Status values

| Status | Mutations | AI / Exports | Read | UX |
|---|---|---|---|---|
| `trialing` | ✅ | ✅ | ✅ | Banner: "X days left in trial" |
| `active` | ✅ | ✅ | ✅ | No banner |
| `past_due_grace` | ✅ | ✅ | ✅ | Yellow banner: "Payment failed. Update card." |
| `past_due_readonly` | ❌ 402 | ❌ 402 | ✅ | Red banner. Mutations return `SUBSCRIPTION_PAST_DUE`. |
| `incomplete` | ❌ 402 | ❌ 402 | ✅ | "Complete payment" CTA. Returns `SUBSCRIPTION_INCOMPLETE`. |
| `suspended` | — | — | ❌ | Login blocked. "Contact support". |
| `cancelled` | — | — | ❌ | Login blocked. "Contact support". |

### Timeline after payment failure

```
Day 0:  pastDueSince stamped
        Stripe: customer.subscription.updated (status='past_due')
        Local status: past_due_grace
        Full access, yellow banner

Day 3:  Cron promotes status
        → past_due_readonly
        → Mutations + AI/exports return 402

Day 14: Cron promotes status
        → suspended
        → Tenant.isActive = false
        → User cannot log in

Payment received at any point:
        Stripe: invoice.paid
        → status = 'active', pastDueSince cleared
        → Full access restored immediately
```

### `manuallyOverriddenUntil`

Platform admins can override the gate for support escalations:

```json
{ "manuallyOverriddenUntil": "2026-05-20T00:00:00Z" }
```

While this timestamp is in the future, the user has full access regardless of subscription status. Impersonation tokens also bypass the gate.

### UI flags (use these, not `status` strings)

`GET /api/v1/billing/subscription` returns pre-computed flags. Drive your banner / read-only logic from these:

```typescript
ui: {
  isInTrial: boolean;
  daysLeftInTrial: number | null;
  isReadOnly: boolean;      // past_due_readonly OR incomplete
  isSuspended: boolean;
  isCancelled: boolean;
  pastDueSinceDays: number | null;
}
```

---

# Module Reference

Notation:

- 🔓 = no auth required (public)
- 🔒 = JWT required
- 🔐 = JWT + MFA required (privileged routes)
- 💳 = subscription gate active (mutations blocked when past-due readonly / incomplete)
- 📛 = permission name (from §6) required

---

## M1 — Public

**Base:** `/api/v1/public` · 🔓 all routes · 10/10min rate limit

### POST /public/book-demo
Marketing form: demo request.

**Body:**
```typescript
{
  // required
  fullName: string;                          // 1–150
  email: string;                             // valid email
  serviceOfInterest: 'care_documentation_platform' | 'ai_staff_guidance'
                   | 'training_development' | 'healthcare_workflow' | 'general_enquiry';
  // optional
  organisationName?: string;                 // max 150
  rolePosition?: string;                     // max 150
  phoneNumber?: string;                      // 7–30
  numberOfStaffChildren?: string;            // max 50
  keyChallenges?: string;                    // max 2000
  message?: string;                          // max 2000
  source?: string;                           // max 100
}
```
**201:** `{ success, data: { id, message } }`

### POST /public/join-waitlist
**Body:** `{ fullName, email, serviceOfInterest, organisation?, source? }`
**201:** `{ success, data: { id, message } }`

### POST /public/contact-us
**Body:** `{ fullName, email, phoneNumber, serviceOfInterest, message?, source? }`
**201:** `{ success, data: { id, message } }`

---

## M2 — Auth

**Base:** `/api/v1/auth`

### POST /auth/register · 🔓 · 5/min
Care-home-first onboarding (Owner registers their org).

**Body:**
```typescript
{
  // required
  country: 'UK' | 'Nigeria';
  firstName: string;           // 1–100
  lastName: string;            // 1–100
  email: string;
  password: string;            // 12+ chars: uppercase, lowercase, number, special, no spaces
  confirmPassword: string;     // must match password
  acceptTerms: true;
  organizationName: string;    // 2–120
  // optional
  middleName?: string;
  gender?: 'male' | 'female' | 'other';
  phoneNumber?: string;        // 7–20
  organizationSlug?: string;   // ^[a-z0-9]+(?:-[a-z0-9]+)*$
}
```
**201:** `{ userId, message, otpDeliveryStatus, resendAvailableAt }`
**Errors:** `409 VALIDATION_ERROR` (email taken), `422 VALIDATION_ERROR`

### GET /auth/check-email?email=... · 🔓 · 20/min
Privacy-safe availability check.
**200:** `{ available: boolean }`

### POST /auth/verify-otp · 🔓 · 10/min
Verify email OTP, activate account, mint session.

**Body (modern):** `{ email, code }`
**Body (legacy):** `{ userId, code, purpose?: 'email_verification' }`

**200 (AuthResponse):**
```typescript
{
  user: User;
  session: {
    activeTenantId: string | null;
    activeTenantRole: 'tenant_admin' | 'sub_admin' | 'staff' | null;
    memberships: unknown[];
    mfaRequired: boolean;
    mfaVerified: boolean;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
    warningWindowSeconds: number;
  };
  tokens: {
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshTokenExpiresAt: string;
    refreshToken?: string;   // only if AUTH_LEGACY_REFRESH_TOKEN_IN_BODY=true
  };
  serverTime: string;
}
```
Sets cookies: `__Host-refresh_token`, `__Host-auth_hint`.

### POST /auth/resend-otp · 🔓 · 5/min
**Body (modern):** `{ email, purpose? }`
**Body (legacy):** `{ userId, purpose: 'email_verification' | 'password_reset' }`
**200:** `{ message, cooldownSeconds, otpDeliveryStatus, resendAvailableAt }`

### POST /auth/login · 🔓 · 10/min
Three possible 200 responses (discriminated union):

**A) Direct success (no MFA):** AuthResponse (as in verify-otp)

**B) MFA required (TOTP enrolled):**
```typescript
{ mfaRequired: true, challengeToken: string, challengeExpiresInSeconds: number }
```
Next: POST `/auth/mfa/totp/verify` with `{ challengeToken, code }` (or `/backup/verify`).

**C) MFA enrollment required (Owner without TOTP):**
```typescript
{ mfaEnrollmentRequired: true, enrollmentToken: string, enrollmentExpiresInSeconds: number }
```
Next: POST `/auth/mfa/totp/enroll/setup` → display QR → POST `/auth/mfa/totp/enroll/confirm`.

### POST /auth/refresh · 🔓 · 20/min
Body forms: `{ refreshToken }`, `{ token }`, or empty (uses cookie).
**200:** Same shape as verify-otp.
**Key:** single-use rotation. If a token is replayed, the entire session is killed (returns `REFRESH_TOKEN_REUSED`).

### GET /auth/session-expiry · 🔒
Sync FE countdown timer with server time.
**200:** `{ serverTime, session: { idleExpiresAt, absoluteExpiresAt, warningWindowSeconds }, tokens: { refreshTokenExpiresAt } }`

### POST /auth/switch-tenant · 🔒
**Body:** `{ tenantId: string }`
**200:** New AuthResponse with new accessToken carrying updated tenant claims.
**Errors:** `403 TENANT_ACCESS_DENIED`

### POST /auth/logout · 🔒
Clears the current refresh token + cookies. Other devices unaffected.
**Body forms:** `{ refreshToken }`, `{ token }`, or empty (uses cookie).
**200:** `{ message }`

### GET /auth/sessions · 🔒
**200:** Array of `{ id, createdAt, expiresAt, isCurrent, ... }`

### DELETE /auth/sessions/:id · 🔒
**200:** `{ revoked: number }`

### DELETE /auth/sessions · 🔒
Logout everywhere. **200:** `{ revoked: number }`

### POST /auth/forgot-password · 🔓 · 5/min
**Body:** `{ email }`
**200:** `{ message }` (generic — no enumeration)

### POST /auth/reset-password · 🔓 · 5/min
**Body:** `{ email, code, newPassword, confirmPassword }`
**200:** `{ message }`
**Side effect:** all refresh tokens revoked (forces re-login).

### GET /auth/me · 🔒
**200:** User object from JWT.

---

## M3 — MFA

**Base:** `/api/v1/auth/mfa`

### POST /auth/mfa/totp/verify · 🔓 · 10/min
**Body:** `{ challengeToken, code }` (6 digits)
**200:** AuthResponse with `session.mfaVerified=true`.

### POST /auth/mfa/backup/verify · 🔓 · 5/5min
**Body:** `{ challengeToken, code }` (8–20 chars, single-use)
**200:** AuthResponse.

### POST /auth/mfa/totp/enroll/setup · 🔓 · 5/min
**Body:** `{ enrollmentToken }`
**200:** `{ qrCodeDataUri, otpAuthUri, backupCodes: string[] }`
**Errors:** `409 MFA_ALREADY_CONFIRMED`

### POST /auth/mfa/totp/enroll/confirm · 🔓 · 10/min
**Body:** `{ enrollmentToken, code }`
**200:** AuthResponse.

### GET /auth/mfa/status · 🔒
**200:** `{ enabled: boolean, backupCodesRemaining: number }`

### POST /auth/mfa/totp/setup · 🔒 · 5/min
Authenticated re-enrollment.
**200:** `{ qrCodeDataUri, otpAuthUri, backupCodes }`

### POST /auth/mfa/totp/verify-setup · 🔒 · 10/min
**Body:** `{ code }`
**200:** `{ enrolled: boolean }`

### DELETE /auth/mfa/totp · 🔒 · 5/5min
**Body:** `{ currentPassword }`
**200:** `{ disabled: true }`

---

## M4 — Invitations

**Base:** `/api/v1/invitations` (authenticated) and `/api/v1/auth/invitations` (public)

### GET /invitations · 🔒 📛 `members:read`
**Query:** `page, pageSize, status?: 'pending'|'accepted'|'revoked'|'expired'|'all'`
**200:** Paginated invitations.

### POST /invitations · 🔒 📛 `members:write` · 30/min
**Body:**
```typescript
{
  email: string;             // max 254
  roleId: string;
  homeId?: string;
  expiresInHours?: number;   // 1–720, default 168 (7 days)
}
```
**201:** `{ invitation, inviteLink }` — link format `/invitations/{token}`.

### DELETE /invitations/:id · 🔒 📛 `members:write`
**200:** `{ revoked: true }`

### POST /invitations/:id/resend · 🔒 📛 `members:write` · 5/min
**Body (optional):** `{ expiresInHours? }`
**200:** `{ invitation, inviteLink }` with refreshed token.

### GET /auth/invitations/:token · 🔓 · 30/min
Preview invitation.
**200:** `{ tenant: { id, name, slug }, email, role: { id, name }, home: { id, name } | null, expiresAt }`

### POST /auth/invitations/:token/accept · 🔓 · 5/min
**Body:** `{ firstName, lastName, password? }`
**200:** `{ userId, tenantId, message }`

---

## M5 — Me

**Base:** `/api/v1/me` · 🔒

### GET /me
**200:** Full user profile including `aiAccessEnabled`, `language`, `timezone`, `lastLoginAt`.

### PATCH /me
**Body (at least one):** `{ firstName?, lastName?, phone?, avatar? }`
**200:** Updated profile.

### POST /me/change-password · 5/min
**Body:** `{ currentPassword, newPassword, confirmPassword }`
**Side effect:** all refresh tokens revoked.

### GET /me/permissions
**200:** Derived capability flags: `{ canViewAllHomes, canViewAllYoungPeople, canViewAllEmployees, canApproveIOILogs, canManageUsers, canManageSettings, canViewReports, canExportData }`
Use these to gate UI elements.

### GET /me/preferences · PATCH /me/preferences
**200 / Body:** `{ language, timezone }`

---

## M6 — Tenants

**Base:** `/api/v1/tenants` · 🔐 💳

### GET /tenants/:id/memberships
**Query:** `page, pageSize, role?, status?: invited|active|suspended|revoked, search?`
**200:** Paginated `[{ id, userId, tenantId, role, status, createdAt, user? }]`

### POST /tenants/:id/memberships
**Body:** `{ userId? | email?, role: 'tenant_admin'|'sub_admin'|'staff', status? }`
**201:** Membership object.

### PATCH /tenants/:id/memberships/:membershipId
**Body:** `{ role?, status? }`
**200:** Updated membership.

### POST /tenants/:id/staff · 20/min
Admin-driven provisioning — creates user + sends activation email.
**Body:** `{ firstName, lastName, email, role?: 'sub_admin'|'staff' }`
**201:** `{ user, membership, tenantName }`

### POST /tenants/:id/invite-links
Reusable invite link (vs single-use invitation).
**Body:** `{ defaultRole?, expiresInHours? }`
**201:** `{ id, tenantId, tenantName, code, defaultRole, isActive, expiresAt, createdAt }`

### GET /tenants/:id/invite-links
**200:** Array of invite links.

### PATCH /tenants/:id/invite-links/:linkId/revoke
**200:** `{ id, isActive: false }`

### GET /tenants/:id/invites
**Query:** `page, pageSize, status?`
**200:** Paginated invites.

### POST /tenants/:id/invites
**Body:** `{ email, role, expiresInHours? }`
**201:** `{ invite, inviteToken }`

### PATCH /tenants/:id/invites/:inviteId/revoke
**200:** Invite with `status='revoked'`.

### POST /tenants/invites/accept
**Body:** `{ token }`
**200:** `{ membership, invite }`

---

## M7 — Billing ⭐ (NEW Phase 7)

**Base:** `/api/v1/billing` · 🔐

The biggest new surface. Stripe-backed subscriptions + AI quota.

### GET /billing/subscription · 📛 `billing:read`

**200:**
```typescript
{
  status: 'trialing' | 'active' | 'past_due_grace' | 'past_due_readonly'
        | 'incomplete' | 'suspended' | 'cancelled';
  plan: {
    code: 'standard_monthly' | 'standard_annual';
    name: string;
    interval: 'month' | 'year';
    unitAmountMinor: number;      // pence; £30.00 = 3000
    currency: 'gbp';
    bundledCallsPerPeriod: number;
  } | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  manuallyOverriddenUntil: string | null;
  // Pre-computed UI flags — USE THESE for banners/gating
  ui: {
    isInTrial: boolean;
    daysLeftInTrial: number | null;
    isReadOnly: boolean;
    isSuspended: boolean;
    isCancelled: boolean;
    pastDueSinceDays: number | null;
  };
}
```

### GET /billing/plans · 📛 `billing:read`

**200:**
```typescript
{
  plans: [
    { code: 'standard_monthly', name, interval: 'month', unitAmountMinor: 3000,  currency: 'gbp', bundledCallsPerPeriod: 1000 },
    { code: 'standard_annual',  name, interval: 'year',  unitAmountMinor: 30000, currency: 'gbp', bundledCallsPerPeriod: 1000 }
  ],
  topUpPacks: [
    { code: 'topup_small',  name, unitAmountMinor: 500,  currency: 'gbp', calls: 250 },
    { code: 'topup_medium', name, unitAmountMinor: 1500, currency: 'gbp', calls: 1000 },
    { code: 'topup_large',  name, unitAmountMinor: 4000, currency: 'gbp', calls: 5000 }
  ]
}
```

### GET /billing/quota · 📛 `billing:read`

**200:**
```typescript
{
  allocationId: string;
  bundledCalls: number;         // from current plan
  topUpCalls: number;           // cumulative top-ups this period
  usedCalls: number;
  remainingCalls: number;       // bundled + topUp − used
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  perUserUsage: [
    { userId, name, email, role, callsThisPeriod }
  ];
  restrictions: {
    perRoleCaps: { [roleName: string]: number | null };  // null=uncapped, 0=disabled
    perUserCaps: { [userId: string]: number | null };
  };
}
```

### POST /billing/checkout-session · 📛 `billing:write` · 10/5min
**Body:** `{ planCode: 'standard_monthly' | 'standard_annual' }`
**200:** `{ url, expiresAt }` — redirect browser to `url`.
**Returns to:** `BILLING_CHECKOUT_SUCCESS_URL` / `BILLING_CHECKOUT_CANCEL_URL` (server-side env). FE handles the success page — show confirmation and re-fetch `/billing/subscription`.
**Errors:** `503 BILLING_NOT_CONFIGURED`

### POST /billing/portal-session · 📛 `billing:write` · 30/5min
**Body:** none
**200:** `{ url }` — Stripe Customer Portal (update card, view invoices, cancel).

### POST /billing/topup-checkout-session · 📛 `billing:write` · 10/5min
**Body:** `{ packCode: 'topup_small' | 'topup_medium' | 'topup_large' }`
**200:** `{ url, expiresAt }`
**Errors:** `409 SUBSCRIPTION_REQUIRED` (must have active sub first)

### POST /billing/cancel · 📛 `billing:write` · 5/5min
**Body:** none
**200:** `{ cancelAtPeriodEnd: true, currentPeriodEnd }` — access keeps until period end.

### GET /billing/invoices · 📛 `billing:read`
**Query:** `page, pageSize` (max 100)
**200:** Paginated `[{ id, stripeInvoiceId, amountDueMinor, amountPaidMinor, currency, status: 'draft'|'open'|'paid'|'void'|'uncollectible', hostedInvoiceUrl, pdfUrl, periodStart, periodEnd, paidAt, createdAt }]`

### GET /billing/ai-restrictions · 📛 `billing:read`
**200:** `{ perRoleCaps, perUserCaps, updatedAt }`

### PUT /billing/ai-restrictions · 📛 `billing:write`
**Body (at least one):**
```typescript
{
  perRoleCaps?: { [role: string]: number | null };   // 0–100,000
  perUserCaps?: { [userId: string]: number | null };
}
```
**200:** Updated restrictions.

**Cap semantics (IMPORTANT — different at each level):**

| Value | In `perRoleCaps` | In `perUserCaps` |
|---|---|---|
| `0` | AI disabled for the role → `403 AI_DISABLED_FOR_ROLE` | AI disabled for the user → `403 AI_DISABLED_FOR_USER` |
| positive int (1–100,000) | Monthly call limit for the role | Monthly call limit for the user |
| `null` or absent | **Uncapped** — pool quota only | **Fall back to the user's role cap** (NOT uncapped) |

The per-user cap **overrides** the role cap. So to give one user unlimited access while their role is capped, you currently can't — set a high explicit number (e.g. 100,000). To disable a user inside an uncapped role, set their per-user cap to `0`.

**Server-side filtering:** any `perUserCaps` keys not matching an active tenant membership are silently dropped on PUT (so a typo'd userId won't poison the JSON). FE should source the userId from `GET /tenants/:id/memberships`.

---

## M8 — AI ⭐

**Base:** `/api/v1/ai` · 🔐 💳 · 20/min

### POST /ai/ask
Page-aware structured AI cards (dashboard widgets). **Debits 1 quota call** even on fallback.

**Body:**
```typescript
{
  query: string;     // 3–1200 chars
  page: 'summary' | 'tasks' | 'daily_logs' | 'care_groups' | 'homes'
      | 'young_people' | 'employees' | 'vehicles' | 'form_designer'
      | 'users' | 'audit';                        // default 'summary'
  displayMode?: 'auto' | 'standard' | 'minimal';  // default 'auto'
  context?: {
    // For summary page:
    stats?: { overdue?, dueToday?, pendingApproval?, rejected?, draft?, future?, comments?, rewards? };
    todos?: { title, status?, priority?, dueDate? }[];        // max 10
    tasksToApprove?: { title, status?, priority?, dueDate? }[]; // max 10
    // For all other pages:
    items?: { id?, title, status?, priority?, category?, type?, dueDate?, assignee?, home?, extra? }[]; // max 25
    filters?: { [key: string]: string };
    meta?: { total?, page?, pageSize?, totalPages? };
  };
}
```

**200:**
```typescript
{
  message: string;                               // main chat bubble
  highlights: {
    title: string;
    reason: string;
    urgency: 'low' | 'medium' | 'high' | 'critical';
    action: string;
  }[];
  tip: string | null;
  actions: { label: string; action: string }[]; // quick-action buttons
  source: 'model' | 'fallback';
  generatedAt: string;
  meta: {
    model: string | null;
    page: string;
    strengthProfile: 'owner' | 'admin' | 'staff';
    responseMode: 'comprehensive' | 'balanced' | 'focused';
    statsSource: 'client' | 'server' | 'none';
    languageSafetyPassed: boolean;
  };
}
```

**Errors:** `402 SUBSCRIPTION_PAST_DUE` (quota or sub gate)

---

## M9 — AI Conversations ⭐ (NEW Phase 8)

**Base:** `/api/v1/ai/conversations` · 🔐 (reads pass-through on 💳; writes gated) · 30/min

No streaming — full response in one chunk on `POST .../messages`. History window 20 messages server-side.

### POST /ai/conversations
**Body:** none
**201:** `{ id, title: null, archivedAt: null, createdAt, updatedAt }` (no messages yet)

### GET /ai/conversations
**Query:** `page (1+), pageSize (1–50, default 20), includeArchived (default false)`
**200:** Paginated, ordered by `updatedAt DESC`.

### GET /ai/conversations/:id
**200:**
```typescript
{
  id, title, archivedAt, createdAt, updatedAt,
  messages: { id, role: 'user' | 'assistant', content, fallbackUsed?, createdAt }[]
}
```

### POST /ai/conversations/:id/messages
**Body:** `{ content: string }` (1–8000 chars)
**200:** `{ assistantMessage: { id, role: 'assistant', content, fallbackUsed, createdAt } }`
**Errors:** `409 CONVERSATION_ARCHIVED`, `402 SUBSCRIPTION_PAST_DUE`

**Quota:** debited *after* model responds. Pre-flight check rejects before persist if pool exhausted. Title auto-generates after ~3 exchanges (best-effort, fire-and-forget).

### PATCH /ai/conversations/:id
**Body (at least one):** `{ title?: string|null (1–120), archived?: boolean }`
**200:** Updated conversation.

### DELETE /ai/conversations/:id
**200:** `{ deleted: true }` — **hard delete, no recovery.**

---

## M10 — Homes

**Base:** `/api/v1/homes` · 🔐 💳

### GET /homes
**Query:** `page, pageSize (max 500), search?, careGroupId?, status?: 'current'|'past'|'planned'|'all' (default 'all'), isActive?`
**200:** Paginated `[{ id, careGroupId, careGroupName, name, address, capacity, isActive, createdAt, updatedAt }]`

### GET /homes/export
**Query:** as above + `format: 'pdf'|'excel'`, `pageSize` max 5000
**200:** Binary file. Columns: Name, Address, Region, Capacity, Status, Category, Care Group, Ofsted URN.

### GET /homes/:id
**200:** Full home with `description, postCode, category, region, status, phoneNumber, email, avatarUrl, adminUser, personInCharge, responsibleIndividual, startDate, endDate, isSecure, shortTermStays, minAgeGroup, maxAgeGroup, ofstedUrn, compliance, details, ...`

### POST /homes · 📛 `homes:write`
**Body (required):** `{ careGroupId, name (1–150) }`
**Body (optional):** `description, address, postCode, capacity (1–1000), category, region, status, phoneNumber, email, avatarFileId, avatarUrl, adminUserId, personInChargeId, responsibleIndividualId, startDate, endDate, isSecure, shortTermStays, minAgeGroup (0–25), maxAgeGroup (0–25), ofstedUrn, compliance, details`
**201:** Full home.

### PATCH /homes/:id · 📛 `homes:write`
All fields optional. `isActive` can be true to re-activate.

### DELETE /homes/:id · 📛 `homes:write`
Soft-delete (`isActive=false`). **200:** `{ message: 'Home deactivated.' }`

### Sub-resources (all 🔐)
- `GET /homes/:id/summary` → `{ id, name, youngPeople[], employees[], vehicles[], events[], shifts[], taskStats: { total, pending, completed, overdue } }`
- `GET /homes/:id/young-people` (paginated)
- `GET /homes/:id/employees` (paginated)
- `GET /homes/:id/vehicles` (paginated)
- `GET /homes/:id/tasks` (paginated)
- `GET /homes/:id/events` (paginated) + `POST/PATCH/DELETE /homes/:id/events[/:eventId]` (📛 `homes:write`)
- `GET /homes/:id/shifts` + `POST/PATCH/DELETE /homes/:id/shifts[/:shiftId]` (📛 `homes:write`)
- `GET /homes/:id/reports/daily-audit?date=`
- `GET /homes/:id/reports/employee-stats`
- `GET /homes/:id/reports/statistics`
- `GET /homes/:id/reports/access` (paginated)
- `GET /homes/:id/reports/weekly-record?startDate=&endDate=`
- `GET /homes/:id/reports/monthly-record?startDate=&endDate=`

---

## M11 — Employees

**Base:** `/api/v1/employees` · 🔐 💳

### GET /employees
**Query:** `page, pageSize, search?, homeId?, status?, roleId?, isActive?`
**200:** Paginated employees with nested `user`, `home`, `roleName`, `jobTitle`, `status`, `contractType`, `dbsNumber`, `dbsDate`, `startDate`, `endDate`.

### GET /employees/export
**Query:** as list + `format`. Columns: Name, Email, Job Title, Role, Home, Status, Contract, DBS Number.

### GET /employees/:id · POST /employees · PATCH /employees/:id
**Body:**
```typescript
{
  userId: string;       // required on create
  homeId?: string;
  roleId?: string;
  jobTitle?: string;    // max 150
  startDate?: string | null;
  endDate?: string | null;
  status?: 'current' | 'past' | 'planned';   // default 'current'
  contractType?: string;
  dbsNumber?: string;
  dbsDate?: string | null;
  qualifications?: object;
  isActive?: boolean;
}
```
📛 `employees:write` for create/update.

### DELETE /employees/:id · 📛 `employees:deactivate`
Soft-delete.

---

## M12 — Young People

**Base:** `/api/v1/young-people` · 🔐 💳

### GET /young-people
**Query:** `page, pageSize, search?, homeId?, status?, gender?, type?, isActive?`
**200:** Paginated residents.

Full record includes: `firstName, lastName, preferredName, namePronunciation, dateOfBirth, gender, ethnicity, religion, referenceNo, niNumber, roomNumber, status, type, admissionDate, placementEndDate, avatarUrl, keyWorkerId, keyWorker, practiceManagerId, adminUserId, socialWorkerName, independentReviewingOfficer, placingAuthority, legalStatus, isEmergencyPlacement, isAsylumSeeker, contact, health, education, isActive`

### POST /young-people · PATCH /young-people/:id · 📛 `young_people:write`
**Required on create:** `homeId, firstName, lastName`

### GET /young-people/export
Columns: Ref, Name, Date of Birth, Gender, Home, Status, Key Worker, Placing Authority, Admission Date.

### DELETE /young-people/:id · 📛 `young_people:write`
Soft-delete.

**Note:** restricted fields gated by `young_people:sensitive_read`.

---

## M13 — Vehicles

**Base:** `/api/v1/vehicles` · 🔐 💳

### GET /vehicles
**Query:** `page, pageSize (max 500), search?, homeId?, status?, fuelType?, isActive?, sortBy?: 'registration'|'make'|'model'|'nextServiceDue'|'motDue'|'createdAt'|'updatedAt', sortOrder?`

Full record: `registration, make, model, year (1900–2100), colour, description, status, vin, registrationDate, taxDate, fuelType, insuranceDate, ownership, leaseStartDate, leaseEndDate, purchasePrice, purchaseDate, startDate, endDate, mileage (0–9,999,999), nextServiceDue, motDue, avatarUrl`

### POST /vehicles · PATCH /vehicles/:id · 📛 `vehicles:write`
Required on create: `registration (1–32)`.

### DELETE /vehicles/:id · 📛 `vehicles:write`
Soft-delete.

### GET /vehicles/export
Columns: Registration, Make, Model, Year, Status, Fuel, Ownership, MOT Due, Next Service.

---

## M14 — Tasks

**Base:** `/api/v1/tasks` · 🔐 💳

### GET /tasks · 📛 `tasks:read`
**Query:** `page, pageSize, search?, homeId?, assigneeId?, status?: pending|in_progress|completed|cancelled, priority?: low|medium|high|urgent, category?, scope?, dateFrom?, dateTo?, sortBy?, sortOrder?`
**200:** Paginated tasks with `taskRef, formGroup, lifecycleStatusLabel, approvalStatus: 'not_required'|'pending_approval'|'approved'|'rejected'|'processing', home, relatedEntity, assignee, submittedAt, dueAt, completedAt, references[], attachments[]`. Also returns `labels: { status, priority, category }` for rendering.

### GET /tasks/export
Columns: ID, Title, Form Group, Status, Priority, Relates To, Assignee, Task Date.

### GET /tasks/categories
**200:** `[{ value, label, types? }]`

### GET /tasks/form-templates
**200:** `[{ slug, label, category, formGroup }]`

### GET /tasks/:id · 📛 `tasks:read`
Full task.

### POST /tasks/:id/actions · 📛 `tasks:write`
**Body:** `{ action: string, payload?: object }` — valid actions depend on lifecycle (submit, approve, reject, complete, cancel, etc.)

### POST /tasks · 📛 `tasks:write`
**Body (required):** `title (1–200), category: 'task_log'|'document'|'system_link'|'checklist'|'incident'|'other'|'daily_log'|'reward'`
**Body (optional):** `description, priority (default 'medium'), homeId, relatedEntityType: 'tenant'|'care_group'|'home'|'young_person'|'vehicle'|'employee'|'task', relatedEntityId, assigneeId, dueAt, status (default 'pending'), approvalRequired, references, attachments`

### POST /tasks/batch-archive
**Body:** `{ taskIds: string[] }`
**200:** `{ processed, failed: [{ id, reason }] }`

### POST /tasks/batch-postpone · POST /tasks/:id/postpone
**Body:** `{ taskIds?, newDueDate }`

### POST /tasks/batch-reassign
**Body:** `{ taskIds, newAssigneeId | null }`

### PATCH /tasks/:id · DELETE /tasks/:id
Update / archive.

---

## M15 — Daily Logs

**Base:** `/api/v1/daily-logs` · 🔐 💳

### GET /daily-logs
**Query:** `page, pageSize, homeId?, youngPersonId?, vehicleId?, dateFrom?, dateTo?, search?, sortBy?: createdAt|dueAt|title, sortOrder?`

### POST /daily-logs · 📛 `care_logs:write`
**Body:**
```typescript
{
  homeId: string;                                                          // required
  relatesTo?: { type: 'young_person'|'vehicle'|'employee'|'home_event'; id: string } | null;
  noteDate: string;                                                        // required ISO 8601
  category: string;                                                        // 1–120
  note: string;                                                            // 1–10000
  triggerTaskFormKey?: string;                                             // max 120
}
```

### GET/PATCH/DELETE /daily-logs/:id — **DELETE is hard-delete.**

---

## M16 — Care Groups

**Base:** `/api/v1/care-groups` · 🔐 💳

### GET /care-groups · GET /:id
Standard list + detail.

### POST · PATCH · 📛 `care_groups:write`
**Body:** `name (1–150), description?, type?, managerName?, contactName?, phoneNumber?, email?, fax?, website?, addressLine1?, addressLine2?, city?, county?, postcode?, country?`

### DELETE · 📛 `care_groups:write`
Soft-delete.

---

## M17 — Documents

**Base:** `/api/v1/documents` · 🔐 💳

### GET /documents
**Query:** `page, pageSize, search?, category?, homeId?, uploadedBy?, dateFrom?, dateTo?, sortBy?, sortOrder?`
**200:** Documents with nested `file: { id, fileName, contentType, sizeBytes, uploadStatus }`, `uploadedBy`, `visibility: 'private'|'tenant'|'home'`, `tags[]`.

### GET /documents/categories
**200:** `[{ category, count }]`

### POST · PATCH · DELETE
**Body for create:** `{ title (1–200), description?, category (1–120), fileId, homeId?, visibility (default 'tenant'), tags? (max 30 tags × 60 chars) }`
**DELETE is hard-delete.**

---

## M18 — Forms

**Base:** `/api/v1/forms` · 🔐 💳

### GET /forms/metadata
**200:** `{ categories, formTypes, statuses: ['draft','released','archived'], formGroups, triggerOptions }`

### GET /forms
**Query:** `page, pageSize, search?, type?, group?, status?, sortBy?, sortOrder?`

### GET /forms/:id
Full form including `builder: { version, sections, fields }`, `notifications: { mode, userIds, roles }`, `access: { confidentialityMode, confidentialityUserIds, confidentialityRoles, approverMode, approverUserIds, approverRoles }`, `triggerTask: { enabled, followUpFormId, ... }`.

### POST /forms · PATCH /forms/:id
Complex body — see Swagger for full shape.

### Form lifecycle
- `POST /forms/:id/clone` → new form
- `POST /forms/:id/publish` → status 'released'
- `POST /forms/:id/archive` → status 'archived'
- `PATCH /forms/:id/builder` → update builder JSON
- `PATCH /forms/:id/access` → update access rules
- `PATCH /forms/:id/trigger` → update trigger rules
- `POST /forms/:id/preview` → render preview
- `POST /forms/:id/submissions` → submit form data
  - **Body:** `{ relatedEntityType?, relatedEntityId?, data: object, signature?: string }`
  - **201:** `{ submissionId, formId, status: 'submitted'|'pending_approval'|..., submittedAt, submittedBy }`

---

## M19 — Uploads

**Base:** `/api/v1/uploads` · 🔒

Two-step signed-URL flow.

### POST /uploads/sessions
**Body:**
```typescript
{
  fileName: string;        // 1–255
  contentType: string;     // 3–120 (e.g. 'application/pdf')
  sizeBytes: number;       // positive
  purpose: 'signature' | 'task_attachment' | 'task_document' | 'announcement_image' | 'general';
  checksumSha256?: string; // 64-char hex
}
```
**201:**
```typescript
{
  file: { id, fileName, contentType, sizeBytes, uploadStatus: 'pending', checksumSha256, createdAt };
  upload: { method: 'PUT', url, expiresAt, headers: { 'Content-Type': string } };
}
```

### POST /uploads/:id/complete
**Body (optional):** `{ expectedSizeBytes? }`
**200:** `{ file, download: { url (7-day signed), expiresAt } }`

### GET /uploads/:id/download-url
**200:** `{ file, download: { url, expiresAt } }`

---

## M20 — Announcements

**Base:** `/api/v1/announcements` · 🔐 💳

### GET / · GET /:id
List + detail. Detail marks as read.

### POST /:id/read · 30/min
Idempotent read marker. **200:** `{ message }`

### POST · PATCH · DELETE · 📛 `announcements:write`
**Body:** `{ title, description, images?: string[], startsAt, endsAt?, isPinned? }`
**DELETE** archives (soft).

---

## M21 — Audit

**Base:** `/api/v1/audit` · 🔐 💳

### GET /audit
**Query:** `page, pageSize (max 100), action?, entityType?, userId?, fromDate?, toDate?`

### GET /audit/security-alerts
**Query:** `lookbackHours?` (default 24)
**200:** Aggregated alerts derived from recent events:
```typescript
{
  type: 'repeated_auth_failures' | 'cross_tenant_attempts' | 'admin_changes' | 'break_glass_access';
  severity: 'medium' | 'high';
  count, lastSeenAt, details
}[]
```

### GET /audit/:id
Full audit log entry.

---

## M22 — Calendar

**Base:** `/api/v1/calendar` · 🔐 💳

### GET /events · GET /:id · POST · PATCH · DELETE
**Body for create:** `{ title, description?, startTime, endTime, recurrence?: object }`

---

## M23 — Dashboard

**Base:** `/api/v1/dashboard` · 🔐 💳

### GET /dashboard/stats
**200:** Same KPI counts as `/summary/stats`.

### GET /dashboard/widgets · POST · DELETE /:id
**Body for create:** `{ title, period, reportsOn }`
User-scoped widgets.

---

## M24 — Exports

**Base:** `/api/v1/exports` · 🔐 💳

### POST /exports
Async export job.
**Body:** `{ title, format: 'csv'|'excel'|'pdf', filters?: object }`
**201:** Job object with ID and `status`.

### GET /exports · GET /exports/:id
List / detail.

### GET /exports/:id/download
**200:** Binary stream (`application/octet-stream`).
**409:** Job not ready.

---

## M25 — Groupings

**Base:** `/api/v1/groupings` · 🔐 💳

Standard CRUD. **Body:** `{ name, description?, parentId? }` (supports nesting).

---

## M26 — Help Center

**Base:** `/api/v1/help-center` · 🔐 💳

### FAQs
- `GET /faqs` (paginated, public read)
- `GET /faqs/:id`
- `POST /faqs` · `PATCH` · `DELETE` · 📛 `help_center:admin`
- **Body:** `{ title, content (markdown/HTML), category?, isPublished? }`

### Tickets
- `POST /tickets` — `{ subject, description, category?, priority?: 'low'|'medium'|'high' }`
- `GET /tickets` (paginated)
- `GET /tickets/:id` — includes `comments[]`
- `PATCH /tickets/:id` — `{ status?: 'open'|'in_progress'|'resolved'|'closed', priority?, category? }`
- `POST /tickets/:id/comments` — `{ text, attachmentIds? }`
- `DELETE /tickets/:id` — closes ticket.

---

## M27 — Notifications

**Base:** `/api/v1/notifications` · 🔐 💳

### GET /notifications
**Query:** `page, pageSize, read?`

### GET /notifications/unread-count
**200:** `{ count }` — for badge.

### POST /:id/read · POST /read-all
Single / bulk mark as read. Bulk returns `{ updated: number }`.

### GET /preferences · PUT /preferences
**Body:** `[{ category, enabled }]`

---

## M28 — Regions

**Base:** `/api/v1/regions` · 🔐 💳

Standard CRUD. **Body:** `{ name, code? }`.

---

## M29 — Reports

**Base:** `/api/v1/reports` · 🔐 💳 · 📛 `reports:read`

### GET /reports/reg44-pack
Reg 44 compliance evidence pack.
**Query:** `tenantId, startDate, endDate, format?: 'json'|'pdf'|'excel'|'zip' (default 'json')`

**Response — hybrid (depends on `format`):**

| Format | Response shape | Content-Type |
|---|---|---|
| `json` | Standard envelope: `{ success: true, data: <pack> }` | `application/json` |
| `pdf` | Binary stream, `Content-Disposition: attachment; filename="..."` | `application/pdf` |
| `excel` | Binary stream, same header pattern | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `zip` | Binary stream (contains PDF + Excel) | `application/zip` |

**FE rule:** branch on `format` client-side. For `json`, parse normally and unwrap `data`. For everything else, use `response.blob()` and trigger a download — do NOT `.json()`. No signed URLs / expiry tokens involved.

### GET /reports/reg45-pack
Same shape and same hybrid response as Reg 44.

### GET /reports/ri-dashboard
Responsible Individual monitoring KPIs.
**Query:** `tenantId, startDate?, endDate?, format?: 'json'|'pdf'|'excel' (default 'json')` — no `zip` here.
Hybrid response same as above (envelope for JSON, binary stream for pdf/excel).

### GET /reports/ri-dashboard/drilldown
**Query:** `tenantId, metric: 'compliance'|'safeguarding_risk'|'staffing_pressure'|'action_completion', page, pageSize, format?: 'json'|'pdf'|'excel'`
Hybrid response same as above.

---

## M30 — Roles

**Base:** `/api/v1/roles` · 🔐 💳

### GET / · GET /:id
List + detail.

### POST · PATCH · 📛 `roles:write`
**Body:** `{ name, description?, permissions?: string[] }`

### PATCH /roles/:id/permissions · 📛 `roles:write`
**Body:** `{ permissions: string[] }` — bulk replace.

### DELETE — soft-delete.

---

## M31 — Rotas

**Base:** `/api/v1/rotas` · 🔐 💳

### Rotas
`GET / · GET /:id · POST · PATCH · DELETE`
**Body:** `{ title, description?, startDate, endDate, schedule: array }`

### Templates
`GET /rotas/templates · POST /rotas/templates`
**Body:** `{ name, description?, schedule: array }`

---

## M32 — Safeguarding

**Base:** `/api/v1/safeguarding` · 🔐 💳

### Chronologies (evidence-linked history)
- `GET /chronology/young-people/:id?fromDate&toDate&categories[]`
- `GET /chronology/homes/:id?fromDate&toDate&categories[]`

### Patterns (incident analysis)
- `GET /patterns/young-people/:id?fromDate&toDate`
- `GET /patterns/homes/:id?fromDate&toDate`
**200:** Frequency, cluster, recurrence, co-occurrence patterns with explainability fields.

### Risk alert rules
- `GET /risk-alerts/rules` — configured rule definitions.

### Reflective recording prompts
- `GET /reflective-prompts?formType?&taskId?`
- `POST /reflective-prompts/tasks/:id/responses` — save responses into task submission.

### Risk alerts
- `GET /risk-alerts?page&pageSize&status?&severity?`
- `GET /risk-alerts/:id`
- `POST /risk-alerts/evaluate` — manual / scheduled backfill. **Body:** `{ mode?: 'event'|'manual'|'scheduled', lookbackHours? }`. **200:** Summary stats (`totalCandidates, createdCount, reopenedCount, updatedCount, severityRaisedCount, routedCount, rules`).
- `POST /risk-alerts/:id/acknowledge` — Body: `{ note? }`
- `POST /risk-alerts/:id/in-progress` — same body
- `POST /risk-alerts/:id/resolve` — same body
- `POST /risk-alerts/:id/notes` — Body: `{ content }`

---

## M33 — Sensitive Data

**Base:** `/api/v1/sensitive-data` · 🔐 💳

All access is automatically logged.

### GET / · GET /categories · GET /:id · GET /:id/access-log
### POST · PATCH · DELETE
**Body:** `{ category, content, description?, expiryDate? }`
**DELETE is hard-delete.**

---

## M34 — Settings

**Base:** `/api/v1/settings` · 🔐 💳

### GET /organisation · PATCH /organisation
Tenant-wide settings (branding, policies).

### GET /notifications · PATCH /notifications
User-level delivery preferences.

---

## M35 — Summary

**Base:** `/api/v1/summary` · 🔐 💳

### GET /summary/stats
**200:** `{ overdue, dueToday, pendingApproval, rejected, draft, future, comments, rewards }` (KPI counts)

### GET /summary/todos
Personal to-do list. **Query:** `page, pageSize`.

### GET /summary/overdue-tasks
Filtered overdue subset.

### GET /summary/tasks-to-approve
**Query:** `page, pageSize, scope?: 'all'|'gate'|'popup'`
- `scope=gate`: unreviewed overdue blockers
- `scope=popup`: unreviewed non-overdue reminders

### GET /summary/tasks-to-approve/:id
Full detail with submission payload.

### POST /summary/tasks-to-approve/:id/review-events (or `/review-event`)
**Body:** `{ action: 'view_detail' | 'open_document' | 'open_task' }`
Tracks reviewer engagement before approval (gating signal).

### POST /summary/tasks-to-approve/process-batch (or `/approvals`)
**Body:**
```typescript
{
  action: 'approve' | 'reject';
  taskIds: string[];
  comment?: string;
  signatureFileId?: string;
  gateScope?: 'global' | 'task';  // default 'task'
}
```
**200:** `{ processed, failed: [{ id, reason }] }`

### POST /summary/tasks-to-approve/:id/approve (or `/approval`)
**Body:** `{ comment?, signatureFileId?, gateScope? }`
**200:** Updated task.

### GET /summary/provisions
Today's scheduled events + staff shifts grouped by home.

---

## M36 — Webhooks

**Base:** `/api/v1/webhooks` · 🔐 💳

Outbound webhooks the customer configures to receive events.

### GET / · POST · PATCH · DELETE
**Body for create:** `{ url (HTTPS), events: string[], description?, active? }`

### GET /:id/deliveries
**Query:** `page, pageSize, status?, dateFrom?, dateTo?`
Delivery log per webhook.

### POST /:id/test
Sends a test payload. **200:** `{ deliveryId, message }`

---

## M37 — Integrations

**Base:** `/api/v1/integrations`

### POST /integrations/billing/webhook · 🔓
**Stripe → BE webhook receiver.** FE does NOT call this. Stripe signature verified server-side, idempotent on event ID.

Events handled: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.{paid,payment_failed}`, `payment_method.{attached,detached}`.

### POST /integrations/security-alerts/webhook · 🔓
Inbound BE-internal webhook (different system → our BE). Signature-verified. Not called by FE.

---

# Platform Admin Routes (`/admin/*`)

These are for the **Zikel internal admin panel** (separate FE), not the tenant-facing app.

---

## M38 — Admin Auth

**Base:** `/admin/auth` · 🔓 except `/me` & `/sessions*` · 10/min on login

### POST /admin/auth/login
**Body:** `{ email, password }`
**200:** As tenant login but minimal payload. Either:
- `{ mfaRequired, challengeToken, challengeExpiresInSeconds }`
- `{ mfaEnrollmentRequired, enrollmentToken, enrollmentExpiresInSeconds }`

### POST /admin/auth/logout · /refresh · GET /me · GET/DELETE /sessions
Mirror tenant auth.

---

## M39 — Admin MFA

**Base:** `/admin/mfa`

`POST /totp/verify`, `/backup/verify`, `/totp/enroll/setup`, `/totp/enroll/confirm` — mirror tenant flow.
`GET /status`, `POST /totp/setup`, `POST /totp/verify-setup`, `DELETE /totp` — authenticated management.

---

## M40 — Admin Tenants

**Base:** `/admin/tenants` · 🔐 (MFA mandatory)

### GET /admin/tenants
**Query:** `page, pageSize, search? (1–120), isActive?, country?: 'UK'|'Nigeria'`

### GET /admin/tenants/:id
Full tenant detail.

### POST /admin/tenants/:id/suspend · `platform_admin` only · 10/5min
**Body:** `{ reason (10–500 chars) }`
**200:** `{ id, isActive: false }`
Atomically takes tenant offline + revokes sessions. Logged.

### POST /admin/tenants/:id/reactivate · `platform_admin` only · 10/5min
**Body:** `{ reason }`

---

## M41 — Admin Audit

**Base:** `/admin/audit` · 🔐 (MFA mandatory even for GETs)

### GET /admin/audit/tenants/:id
Cross-tenant audit read. **The read itself is logged in PlatformAuditLog.**

### GET /admin/audit/tenants/:id/export
**Query:** `format: 'csv'|'json' (default csv), action?, userId?, fromDate?, toDate?`
**200:** File stream. Headers: `X-Audit-Export-Total-Matching`, `X-Audit-Export-Returned`, `X-Audit-Export-Truncated`. Hard-capped at 50,000 rows.

### GET /admin/audit/platform
Platform staff actions log.
**Query:** `page, pageSize, action?, platformUserId?, targetTenantId?, fromDate?, toDate?`

---

## M42 — Admin Notifications

**Base:** `/admin/notifications`

### POST /admin/notifications/broadcast · `platform_admin` only · 10/5min
**Body:** `{ title, description, tenantIds?: string[], expiresAt? }`
**201:** `{ recipientCount }`

---

## M43 — Admin Billing

**Base:** `/admin/billing` · 🔐 (MFA mandatory)

### GET /admin/billing/subscriptions
**Query:** `page, pageSize, status?: trialing|active|past_due_grace|past_due_readonly|suspended|cancelled|incomplete, search?`

### GET /admin/billing/subscriptions/:tenantId
Detail + recent invoices + payment methods + allocation.

### POST /admin/billing/subscriptions/:tenantId/override · `platform_admin` only · 30/5min
**Body (at least one + reason required):**
```typescript
{
  extendTrialDays?: number;       // 1–365
  grantFullAccessUntil?: string;  // ISO datetime
  addBonusCalls?: number;         // 1–100,000
  reason: string;                 // 10–500
}
```
**200:** Updated subscription. Logged in BillingEvent + PlatformAuditLog.

### GET /admin/billing/events
**Query:** `page, pageSize (max 200), tenantId?, kind?, fromDate?, toDate?`

---

## M44 — Admin Impersonation

**Base:** `/admin/impersonation` (and `POST /admin/tenants/:id/impersonate`)

### POST /admin/tenants/:id/impersonate · `platform_admin` (MFA) · 10/5min
**Body:**
```typescript
{
  ticketReference: string;        // 1–80
  reason: string;                 // 10–500
  durationMinutes?: number;       // 5–240
  grantedByUserId?: string;       // four-eyes approval
}
```
**200:**
```typescript
{
  grant: { id, targetTenantId, targetTenantName, targetUserId, ticketReference, reason, grantedAt, expiresAt };
  tokens: { accessToken, audience: 'tenant', tenantBaseUrl, expiresAt };
}
```
Use the `accessToken` to authenticate into the tenant app. Owner receives best-effort email.

### DELETE /admin/impersonation/active
End the current grant. **200:** `{ revoked: boolean }`

### GET /admin/impersonation
**Query:** `page, pageSize, platformUserId?, targetTenantId?, ticketReference?`

---

## 11. FE Redesign Focus

What's genuinely new from Phase 7 & 8 — biggest UX impact:

1. **Subscription banners** — top-of-app banner driven by `GET /billing/subscription` → `data.ui.*` flags. Different colour / copy / CTA per status (trialing, past_due_grace, past_due_readonly, incomplete).
2. **Past-due read-only mode** — when `ui.isReadOnly === true`: disable all mutating UI (Save / Delete buttons, AI input, Export buttons). Show inline CTAs to billing settings. The backend will block with 402 anyway, but UX should preempt.
3. **Settings → Billing page** — plan picker (monthly/annual), top-up packs grid, customer portal link, AI restriction config, quota viz, invoice history.
4. **AI quota viz** — running balance shown alongside AI inputs (`pool - used + topups`). Per-user breakdown for owners/admins. Show countdown to `resetAt`.
5. **Conversational AI** — full chat UI with sidebar of conversations + message thread. No streaming → optimistic user message + loading state for assistant. Display `fallbackUsed` indicator on assistant messages.
6. **Care-home-first onboarding** — Org Name → email/password → OTP → MFA enrollment (mandatory for Owners). 4 steps, all collected upfront.
7. **3 staff onboarding paths** — Email Invite / Org Invite Link / Direct Provision. Each is a different button in Settings → Members.
8. **Trial countdown** — subtle "X days left in trial" indicator using `ui.daysLeftInTrial`.
9. **MFA challenge UI** — 3-state login response handling (direct, challenge, enrollment) is required.
10. **Session warnings** — countdown synced to `serverTime` from `/auth/session-expiry`; warn before `idleExpiresAt` and `absoluteExpiresAt`.
11. **Tenant switcher** — if user has multiple memberships, show a switcher that calls `POST /auth/switch-tenant`.
12. **Impersonation banner** — JWT `impersonatorId` present → show "Acting as [tenant name] (support session)" with End Session button.

---

## 12. Quick Test Commands

```bash
# Health (no auth)
curl -i https://zikel-solutions-be.onrender.com/health

# Plans (will 401 — confirms route is wired & auth middleware live)
curl -i https://zikel-solutions-be.onrender.com/api/v1/billing/plans

# Login
curl -X POST https://zikel-solutions-be.onrender.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}'

# Verify rate limit headers on a 401
curl -i https://zikel-solutions-be.onrender.com/api/v1/billing/plans | grep -i ratelimit

# Open Swagger UI
open https://zikel-solutions-be.onrender.com/docs
```

---

**Questions / changes:** ping the BE engineer (Julius). The Swagger UI at `/docs` is the schema source-of-truth — this doc is the workflow / convention / module overview.
