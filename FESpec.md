# Frontend Integration Spec (Backend-Verified)

Last updated: 2026-03-19
Source of truth: `src/routes`, `src/modules/*/*.routes.ts`, `src/modules/*/*.service.ts`, middleware, schemas, and tests.

This is the implementation handoff for frontend engineers. It describes what the product currently does, why each endpoint exists, and exactly how FE should use it.

## 1. Product Model (How It Works Today)

The product is a multi-tenant care home management platform.

- Every user belongs to an **organization** (care home). Registration always creates both.
- A user has a global role: `super_admin`, `admin`, `manager`, `staff`.
- A user can also have tenant memberships with tenant roles: `tenant_admin`, `sub_admin`, `staff`.
- Every operational module is tenant-scoped.
- FE must always operate in an active tenant context for tenant data.

Key consequence for FE:

- Authentication is not only `user + token`.
- FE must store and honor `session` context from auth responses.
- After registration + OTP verify, the user already has an active org — no "homeless user" state.

## 2. Registration & Onboarding Flows

There are **two distinct user types** with different onboarding paths:

### 2.1 Care Home Owner Registration (public)

This is the main signup flow. The person registering IS the organization.

**Flow:**

1. User fills registration form with personal details AND organization name.
2. `POST /api/v1/auth/register` — creates user + org + admin membership atomically.
3. `POST /api/v1/auth/verify-otp` — verifies email, activates account, issues tokens.
4. User lands in dashboard with their org already active. No extra steps.

**What FE receives after verify-otp:**
```json
{
  "user": { "id": "...", "activeTenantId": "the-new-org-id", ... },
  "session": {
    "activeTenantId": "the-new-org-id",
    "activeTenantRole": "tenant_admin",
    "memberships": [{ "tenantId": "...", "tenantName": "Sunrise Care", "tenantSlug": "sunrise-care", "tenantRole": "tenant_admin" }],
    "mfaRequired": true,
    "mfaVerified": false
  },
  "tokens": { "accessToken": "...", "refreshToken": "..." }
}
```

**Important:** `mfaRequired` will be `true` because the user is a `tenant_admin`. FE should trigger the MFA flow before allowing access to admin features.

**Register request body:**
```json
{
  "country": "UK",
  "firstName": "John",
  "lastName": "Smith",
  "email": "john@sunrisecare.co.uk",
  "password": "SecurePass123!",
  "confirmPassword": "SecurePass123!",
  "acceptTerms": true,
  "organizationName": "Sunrise Care Home",
  "organizationSlug": "sunrise-care-home"
}
```

- `organizationName` is **required**.
- `organizationSlug` is **optional** — auto-generated from name if omitted.
- If slug is taken, the BE returns `409 ORG_SLUG_TAKEN`.

### 2.2 Staff Onboarding (3 methods)

Staff never self-register through the main signup. They are always onboarded by their organization admin.

#### Method A: Admin Provisions Staff Directly (from dashboard)

Admin creates a staff account from the Users page. Staff receives an activation email.

**Admin flow (FE):**
1. Admin navigates to Users → Add Staff.
2. Fills in: firstName, lastName, email, role (staff or sub_admin).
3. `POST /api/v1/tenants/:id/staff`
4. Staff receives activation email with 6-digit code.
5. Admin sees the new staff in the members list with status `invited`.

**Staff activation flow (FE):**
1. Staff receives email with 6-digit activation code.
2. Staff visits activation page (e.g. `/activate`).
3. Staff enters: email, code, new password, accept terms.
4. `POST /api/v1/auth/staff-activate`
5. Returns full `AuthResponse` — staff is logged in and in their care home.

**Staff-activate request body:**
```json
{
  "email": "jane@example.com",
  "code": "482910",
  "password": "SecurePass123!",
  "confirmPassword": "SecurePass123!",
  "acceptTerms": true
}
```

**Staff-activate response:** Same `AuthResponse` shape as login (user + session + tokens).

#### Method B: Org Invite Link (self-service with admin approval)

Admin generates a reusable link. Staff registers via the link. Admin approves.

**Admin flow (FE):**
1. Admin navigates to Users → Invite Link.
2. `POST /api/v1/tenants/:id/invite-link` with optional `{ defaultRole, expiresInHours }`.
3. Gets back a link code. FE constructs the URL: `https://app.zikel.com/join/<code>`.
4. Admin shares link however they want (WhatsApp, print QR, email blast).
5. Admin can list links: `GET /api/v1/tenants/:id/invite-links`.
6. Admin can revoke: `PATCH /api/v1/tenants/:id/invite-links/:linkId/revoke`.

