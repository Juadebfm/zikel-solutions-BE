# Frontend Integration Spec (Backend-Verified)

Last updated: 2026-03-12
Source of truth: `src/routes`, `src/modules/*/*.routes.ts`, `src/modules/*/*.service.ts`, middleware, schemas, and tests.

This is the implementation handoff for frontend engineers. It describes what the product currently does, why each endpoint exists, and exactly how FE should use it.

## 1. Product Model (How It Works Today)

The product is a multi-tenant platform.

- A user has a global role: `super_admin`, `admin`, `manager`, `staff`.
- A user can also have tenant memberships with tenant roles: `tenant_admin`, `sub_admin`, `staff`.
- Every operational module is tenant-scoped.
- FE must always operate in an active tenant context for tenant data.

Key consequence for FE:

- Authentication is not only `user + token`.
- FE must store and honor `session` context from auth responses.

## 2. Non-Negotiable FE Changes

## 2.1 Session storage must include tenant + MFA context

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

## 2.2 Implement tenant switch UX

Flow:

1. Read tenant memberships from `session.memberships`.
2. Show tenant switcher when membership count > 1.
3. Call `POST /api/v1/auth/switch-tenant` with `{ tenantId }`.
4. Replace access token with returned token.
5. Refetch tenant-scoped screens.

## 2.3 Implement privileged MFA UX

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

## 2.4 Implement refresh-token rotation correctly

`POST /api/v1/auth/refresh` rotates refresh tokens.

FE rule:

1. On first `401` from protected request, call refresh once.
2. Replace both access and refresh tokens.
3. Retry original request once.
4. If refresh fails with `REFRESH_TOKEN_INVALID`, force logout.

## 2.5 Integrate CAPTCHA on all public auth endpoints

Backend now enforces CAPTCHA on public auth endpoints.

Required FE behavior:

- Get Turnstile token on each relevant submit.
- Send token in header: `x-captcha-token: <token>`.
- Handle:
  - `403 CAPTCHA_REQUIRED`
  - `403 CAPTCHA_INVALID`
  - `503 CAPTCHA_NOT_CONFIGURED`

Public auth endpoints requiring CAPTCHA:

- `POST /api/v1/auth/register`
- `GET /api/v1/auth/check-email`
- `POST /api/v1/auth/verify-otp`
- `POST /api/v1/auth/resend-otp`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`

## 2.6 Handle tenant-isolation semantics properly

Many cross-tenant accesses intentionally return `404` to avoid data leakage.

FE should interpret some `404` as:

- not found, or
- not accessible in the active tenant

Do not assume every `404` means record deleted.

## 2.7 Support both validation error styles

FE must surface both:

- `400 FST_ERR_VALIDATION` (AJV/schema layer)
- `422 VALIDATION_ERROR` (Zod/business validation)

## 3. API Contract FE Must Follow

## 3.1 Base URLs

- API base: `/api/v1`
- Infra/public endpoints:
  - `GET /health`
  - `GET /ready`
  - `GET /assets/white-logo.svg`

## 3.2 Headers

- JSON requests: `Content-Type: application/json`
- Protected routes: `Authorization: Bearer <accessToken>`
- CAPTCHA routes: `x-captcha-token: <turnstile-token>`

CORS currently supports:

- `Content-Type`
- `Authorization`
- `X-Captcha-Token`

## 3.3 Response envelope

Success:

```json
{ "success": true, "data": {}, "meta": {} }
```

Error:

```json
{ "success": false, "error": { "code": "...", "message": "...", "details": {} } }
```

## 3.4 Pagination

List endpoints usually return `meta` with:

- `total`
- `page`
- `pageSize`
- `totalPages`

## 4. Turnstile Integration (Frontend)

Use Cloudflare Turnstile site key in FE.

- FE env: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (or framework equivalent)
- Never expose `CAPTCHA_SECRET_KEY` in frontend.

Implementation pattern:

1. Render Turnstile widget in auth forms.
2. On submit, ensure token is present.
3. Attach `x-captcha-token` header.
4. If token expired, refresh token and retry submit.

For `GET /auth/check-email`, still attach `x-captcha-token` header.

## 5. Core UX Flows FE Should Implement

## 5.1 Organization owner onboarding (self-serve)

1. Optional precheck: `GET /auth/check-email`.
2. Register: `POST /auth/register`.
3. Verify OTP: `POST /auth/verify-otp`.
4. If no memberships, prompt "Create organization".
5. Create tenant: `POST /tenants/self-serve`.
6. Call `POST /auth/switch-tenant` to ensure active tenant context.
7. Enter app dashboard.

## 5.2 Staff onboarding via invite

1. User registers/logs in and verifies email.
2. Accept invite: `POST /tenants/invites/accept` with token.
3. Switch tenant: `POST /auth/switch-tenant`.
4. Load tenant-scoped modules.

## 5.3 Standard login flow

1. `POST /auth/login`.
2. Store user/session/tokens.
3. If `session.mfaRequired=true` and `mfaVerified=false`, trigger MFA flow.
4. Route user by role and tenant context.

## 5.4 Password reset flow

1. `POST /auth/forgot-password` (always generic success UI).
2. `POST /auth/reset-password` with OTP.
3. Force fresh login.

## 5.5 Super-admin break-glass flow

1. Start emergency context: `POST /audit/break-glass/access`.
2. Perform scoped investigation actions.
3. Release context: `POST /audit/break-glass/release`.

## 6. Endpoint Map by Business Domain

Each endpoint below includes business decision and FE use.

## 6.1 Infrastructure

| Endpoint | Business Decision | FE Usage |
|---|---|---|
| `GET /health` | Process liveness only. | Optional health indicator. |
| `GET /ready` | Service readiness including DB check. | Optional admin ops view. |
| `GET /assets/white-logo.svg` | Public asset for email-safe rendering. | Usually no app usage needed. |

## 6.2 Auth and Session

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `POST /api/v1/auth/register` | Create pending account, issue email-verification OTP. | Submit signup form, then move to OTP step. |
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
- OTP: 6 digits, 10-minute expiry
- Check-email currently returns generic `available` response by design

## 6.3 Me (Profile and Preferences)

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/me` | Current user profile and tenant-linked context. | Profile page bootstrap. |
| `PATCH /api/v1/me` | Update profile fields. | Profile edit form. |
| `POST /api/v1/me/change-password` | Change password and revoke refresh sessions. | After success, re-authentication UX. |
| `GET /api/v1/me/permissions` | Returns computed capability booleans. | FE feature gating helper. |
| `GET /api/v1/me/preferences` | Read language/timezone prefs. | Preferences page load. |
| `PATCH /api/v1/me/preferences` | Update language/timezone prefs. | Preferences save. |

## 6.4 Public Marketing Endpoints

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `POST /api/v1/public/book-demo` | Public lead capture with rate limit. | Marketing form submit. |
| `POST /api/v1/public/join-waitlist` | Public waitlist capture with rate limit. | Waitlist form submit. |
| `POST /api/v1/public/contact-us` | Public contact capture with rate limit. | Contact form submit. |

## 6.5 Tenants, Memberships, Invites

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/tenants` | Super-admin tenant directory. | Platform admin tenant table. |
| `GET /api/v1/tenants/:id` | Super-admin tenant details. | Tenant detail page. |
| `POST /api/v1/tenants` | Super-admin tenant provisioning. | Platform provisioning wizard. |
| `POST /api/v1/tenants/self-serve` | First-time organization onboarding for authenticated user. | Org creation step after initial signup. |
| `GET /api/v1/tenants/:id/memberships` | Scoped membership list by actor permissions. | Membership management table. |
| `POST /api/v1/tenants/:id/memberships` | Scoped membership add by actor permissions. | Add member modal with role filtering. |
| `PATCH /api/v1/tenants/:id/memberships/:membershipId` | Scoped membership updates. | Role/status edit flow with backend fallback handling. |
| `GET /api/v1/tenants/:id/invites` | Scoped invite list with filters. | Invite list page. |
| `POST /api/v1/tenants/:id/invites` | Create tokenized invite and trigger invite email (best effort). | Invite create modal + token copy fallback UX. |
| `PATCH /api/v1/tenants/:id/invites/:inviteId/revoke` | Scoped invite revoke. | Revoke CTA in invite list. |
| `POST /api/v1/tenants/invites/accept` | Accept invite token for authenticated user. | Invite acceptance page/flow. |

Invite role business rules:

- `super_admin`: invite `tenant_admin`, `sub_admin`, `staff`
- `tenant_admin`: invite `sub_admin`, `staff`
- `sub_admin`: invite `staff`

## 6.6 Care Groups

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/care-groups` | Tenant-scoped list. | Care-group list page. |
| `GET /api/v1/care-groups/:id` | Tenant-scoped detail. | Care-group detail view. |
| `POST /api/v1/care-groups` | Write restricted to global `admin`. | Admin-only create flow. |
| `PATCH /api/v1/care-groups/:id` | Write restricted to global `admin`. | Admin-only edit flow. |
| `DELETE /api/v1/care-groups/:id` | Soft deactivation. | Use "Deactivate" wording. |