**Staff self-registration flow (FE):**
1. Staff clicks invite link → FE extracts the code from URL.
2. `GET /api/v1/auth/join/:inviteCode` — validates link, returns org name + default role.
3. FE shows: "Join **Sunrise Care Home** as **staff**" with registration form.
4. Staff fills in details.
5. `POST /api/v1/auth/join/:inviteCode` — creates account with `pending_approval` membership.
6. Staff verifies email via `POST /api/v1/auth/verify-otp`.
7. FE shows: "Your account is pending approval from the admin."

**Admin approval flow (FE):**
1. Admin sees pending members in Users page (status = `pending_approval`).
2. Admin approves: `PATCH /api/v1/tenants/:id/memberships/:membershipId` with `{ "status": "active" }`.
3. Staff can now login normally.

**Validate invite link response:**
```json
{
  "success": true,
  "data": {
    "tenantName": "Sunrise Care Home",
    "tenantSlug": "sunrise-care-home",
    "defaultRole": "staff"
  }
}
```

**Join via invite link request body:**
```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "password": "SecurePass123!",
  "confirmPassword": "SecurePass123!",
  "acceptTerms": true
}
```

#### Method C: CSV Bulk Upload (future — not yet implemented)

Will be added later for large-scale staff onboarding.

### 2.3 Membership Statuses

FE must handle these membership statuses:

| Status | Meaning | FE Behavior |
|--------|---------|-------------|
| `active` | Full access | Normal app usage |
| `invited` | Admin-provisioned, awaiting activation | Show "Activate your account" prompt |
| `pending_approval` | Self-registered via invite link, awaiting admin approval | Show "Pending approval" message |
| `suspended` | Temporarily disabled by admin | Show "Account suspended" message |
| `revoked` | Permanently removed | Treat as no membership |

## 3. Non-Negotiable FE Requirements

### 3.1 Session storage must include tenant + MFA context

Store these from auth responses:

- `data.user`
- `data.session.activeTenantId`
- `data.session.activeTenantRole`
- `data.session.memberships[]`
- `data.session.mfaRequired`
- `data.session.mfaVerified`
- `data.tokens.accessToken`
- `data.tokens.refreshToken` (when returned)

`/auth/switch-tenant` returns a new access token only; keep existing refresh token.

### 3.2 Implement tenant switch UX

Flow:

1. Read tenant memberships from `session.memberships`.
2. Show tenant switcher when membership count > 1.
3. Call `POST /api/v1/auth/switch-tenant` with `{ tenantId }`.
4. Replace access token with returned token.
5. Refetch tenant-scoped screens.

### 3.3 Implement privileged MFA UX

Privileged session means:

- global `super_admin`, or
- tenant role `tenant_admin`

When privileged and not verified, protected routes return `403 MFA_REQUIRED`.

FE flow:

1. Call `POST /api/v1/auth/mfa/challenge`.
2. Collect OTP from user.
3. Call `POST /api/v1/auth/mfa/verify` with `{ code }`.
4. Replace access token with returned token.
5. Retry blocked request once.

### 3.4 Implement refresh-token rotation correctly

`POST /api/v1/auth/refresh` rotates refresh tokens.

FE rule:

1. On first `401` from protected request, call refresh once.
2. Replace both access and refresh tokens.
3. Retry original request once.
4. If refresh fails with `REFRESH_TOKEN_INVALID`, force logout.

### 3.5 Handle tenant-isolation semantics properly

Many cross-tenant accesses intentionally return `404` to avoid data leakage.

FE should interpret some `404` as:

- not found, or
- not accessible in the active tenant

Do not assume every `404` means record deleted.

### 3.6 Support both validation error styles

FE must surface both:

- `400 FST_ERR_VALIDATION` (AJV/schema layer)
- `422 VALIDATION_ERROR` (Zod/business validation)

## 4. API Contract FE Must Follow

### 4.1 Base URLs

- API base: `/api/v1`
- Infra/public endpoints:
  - `GET /health`
  - `GET /ready`
  - `GET /assets/white-logo.svg`

### 4.2 Headers

- JSON requests: `Content-Type: application/json`
- Protected routes: `Authorization: Bearer <accessToken>`

CORS currently supports:

- `Content-Type`
- `Authorization`

### 4.3 Response envelope

Success:

```json
{ "success": true, "data": {}, "meta": {} }
```

Error:

```json
{ "success": false, "error": { "code": "...", "message": "...", "details": {} } }
```

### 4.4 Pagination

List endpoints usually return `meta` with:

- `total`
- `page`
- `pageSize`
- `totalPages`

## 5. Core UX Flows FE Should Implement

### 5.1 Care Home Owner Registration

1. Show registration form with personal details + organization name.
2. Optional precheck: `GET /auth/check-email`.
3. `POST /auth/register`.
4. Move to OTP verification screen.
5. `POST /auth/verify-otp`.
6. User is now logged in with their org active. Route to dashboard.
7. Trigger MFA flow (user is `tenant_admin`, so `mfaRequired=true`).

### 5.2 Staff Activation (admin-provisioned)

1. Staff receives activation email → clicks link → lands on `/activate` page.
2. Staff enters email + 6-digit code + sets password.
3. `POST /auth/staff-activate`.
4. On success: store tokens + session, route to dashboard.

### 5.3 Staff Join via Invite Link

1. Staff clicks invite link → FE extracts code from URL.
2. `GET /auth/join/:code` — show org name.
3. Staff fills registration form.
4. `POST /auth/join/:code`.
5. Move to OTP verification screen.
6. `POST /auth/verify-otp`.
7. Show "Your account is pending approval" message. Staff cannot access the dashboard until approved.

### 5.4 Standard Login

1. `POST /auth/login`.
2. Store user/session/tokens.
3. If `session.mfaRequired=true` and `mfaVerified=false`, trigger MFA flow.
4. If membership status is `pending_approval`, show pending message.
5. Route user by role and tenant context.

### 5.5 Password Reset

1. `POST /auth/forgot-password` (always generic success UI).
2. `POST /auth/reset-password` with OTP.
3. Force fresh login.

### 5.6 Super-admin Break-glass

1. Start emergency context: `POST /audit/break-glass/access`.
2. Perform scoped investigation actions.
3. Release context: `POST /audit/break-glass/release`.

## 6. Endpoint Map by Business Domain

Each endpoint below includes business decision and FE use.

### 6.1 Infrastructure

| Endpoint | Business Decision | FE Usage |
|---|---|---|
| `GET /health` | Process liveness only. | Optional health indicator. |
| `GET /ready` | Service readiness including DB check. | Optional admin ops view. |
| `GET /assets/white-logo.svg` | Public asset for email-safe rendering. | Usually no app usage needed. |

### 6.2 Auth and Session

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `POST /api/v1/auth/register` | Creates user + organization + admin membership atomically. Issues email-verification OTP. Requires `organizationName`. | Signup form with org name field, then OTP step. |
| `GET /api/v1/auth/join/:inviteCode` | Validates invite link, returns org name and default role. Public. | Pre-fill join page with org details. |
| `POST /api/v1/auth/join/:inviteCode` | Staff self-registers via invite link. Creates account with `pending_approval` membership. | Join form, then OTP step, then pending message. |
| `POST /api/v1/auth/staff-activate` | Activates pre-provisioned staff account. Staff sets password + verifies email in one step. Returns AuthResponse. | Activation page with email + code + password form. |
| `GET /api/v1/auth/check-email` | Privacy-safe anti-enumeration precheck (always generic). | Use only for UX gating, not authoritative existence check. |
| `POST /api/v1/auth/verify-otp` | Validate OTP, activate account, issue tokens + session. | Treat as authenticated login success. |
| `POST /api/v1/auth/resend-otp` | Enforces cooldown and rotates OTP. | Resend button with countdown and cooldown handling. |
| `POST /api/v1/auth/login` | Login with lockout + verification checks. | Standard login with explicit error-code handling. |
| `POST /api/v1/auth/mfa/challenge` | Initiate privileged-session MFA. | Trigger on `MFA_REQUIRED` or proactively for privileged users. |
| `POST /api/v1/auth/mfa/verify` | Verify MFA OTP and re-issue access token. | Replace access token; retry blocked action. |
| `POST /api/v1/auth/refresh` | Single-use refresh token rotation. | Refresh interceptor replaces both tokens. |
| `POST /api/v1/auth/switch-tenant` | Change active tenant if user has active membership. | Tenant switcher action; replace access token only. |
| `POST /api/v1/auth/logout` | Revoke refresh token for current user. | Logout endpoint before clearing FE session. |
| `POST /api/v1/auth/forgot-password` | Anti-enumeration reset request. | Always show generic success message. |
| `POST /api/v1/auth/reset-password` | Verify reset OTP and set new password. | On success, force full re-login. |
| `GET /api/v1/auth/me` | Return authenticated user profile. | Lightweight bootstrap check if needed. |