## 6.7 Homes

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/homes` | Tenant-scoped list with filters. | Homes table with server filters. |
| `GET /api/v1/homes/:id` | Tenant-scoped detail. | Home detail page. |
| `POST /api/v1/homes` | Writes for global `admin` or `manager`. | Create home form with tenant-scoped care-group picker. |
| `PATCH /api/v1/homes/:id` | Same write restrictions. | Edit home flow. |
| `DELETE /api/v1/homes/:id` | Soft deactivation. | Deactivate action. |

## 6.8 Employees

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/employees` | Tenant-scoped list with filters. | Employee table. |
| `GET /api/v1/employees/:id` | Tenant-scoped detail. | Employee detail view. |
| `POST /api/v1/employees` | Writes for global `admin` or `manager`. | Create from eligible tenant users. |
| `PATCH /api/v1/employees/:id` | Same write restrictions. | Edit employee flow. |
| `DELETE /api/v1/employees/:id` | Soft deactivation. | Deactivate action. |

## 6.9 Young People

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/young-people` | Tenant-scoped list with filters. | Young-people list page. |
| `GET /api/v1/young-people/:id` | Tenant-scoped detail. | Detail page. |
| `POST /api/v1/young-people` | Writes for global `admin` or `manager`. | Create flow with home validation awareness. |
| `PATCH /api/v1/young-people/:id` | Same write restrictions. | Edit flow with nullable fields support. |
| `DELETE /api/v1/young-people/:id` | Soft deactivation. | Deactivate action. |

## 6.10 Vehicles

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/vehicles` | Tenant-scoped list with filters/sort. | Vehicle table. |
| `GET /api/v1/vehicles/:id` | Tenant-scoped detail. | Detail page. |
| `POST /api/v1/vehicles` | Writes for `super_admin`, `admin`, `manager`. | Create flow. |
| `PATCH /api/v1/vehicles/:id` | Same write restrictions. | Edit flow. |
| `DELETE /api/v1/vehicles/:id` | Soft deactivation. | Deactivate action. |

Vehicle note:

- `registration` is globally unique and normalized uppercase.

## 6.11 Tasks

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/tasks` | Tenant-scoped; non-privileged users are self/assigned scoped. | Task list with `mine` toggle. |
| `GET /api/v1/tasks/:id` | Tenant-scoped; non-privileged access is limited. | Task detail with permission-aware errors. |
| `POST /api/v1/tasks` | All authenticated can create; non-privileged assignment/approval restrictions apply. | Restrict form options by user capability. |
| `PATCH /api/v1/tasks/:id` | Non-privileged updates are restricted. | Restrict reassignment/approval transitions in FE. |
| `DELETE /api/v1/tasks/:id` | Archive behavior (soft delete). | Use "Archive task" UX text. |

## 6.12 Summary

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/summary/stats` | Personal + permission-aware stats. | KPI cards. |
| `GET /api/v1/summary/todos` | Personal todo feed. | Todos panel. |
| `GET /api/v1/summary/tasks-to-approve` | Only approvers. | Approvals queue. |
| `POST /api/v1/summary/tasks-to-approve/process-batch` | Batch approve/reject with partial results. | Batch actions UI with per-item failure reporting. |
| `POST /api/v1/summary/tasks-to-approve/:id/approve` | Single task approval workflow. | Single-approve CTA. |
| `GET /api/v1/summary/provisions` | Daily operations data grouped by home. | Daily provisions view. |