Important auth details:

- Register country enum: `UK`, `Nigeria`
- Password policy: min 12, upper/lower/number/special, no spaces
- OTP: 6 digits, 10-minute expiry (staff activation code: 7-day expiry)
- Check-email currently returns generic `available` response by design

### 6.3 Me (Profile and Preferences)

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/me` | Current user profile and tenant-linked context. | Profile page bootstrap. |
| `PATCH /api/v1/me` | Update profile fields. | Profile edit form. |
| `POST /api/v1/me/change-password` | Change password and revoke refresh sessions. | After success, re-authentication UX. |
| `GET /api/v1/me/permissions` | Returns computed capability booleans. | FE feature gating helper. |
| `GET /api/v1/me/preferences` | Read language/timezone prefs. | Preferences page load. |
| `PATCH /api/v1/me/preferences` | Update language/timezone prefs. | Preferences save. |

### 6.4 Public Marketing Endpoints

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `POST /api/v1/public/book-demo` | Public lead capture with rate limit. | Marketing form submit. |
| `POST /api/v1/public/join-waitlist` | Public waitlist capture with rate limit. | Waitlist form submit. |
| `POST /api/v1/public/contact-us` | Public contact capture with rate limit. | Contact form submit. |

### 6.5 Tenants, Memberships, Invites, Staff Provisioning

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/tenants` | Super-admin tenant directory. | Platform admin tenant table. |
| `GET /api/v1/tenants/:id` | Super-admin tenant details. | Tenant detail page. |
| `POST /api/v1/tenants` | Super-admin tenant provisioning. | Platform provisioning wizard. |
| `POST /api/v1/tenants/:id/staff` | Admin provisions a staff account. Creates user + membership + sends activation email. | "Add Staff" form in Users page. |
| `POST /api/v1/tenants/:id/invite-link` | Admin generates reusable invite link for self-service staff registration. | "Generate Invite Link" button in Users page. |
| `GET /api/v1/tenants/:id/invite-links` | List active invite links for tenant. | Invite links management section. |
| `PATCH /api/v1/tenants/:id/invite-links/:linkId/revoke` | Revoke an invite link. | Revoke CTA in invite links list. |
| `GET /api/v1/tenants/:id/memberships` | Scoped membership list by actor permissions. | Membership management table. Filter by status to show pending_approval. |
| `POST /api/v1/tenants/:id/memberships` | Scoped membership add by actor permissions. | Add member modal with role filtering. |
| `PATCH /api/v1/tenants/:id/memberships/:membershipId` | Scoped membership updates. Used to approve pending members. | Role/status edit flow. Approve button for `pending_approval` members. |
| `GET /api/v1/tenants/:id/invites` | Scoped invite list with filters. | Invite list page. |
| `POST /api/v1/tenants/:id/invites` | Create tokenized invite and trigger invite email (best effort). | Invite create modal + token copy fallback UX. |
| `PATCH /api/v1/tenants/:id/invites/:inviteId/revoke` | Scoped invite revoke. | Revoke CTA in invite list. |
| `POST /api/v1/tenants/invites/accept` | Accept invite token for authenticated user. | Invite acceptance page/flow. |

**Staff provisioning request body:**
```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "role": "staff"
}
```

**Staff provisioning response:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "email": "jane@example.com", "firstName": "Jane", "lastName": "Doe" },
    "membership": { "id": "...", "tenantId": "...", "userId": "...", "role": "staff", "status": "invited", ... },
    "tenantName": "Sunrise Care Home"
  }
}
```

**Create invite link request body:**
```json
{
  "defaultRole": "staff",
  "expiresInHours": 168
}
```

Both fields are optional. `defaultRole` defaults to `staff`. `expiresInHours` can be omitted for no expiry.

**Invite link response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "tenantId": "...",
    "tenantName": "Sunrise Care Home",
    "code": "abc123def456",
    "defaultRole": "staff",
    "isActive": true,
    "expiresAt": null,
    "createdAt": "..."
  }
}
```

FE constructs the shareable URL: `https://app.zikel.com/join/{code}`

Role permission rules:

- `super_admin`: manage `tenant_admin`, `sub_admin`, `staff`
- `tenant_admin`: manage `sub_admin`, `staff`
- `sub_admin`: manage `staff`

### 6.6 Care Groups

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/care-groups` | Tenant-scoped list. | Care-group list page. |
| `GET /api/v1/care-groups/:id` | Tenant-scoped detail. | Care-group detail view. |
| `POST /api/v1/care-groups` | Write restricted to global `admin`. | Admin-only create flow. |
| `PATCH /api/v1/care-groups/:id` | Write restricted to global `admin`. | Admin-only edit flow. |
| `DELETE /api/v1/care-groups/:id` | Soft deactivation. | Use "Deactivate" wording. |

### 6.7 Homes

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/homes` | Tenant-scoped list with filters. | Homes table with server filters. |
| `GET /api/v1/homes/:id` | Tenant-scoped detail. | Home detail page. |
| `POST /api/v1/homes` | Writes for global `admin` or `manager`. | Create home form with tenant-scoped care-group picker. |
| `PATCH /api/v1/homes/:id` | Same write restrictions. | Edit home flow. |
| `DELETE /api/v1/homes/:id` | Soft deactivation. | Deactivate action. |

### 6.8 Employees

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/employees` | Tenant-scoped list with filters. | Employee table. |
| `GET /api/v1/employees/:id` | Tenant-scoped detail. | Employee detail view. |
| `POST /api/v1/employees` | Writes for global `admin` or `manager`. | Create from eligible tenant users. |
| `PATCH /api/v1/employees/:id` | Same write restrictions. | Edit employee flow. |
| `DELETE /api/v1/employees/:id` | Soft deactivation. | Deactivate action. |

### 6.9 Young People

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/young-people` | Tenant-scoped list with filters. | Young-people list page. |
| `GET /api/v1/young-people/:id` | Tenant-scoped detail. | Detail page. |
| `POST /api/v1/young-people` | Writes for global `admin` or `manager`. | Create flow with home validation awareness. |
| `PATCH /api/v1/young-people/:id` | Same write restrictions. | Edit flow with nullable fields support. |
| `DELETE /api/v1/young-people/:id` | Soft deactivation. | Deactivate action. |

### 6.10 Vehicles

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/vehicles` | Tenant-scoped list with filters/sort. | Vehicle table. |
| `GET /api/v1/vehicles/:id` | Tenant-scoped detail. | Detail page. |
| `POST /api/v1/vehicles` | Writes for `super_admin`, `admin`, `manager`. | Create flow. |
| `PATCH /api/v1/vehicles/:id` | Same write restrictions. | Edit flow. |
| `DELETE /api/v1/vehicles/:id` | Soft deactivation. | Deactivate action. |

Vehicle note:

- `registration` is globally unique and normalized uppercase.

### 6.11 Tasks

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/tasks` | Tenant-scoped; non-privileged users are self/assigned scoped. | Task list with `mine` toggle. |
| `GET /api/v1/tasks/:id` | Tenant-scoped; non-privileged access is limited. | Task detail with permission-aware errors. |
| `POST /api/v1/tasks` | All authenticated can create; non-privileged assignment/approval restrictions apply. | Restrict form options by user capability. |
| `PATCH /api/v1/tasks/:id` | Non-privileged updates are restricted. | Restrict reassignment/approval transitions in FE. |
| `DELETE /api/v1/tasks/:id` | Archive behavior (soft delete). | Use "Archive task" UX text. |

### 6.12 Summary

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/summary/stats` | Personal + permission-aware stats. | KPI cards. |
| `GET /api/v1/summary/todos` | Personal todo feed. | Todos panel. |
| `GET /api/v1/summary/tasks-to-approve` | Only approvers. | Approvals queue. |
| `POST /api/v1/summary/tasks-to-approve/process-batch` | Batch approve/reject with partial results. | Batch actions UI with per-item failure reporting. |
| `POST /api/v1/summary/tasks-to-approve/:id/approve` | Single task approval workflow. | Single-approve CTA. |
| `GET /api/v1/summary/provisions` | Daily operations data grouped by home. | Daily provisions view. |

### 6.13 Dashboard

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/dashboard/stats` | Dashboard KPI stats. | Dashboard header cards. |
| `GET /api/v1/dashboard/widgets` | User+tenant-scoped widgets. | Widget grid load. |
| `POST /api/v1/dashboard/widgets` | Create user widget configuration. | Widget create flow. |
| `DELETE /api/v1/dashboard/widgets/:id` | Scoped widget delete. | Delete CTA with 403/404 handling. |