## 6.13 Dashboard

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/dashboard/stats` | Dashboard KPI stats. | Dashboard header cards. |
| `GET /api/v1/dashboard/widgets` | User+tenant-scoped widgets. | Widget grid load. |
| `POST /api/v1/dashboard/widgets` | Create user widget configuration. | Widget create flow. |
| `DELETE /api/v1/dashboard/widgets/:id` | Scoped widget delete. | Delete CTA with 403/404 handling. |

## 6.14 Announcements

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/announcements` | Tenant announcements feed with read/unread support. | Announcement list. |
| `GET /api/v1/announcements/:id` | Read detail + read-state behavior. | Detail page/drawer. |
| `POST /api/v1/announcements/:id/read` | Idempotent read mark. | Quick mark-read action. |
| `POST /api/v1/announcements` | Write restricted to global `admin`. | Admin-only create composer. |
| `PATCH /api/v1/announcements/:id` | Write restricted to global `admin`. | Admin-only edit. |
| `DELETE /api/v1/announcements/:id` | Archive behavior. | Use "Archive" wording. |

## 6.15 AI

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `POST /api/v1/ai/ask` | Tenant-aware AI assistant with provider fallback. | Assistant panel with source badge (`model` or `fallback`). |
| `PATCH /api/v1/ai/access/:id` | Role-scoped AI access toggle. Allowed for global `admin`/`super_admin` and tenant role `tenant_admin`. | Admin user-management toggle for AI access. |

## 6.16 Audit and Security

| Endpoint | Business Decision / Logic | FE Contract |
|---|---|---|
| `GET /api/v1/audit` | Audit explorer with filters and tenant constraints. | Audit table + filters. |
| `GET /api/v1/audit/security-alerts` | Derived security alerts from audit stream. | Security alerts dashboard. |
| `GET /api/v1/audit/:id` | Single audit event detail. | Drilldown modal/page. |
| `POST /api/v1/audit/break-glass/access` | Super-admin emergency tenant access context. | Break-glass start flow with mandatory reason. |
| `POST /api/v1/audit/break-glass/release` | Release emergency context. | Break-glass release CTA. |

## 6.17 Integrations (Not a FE endpoint)

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
- Scoped service-level rules:
  - membership management
  - invite management
  - task approval and assignment restrictions
  - audit visibility boundaries

## 8. Error Code Playbook (FE Behavior)

Auth/session:

- `EMAIL_TAKEN` -> show duplicate email UI
- `OTP_INVALID` -> invalid/expired OTP message
- `OTP_COOLDOWN` -> countdown UI
- `INVALID_CREDENTIALS` -> login error
- `ACCOUNT_LOCKED` -> lockout message
- `ACCOUNT_INACTIVE` -> disabled account state
- `EMAIL_NOT_VERIFIED` -> route to verification
- `REFRESH_TOKEN_INVALID` -> force logout
- `TENANT_CONTEXT_REQUIRED` -> prompt tenant selection/onboarding
- `TENANT_ACCESS_DENIED` -> deny + offer tenant switch
- `MFA_REQUIRED` -> launch MFA flow
- `MFA_NOT_REQUIRED` -> hide MFA prompt if shown unnecessarily

Tenant/invite:

- `TENANT_SLUG_TAKEN`
- `TENANT_MEMBERSHIP_EXISTS`
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
- `POST /ai/ask` -> 20/min
- Public forms (`book-demo`, `join-waitlist`, `contact-us`) -> 10 per 10 minutes

## 10. FE Delivery Checklist

- [ ] API client supports bearer auth + refresh rotation + single retry
- [ ] Session store persists `session` object, not only token/user
- [ ] Tenant switcher implemented using `/auth/switch-tenant`
- [ ] Privileged MFA flow implemented (`challenge` -> `verify` -> retry)
- [ ] Turnstile widget integrated and token sent as `x-captcha-token`
- [ ] Public auth forms handle CAPTCHA-specific errors
- [ ] Role-based UI gating aligned with matrix above
- [ ] Task and approval UIs enforce non-privileged restrictions
- [ ] Invite lifecycle UI implemented (create/list/revoke/accept)
- [ ] Audit + security alerts views implemented for admin personas
- [ ] 400/422/429 error UX patterns standardized