### 6.14 Announcements

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/announcements` | Tenant announcements feed with read/unread support. | Announcement list. |
| `GET /api/v1/announcements/:id` | Read detail + read-state behavior. | Detail page/drawer. |
| `POST /api/v1/announcements/:id/read` | Idempotent read mark. | Quick mark-read action. |
| `POST /api/v1/announcements` | Write restricted to global `admin`. | Admin-only create composer. |
| `PATCH /api/v1/announcements/:id` | Write restricted to global `admin`. | Admin-only edit. |
| `DELETE /api/v1/announcements/:id` | Archive behavior. | Use "Archive" wording. |

### 6.15 AI

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `POST /api/v1/ai/ask` | Tenant-aware AI assistant with provider fallback. | Assistant panel with source badge (`model` or `fallback`). |
| `PATCH /api/v1/ai/access/:id` | Role-scoped AI access toggle. Allowed for global `admin`/`super_admin` and tenant role `tenant_admin`. | Admin user-management toggle for AI access. |

### 6.16 Audit and Security

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/audit` | Audit explorer with filters and tenant constraints. | Audit table + filters. |
| `GET /api/v1/audit/security-alerts` | Derived security alerts from audit stream. | Security alerts dashboard. |
| `GET /api/v1/audit/:id` | Single audit event detail. | Drilldown modal/page. |
| `POST /api/v1/audit/break-glass/access` | Super-admin emergency tenant access context. | Break-glass start flow with mandatory reason. |
| `POST /api/v1/audit/break-glass/release` | Release emergency context. | Break-glass release CTA. |

### 6.17 Integrations (Not a FE endpoint)

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `POST /api/v1/integrations/security-alerts/webhook` | Internal/system webhook ingestion endpoint with HMAC+timestamp verification. | FE should not call this endpoint. |

## 7. Role and Permission Matrix for FE Gating

Use this for hiding/disabling actions before backend rejection.

- Super-admin only:
  - `GET /tenants`
  - `GET /tenants/:id`
  - `POST /tenants`
  - break-glass endpoints
- Global admin only:
  - announcement writes
  - care-group writes
- Global admin or manager:
  - home/employee/young-people writes
- Super-admin or admin or manager:
  - vehicle writes
- Global admin/super_admin or tenant_admin:
  - AI access toggle endpoint
  - Staff provisioning (`POST /tenants/:id/staff`)
  - Invite link management
- Scoped service-level rules:
  - membership management (including approving `pending_approval` members)
  - invite management
  - task approval and assignment restrictions
  - audit visibility boundaries

## 8. Error Code Playbook (FE Behavior)

Auth/session:

- `EMAIL_TAKEN` -> show duplicate email UI
- `ORG_SLUG_TAKEN` -> suggest different organization name or slug
- `OTP_INVALID` -> invalid/expired OTP message
- `OTP_COOLDOWN` -> countdown UI
- `INVALID_CREDENTIALS` -> login error
- `ACCOUNT_LOCKED` -> lockout message
- `ACCOUNT_INACTIVE` -> disabled account state
- `EMAIL_NOT_VERIFIED` -> route to verification
- `REFRESH_TOKEN_INVALID` -> force logout
- `TENANT_CONTEXT_REQUIRED` -> prompt tenant selection
- `TENANT_ACCESS_DENIED` -> deny + offer tenant switch
- `MFA_REQUIRED` -> launch MFA flow
- `MFA_NOT_REQUIRED` -> hide MFA prompt if shown unnecessarily
- `ACTIVATION_INVALID` -> invalid email or activation code
- `ALREADY_ACTIVATED` -> redirect to login

Invite link:

- `INVITE_LINK_NOT_FOUND` -> invalid or non-existent link
- `INVITE_LINK_REVOKED` -> link has been deactivated
- `INVITE_LINK_EXPIRED` -> link has expired
- `TENANT_INACTIVE` -> organization is no longer active

Tenant/invite:

- `TENANT_SLUG_TAKEN`
- `TENANT_MEMBERSHIP_EXISTS`
- `TENANT_MEMBERSHIP_FORBIDDEN`
- `TENANT_INVITE_EXISTS`
- `TENANT_INVITE_FORBIDDEN`
- `TENANT_INVITE_NOT_FOUND`
- `TENANT_INVITE_ALREADY_ACCEPTED`
- `TENANT_INVITE_REVOKED`
- `TENANT_INVITE_EXPIRED`
- `TENANT_INVITE_EMAIL_MISMATCH`

Domain/ops examples:

- `HOME_NOT_FOUND`, `EMPLOYEE_NOT_FOUND`, `TASK_NOT_FOUND`, etc
- `TASK_ASSIGN_FORBIDDEN`
- `TASK_APPROVAL_STATE_FORBIDDEN`
- `INVALID_TASK_STATE`
- `VEHICLE_REGISTRATION_TAKEN`
- `WIDGET_NOT_FOUND`
- `BREAK_GLASS_REQUIRED`

Generic:

- `FST_ERR_VALIDATION` (`400`) -> form schema error
- `VALIDATION_ERROR` (`422`) -> business validation error
- `RATE_LIMIT_EXCEEDED` (`429`) -> throttle message + retry timing

## 9. Rate-Limit Overrides FE Should Respect

Not exhaustive, but important for UX:

- `POST /auth/register` -> 5/min
- `POST /auth/join/:inviteCode` -> 5/min
- `POST /auth/staff-activate` -> 10/min
- `GET /auth/join/:inviteCode` -> 20/min
- `GET /auth/check-email` -> 20/min
- `POST /auth/verify-otp` -> 10/min
- `POST /auth/resend-otp` -> 5/min
- `POST /auth/login` -> 10/min
- `POST /auth/mfa/challenge` -> 5/min
- `POST /auth/mfa/verify` -> 10/min
- `POST /auth/refresh` -> 20/min
- `POST /auth/forgot-password` -> 5/min
- `POST /auth/reset-password` -> 5/min
- `POST /me/change-password` -> 5/min
- `POST /tenants/:id/staff` -> 20/min
- `POST /ai/ask` -> 20/min
- Public forms (`book-demo`, `join-waitlist`, `contact-us`) -> 10 per 10 minutes

## 10. FE Pages Required

Based on the new flows, FE needs these pages/screens:

### Public (no auth)
- **Registration page** — personal details + organization name + password
- **OTP verification page** — 6-digit code input
- **Login page** — email + password
- **Forgot password page** — email input
- **Reset password page** — email + OTP + new password
- **Staff activation page** (`/activate`) — email + 6-digit code + new password
- **Join via invite link page** (`/join/:code`) — validates link, shows org name, registration form
- **Pending approval page** — shown after invite-link join when membership is `pending_approval`

### Authenticated (dashboard)
- **MFA verification modal/page** — triggered when `mfaRequired && !mfaVerified`
- **Users page** — list members, filter by status (`active`, `invited`, `pending_approval`)
  - Add Staff form (provisions account)
  - Approve/reject pending members
  - Generate/manage invite links
- **Tenant switcher** — shown when user has multiple memberships

## 11. FE Delivery Checklist

This checklist is FE-owned. Backend endpoints for these flows are already present in this repository.

- [ ] Registration form includes `organizationName` field
- [ ] No "create organization" step after OTP verify (org is created during registration)
- [ ] Staff activation page (`/activate`) implemented
- [ ] Join via invite link page (`/join/:code`) implemented with link validation
- [ ] Pending approval state handled (show message, block dashboard access)
- [ ] Users page shows `pending_approval` members with approve/reject actions
- [ ] Invite link generation + copy/share UX implemented
- [ ] API client supports bearer auth + refresh rotation + single retry
- [ ] Session store persists `session` object, not only token/user
- [ ] Tenant switcher implemented using `/auth/switch-tenant`
- [ ] Privileged MFA flow implemented (`challenge` -> `verify` -> retry)
- [ ] Role-based UI gating aligned with matrix above
- [ ] Task and approval UIs enforce non-privileged restrictions
- [ ] Invite lifecycle UI implemented (create/list/revoke/accept)
- [ ] Audit + security alerts views implemented for admin personas
- [ ] 400/422/429 error UX patterns standardized
