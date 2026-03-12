# FE Integration Blueprint (Backend-Verified)

Last updated from codebase: 2026-03-12
Source: `src/routes`, all `src/modules/*/{routes,service,schema}.ts`, `src/lib/tenant-context.ts`, `src/openapi/shared.schemas.ts`, `prisma/schema.prisma`, integration tests.

This document is the frontend implementation spec for the current backend behavior.

## 1. What FE Must Change (High Priority)

## 1.1 Session model must include tenant context

Current auth responses now include `session` in addition to `user` and `tokens`.

FE state must persist:

- `tokens.accessToken`
- `tokens.refreshToken` (except `switch-tenant`, which returns access token only)
- `session.activeTenantId`
- `session.activeTenantRole`
- `session.memberships[]`
- `session.mfaRequired`
- `session.mfaVerified`

If FE stores only `user + accessToken`, tenant-scoped modules will fail with `TENANT_CONTEXT_REQUIRED` / `TENANT_ACCESS_DENIED`.

## 1.2 Build a tenant switch UX

Required flow:

1. Read memberships from login/verify-otp/refresh response.
2. Let user pick tenant.
3. Call `POST /api/v1/auth/switch-tenant` with `{ tenantId }`.
4. Replace access token with returned token.
5. Keep current refresh token (switch endpoint does not rotate refresh token).
6. Refetch tenant-scoped data.

## 1.3 Add robust token refresh interceptor

Backend uses rotating refresh tokens.

Required behavior:

1. On protected request `401`, call `POST /api/v1/auth/refresh` once.
2. Replace both access and refresh tokens from response.
3. Retry original request once.
4. If refresh fails with `REFRESH_TOKEN_INVALID`, clear session and redirect to login.

## 1.4 Replace single-role UI assumptions

FE must support:

- Global roles: `super_admin`, `admin`, `manager`, `staff`
- Tenant roles: `tenant_admin`, `sub_admin`, `staff`

Some permissions are global-role based (route middleware), others tenant-role based (service logic).

## 1.5 Add cross-tenant-aware error handling

Backend intentionally returns `404` for many unauthorized cross-tenant object reads/writes.

Do not treat all 404s as “record deleted”; treat as “not found or not accessible in current tenant”.

## 1.6 Handle both validation error styles

You will see both:

- `400` with code like `FST_ERR_VALIDATION` (AJV/schema layer)
- `422` with code `VALIDATION_ERROR` (Zod custom/refine layer)

UI should map both to form validation surfaces.

## 1.7 Implement module-level permission gating in FE

Hide/disable action buttons based on endpoint reality:

- Some write routes require `admin` only.
- Some require `admin | manager`.
- Some include `super_admin` explicitly.
- Some use tenant-role business checks in service layer.

Exact matrix is below.

## 1.8 Respect rate limiting and cooldowns

Backend has global rate limit plus endpoint overrides.
Handle `429 RATE_LIMIT_EXCEEDED` and module-specific cooldown errors like `OTP_COOLDOWN`.

## 1.9 Implement privileged MFA challenge UX

For privileged sessions (`super_admin` or `tenant_admin`), protected routes can return `403 MFA_REQUIRED`.

Required flow:

1. User logs in (or refreshes/switches tenant) and receives session with `mfaRequired=true`, `mfaVerified=false`.
2. FE calls `POST /api/v1/auth/mfa/challenge`.
3. FE prompts for OTP and submits `POST /api/v1/auth/mfa/verify`.
4. FE replaces access token with returned access token (`mfaVerified=true` claim).
5. Retry blocked request once.

## 2. Global API Contract

## 2.1 Base URLs

- App API base: `/api/v1`
- Infra endpoints (no prefix):
  - `GET /health`
  - `GET /ready`
  - `GET /assets/white-logo.svg`

## 2.2 Required headers

- Public endpoints: `Content-Type: application/json`
- Protected endpoints: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`

Important CORS note:

- Allowed headers are only `Content-Type` and `Authorization`.
- Do not send custom headers from browser unless backend adds them.

## 2.3 Response envelope

Success:

```json
{ "success": true, "data": {}, "meta": {} }
```

Error:

```json
{ "success": false, "error": { "code": "...", "message": "...", "details": {} } }
```

## 2.4 Pagination contract

List endpoints typically return:

- `meta.total`
- `meta.page`
- `meta.pageSize`
- `meta.totalPages`

## 2.5 Common statuses and FE reaction

- `200` / `201`: success
- `400`: schema validation (AJV)
- `401`: missing/invalid/expired auth
- `403`: authenticated but forbidden
- `404`: missing or inaccessible resource
- `409`: conflict/state error
- `410`: expired invite
- `422`: business validation failure
- `429`: throttle/cooldown hit

## 2.6 Tenant isolation behavior

- Every domain model is tenant-scoped.
- Active tenant is resolved from current user context.
- Missing tenant context blocks access.
- Cross-tenant object operations generally respond with `404`.

## 3. Role and Access Matrix (Actual Backend Behavior)

## 3.1 Global-role-gated routes (middleware `requireRole`)

- `super_admin` only: platform tenant directory/provisioning core routes (`GET /tenants`, `GET /tenants/:id`, `POST /tenants`)
- `admin | super_admin`: `PATCH /api/v1/ai/access/:id`
- `admin` only: announcement writes, care-group writes
- `admin | manager`: home writes, employee writes, young-person writes
- `super_admin | admin | manager`: vehicle writes

Clarification:

- Tenant membership/invite routes are scoped by service-layer actor role checks (`super_admin`, `tenant_admin`, `sub_admin`) and are not super-admin-only.

## 3.2 Service-level permission checks (not only middleware)

- Tasks visibility and write ability depends on privileged actor rules in service layer.
- Summary approvals depend on `canApprove` (global role or tenant role).
- Tenant invite management depends on actor global + tenant role.
- Audit viewing depends on global role or tenant role.
- Break-glass is super-admin only.
- Most authenticated route groups enforce privileged MFA (`MFA_REQUIRED`) when token session is privileged and not yet verified.

## 4. Endpoint Map by Business Domain

All paths below are full paths.

## 4.1 Infrastructure

| Endpoint | Business Decision | FE Use |
|---|---|---|
| `GET /health` | Process liveness only. | Optional monitoring badge or environment check. |
| `GET /ready` | Includes DB readiness check. `503 NOT_READY` if DB unavailable. | Optional admin/ops panel check. |
| `GET /assets/white-logo.svg` | Public hosted asset for email-safe rendering. | Usually not needed by FE app. |

## 4.2 Auth and Session

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `POST /api/v1/auth/register` | Creates user with `emailVerified=false`; creates OTP; returns `otpDeliveryStatus` (`sent`,`queued`,`failed`) and `resendAvailableAt`. | Signup submit. Always branch UI by `otpDeliveryStatus`. Move to OTP screen even on `failed` and show resend path. |
| `GET /api/v1/auth/check-email?email=` | Email availability pre-check. | Use for live validation before register submit. |
| `POST /api/v1/auth/verify-otp` | Accepts `{email,code}` or legacy `{userId,code,purpose}`; marks OTP used; activates email; issues access+refresh tokens and session context. | OTP submit; on success treat as authenticated login. Store full session payload. |
| `POST /api/v1/auth/resend-otp` | Cooldown enforced (`60s`); old unused OTPs invalidated; returns status + cooldown fields. | OTP resend button with countdown using `cooldownSeconds` or `resendAvailableAt`. Handle `429 OTP_COOLDOWN`. |
| `POST /api/v1/auth/login` | Enforces lockout after failed attempts; blocks inactive/unverified accounts; issues token pair + session. | Standard login. Handle `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_INACTIVE`. |
| `POST /api/v1/auth/mfa/challenge` | Authenticated endpoint. Starts privileged-session MFA challenge and returns delivery/cooldown metadata. | Trigger when privileged route returns `MFA_REQUIRED` or proactively after login for privileged sessions. |
| `POST /api/v1/auth/mfa/verify` | Authenticated endpoint. Validates MFA OTP and returns new access token with `mfaVerified=true`. | MFA submit screen. Replace access token and continue pending action. |
| `POST /api/v1/auth/refresh` | Single-use refresh token rotation. Old refresh token revoked atomically. | Silent refresh in interceptor. Replace both tokens every refresh. |
| `POST /api/v1/auth/switch-tenant` | Requires auth. Validates active membership in target tenant. Updates active tenant and re-signs access token with tenant claims. | Tenant switcher action. Replace access token only. Refetch tenant-scoped data. |
| `POST /api/v1/auth/logout` | Revokes provided refresh token for current user; idempotent. | Send refresh token then clear local session. |
| `POST /api/v1/auth/forgot-password` | Anti-enumeration: always generic success message. Password reset OTP flow. | Always show same success state regardless of account existence. |
| `POST /api/v1/auth/reset-password` | Validates OTP; updates password; revokes all active refresh tokens. | After success force re-login from all devices UX messaging. |
| `GET /api/v1/auth/me` | Returns safe user profile (no tokens/session). | Lightweight user bootstrap if needed. |

Additional FE decisions for Auth:

- Password policy: min 12, upper/lower/number/special, no spaces.
- Register country allowed values: `UK`, `Nigeria`.
- OTP is 6 digits; expiry 10 minutes.
- Refresh expiry is env-configured (default `7d`).
- Access token expiry default is `15m`.
- For privileged sessions, MFA verification is token-bound. After login/refresh/switch-tenant, expect to re-challenge when `session.mfaRequired=true`.

## 4.3 Me Profile and Preferences

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/me` | Returns profile view incl. employee/home linkage in active tenant and `aiAccessEnabled`. | Main profile page and header identity panel. |
| `PATCH /api/v1/me` | Updates only editable fields (`firstName`,`lastName`,`phone`,`avatar`). | Profile edit form. Require at least one field. |
| `POST /api/v1/me/change-password` | Validates current password; blocks reuse; revokes all refresh tokens after change. | Password change form. After success, prompt re-authentication. |
| `GET /api/v1/me/permissions` | Returns computed capability booleans from global role. | Feature toggle map for FE screens/actions. |
| `GET /api/v1/me/preferences` | Returns language/timezone. | Preferences form initial load. |
| `PATCH /api/v1/me/preferences` | Updates language/timezone; at least one field required. | Preferences save action. |

## 4.4 Public Marketing Endpoints

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `POST /api/v1/public/book-demo` | Stores lead; async email confirmation; rate-limited 10/10min/IP. | Marketing form submit. Show optimistic success after 201. |
| `POST /api/v1/public/join-waitlist` | Stores waitlist entry; async confirmation email; rate-limited 10/10min/IP. | Waitlist form submit. |
| `POST /api/v1/public/contact-us` | Stores contact message; async confirmation email; rate-limited 10/10min/IP. | Contact form submit. |

`serviceOfInterest` enum values:

- `care_documentation_platform`
- `ai_staff_guidance`
- `training_development`
- `healthcare_workflow`
- `general_enquiry`

## 4.5 Tenants, Memberships, Invites

## 4.5.1 Platform tenant admin (super-admin)

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/tenants` | Super-admin only list with search/isActive pagination. | Platform admin tenant table. |
| `GET /api/v1/tenants/:id` | Super-admin only detail with memberships included. | Tenant detail page. |
| `POST /api/v1/tenants` | Super-admin provisions tenant; optional initial admin by `adminUserId` or `adminEmail` (not both). | Tenant creation wizard. Handle `TENANT_SLUG_TAKEN`, `USER_NOT_FOUND`. |

## 4.5.2 Tenant-scoped membership management

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `POST /api/v1/tenants/self-serve` | Authenticated self-serve onboarding. Creates a tenant and assigns current user as `tenant_admin`. Allowed only for eligible first-time org setup users. | “Create my organization” onboarding flow after account verification. |
| `GET /api/v1/tenants/:id/memberships` | Scoped by actor role. Super-admin sees all roles; tenant admin sees all roles in tenant; sub admin sees only `sub_admin` + `staff`. | Membership table must adapt visible rows by actor capability and handle empty-result vs forbidden cleanly. |
| `POST /api/v1/tenants/:id/memberships` | Scoped role-based add. Super-admin can add all roles; tenant admin can add `sub_admin|staff`; sub admin can add `staff`. | Add-member modal must role-filter selectable role options by actor role. |
| `PATCH /api/v1/tenants/:id/memberships/:membershipId` | Scoped role/status updates with manageability constraints. | Edit-member UX must disable forbidden role transitions. Handle `403` fallback from backend. |

## 4.5.3 Tenant-scoped invite management

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/tenants/:id/invites` | Auth required. Service checks actor can manage invites in tenant. Supports status filter. | Invite management list. Handle `TENANT_INVITE_FORBIDDEN`. |
| `POST /api/v1/tenants/:id/invites` | Tokenized invite creation. Returns raw `inviteToken` and also triggers backend invite email dispatch (best effort). | Create invite flow should show “email sent” status plus manual token copy fallback for recovery/resend support. |
| `PATCH /api/v1/tenants/:id/invites/:inviteId/revoke` | Scoped revoke with role permission checks. Accepted invites cannot be revoked. | Revoke action with state refresh. |
| `POST /api/v1/tenants/invites/accept` | Invite token acceptance by authenticated user; email must match invited email; sets membership active. | Invite acceptance page for logged-in user; handle expired/revoked/already accepted states. |

Invite-role permission business rules:

- Super-admin can invite `tenant_admin`, `sub_admin`, `staff`.
- Tenant admin can invite `sub_admin`, `staff`.
- Sub admin can invite `staff`.
- Others cannot manage invites.

Invite status model:

- `pending`, `accepted`, `revoked`, `expired`

## 4.6 Care Groups

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/care-groups` | Tenant-scoped list; search and active filter. | Care-group listing table. |
| `GET /api/v1/care-groups/:id` | Tenant-scoped read. Cross-tenant appears as not found. | Detail drawer/page. |
| `POST /api/v1/care-groups` | `admin` only. Unique `(tenantId,name)` enforced. | Create form for admin users only. |
| `PATCH /api/v1/care-groups/:id` | `admin` only. Partial update. | Edit form. |
| `DELETE /api/v1/care-groups/:id` | `admin` only. Soft delete (`isActive=false`). | Implement “Deactivate”, not hard remove semantics in UI. |

## 4.7 Homes

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/homes` | Tenant-scoped list; filters: careGroupId, isActive, search. | Homes table with filters. |
| `GET /api/v1/homes/:id` | Tenant-scoped read with care-group name included. | Home detail. |
| `POST /api/v1/homes` | `admin|manager` only. Care group must exist in same tenant. | Create form with care-group picker from tenant data only. |
| `PATCH /api/v1/homes/:id` | `admin|manager` only. Validates careGroup if changed. | Edit form. |
| `DELETE /api/v1/homes/:id` | `admin|manager` only. Soft delete (`isActive=false`). | Deactivate action. |

## 4.8 Employees

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/employees` | Tenant-scoped list; filters: homeId/isActive/search. | Employee list with filters. |
| `GET /api/v1/employees/:id` | Tenant-scoped read with linked user/home info. | Employee detail. |
| `POST /api/v1/employees` | `admin|manager` only. User must already have active membership in tenant. One employee per `(tenant,user)` unique. | Create flow must pick eligible tenant member user. |
| `PATCH /api/v1/employees/:id` | `admin|manager` only. Supports home unassign (`homeId=null`). | Edit form with optional unassign. |
| `DELETE /api/v1/employees/:id` | `admin|manager` only. Soft delete (`isActive=false`). | Deactivate action. |

## 4.9 Young People

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/young-people` | Tenant-scoped list with home/isActive/search filters. | List page with filters. |
| `GET /api/v1/young-people/:id` | Tenant-scoped read. | Detail page. |
| `POST /api/v1/young-people` | `admin|manager` only. Home must exist in tenant. Unique `(tenant,referenceNo)` enforced when reference present. | Create form. Handle duplicate reference conflicts. |
| `PATCH /api/v1/young-people/:id` | `admin|manager` only. Supports nullable `dateOfBirth` and `referenceNo`. | Edit form with clearable fields. |
| `DELETE /api/v1/young-people/:id` | `admin|manager` only. Soft delete (`isActive=false`). | Deactivate action. |

Date format decision:

- `dateOfBirth` uses date-only `YYYY-MM-DD`.

## 4.10 Vehicles

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/vehicles` | Tenant-scoped list with search/isActive/sort. | Vehicles table with server-side sort/filter. |
| `GET /api/v1/vehicles/:id` | Tenant-scoped read. | Detail page. |
| `POST /api/v1/vehicles` | `super_admin|admin|manager` only. Registration normalized uppercase; globally unique registration. | Create form. Normalize client-side for UX consistency. |
| `PATCH /api/v1/vehicles/:id` | Same roles. Partial update; nullable date fields supported. | Edit form with clear date controls. |
| `DELETE /api/v1/vehicles/:id` | Same roles. Soft delete (`isActive=false`). | Deactivate action. |

## 4.11 Tasks

Task rules are service-driven and role-sensitive.

Privileged actor is any of:

- Global role `super_admin`, `admin`, `manager`
- Tenant role `tenant_admin`, `sub_admin`

Non-privileged users are mostly self-scope.

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/tasks` | Tenant-scoped. If actor not privileged, auto-scoped to own/assigned tasks. Privileged users can request all; `mine=true` forces personal scope. | Task board/list must support filters and `mine` toggle. |
| `GET /api/v1/tasks/:id` | Tenant-scoped. Non-privileged can only access owned/assigned tasks. | Detail page with permission-aware loading behavior. |
| `POST /api/v1/tasks` | All authenticated can create. Non-privileged can only assign to self and limited approval statuses (`not_required`/`pending_approval`). | Create form should restrict assignee and approval options based on user privileges. |
| `PATCH /api/v1/tasks/:id` | Non-privileged may only edit owned/assigned tasks; cannot arbitrarily change approval status; reassignment restricted. Supports nullable relation fields. | Edit form must enforce these restrictions client-side and handle `403` fallback. |
| `DELETE /api/v1/tasks/:id` | Archive (soft delete via `deletedAt`). Non-privileged only for owned/assigned tasks. | Use destructive confirmation with “Archive task” wording; remove from active lists on success. |

Task enums:

- `status`: `pending`, `in_progress`, `completed`, `cancelled`
- `approvalStatus`: `not_required`, `pending_approval`, `approved`, `rejected`, `processing`
- `priority`: `low`, `medium`, `high`, `urgent`

## 4.12 Summary

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/summary/stats` | Personal KPI counts. `pendingApproval` is tenant-wide for approvers; otherwise scoped personal. `comments` = unread announcements count for current user. `rewards` = completed-task reward points (server-derived). | Top summary cards; do not hardcode comments/rewards placeholders anymore. |
| `GET /api/v1/summary/todos` | Personal to-do list with pagination/search/sort. | To-do panel data source. |
| `GET /api/v1/summary/tasks-to-approve` | Only users with approval permission. Returns pending approval tasks. | Approvals queue tab; hide for non-approvers. |
| `POST /api/v1/summary/tasks-to-approve/process-batch` | Batch approve/reject with partial success (`processed`, `failed[]`). | Batch action UX must show per-item failures. |
| `POST /api/v1/summary/tasks-to-approve/:id/approve` | Approve single pending task; stores approver/time/comment metadata. | Single approve CTA. Handle `INVALID_TASK_STATE`. |
| `GET /api/v1/summary/provisions` | Returns today’s events and shifts grouped by home. Approvers see all homes in tenant; others see own home only. | Daily operations view. |

Approval permission (`canApprove`) logic:

- true for global `super_admin`
- true for tenant roles `tenant_admin` or `sub_admin`
- true for global `manager` or `admin`
- false otherwise

## 4.13 Dashboard

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/dashboard/stats` | Reuses summary stats logic. | Dashboard header stats source. |
| `GET /api/v1/dashboard/widgets` | User + tenant scoped widget list. | Widget grid loader. |
| `POST /api/v1/dashboard/widgets` | Creates user-scoped widget config. | Widget create modal. |
| `DELETE /api/v1/dashboard/widgets/:id` | Returns `404` if missing or cross-tenant; `403` if same tenant but different owner. | Delete action should handle both not-found and forbidden distinctly. |

## 4.14 Announcements

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/announcements` | Returns tenant announcements that are published and not expired. Supports read/unread filter. | Feed list with unread filter and pin ordering. |
| `GET /api/v1/announcements/:id` | Returns one and marks it read. | Detail open should update unread badge immediately. |
| `POST /api/v1/announcements/:id/read` | Explicit idempotent mark-read endpoint. | Use for list interactions without opening detail. |
| `POST /api/v1/announcements` | `admin` only. Creates tenant announcement. | Admin announcement composer. |
| `PATCH /api/v1/announcements/:id` | `admin` only. Partial update with date-window checks. | Admin edit flow. |
| `DELETE /api/v1/announcements/:id` | `admin` only archive (soft delete via `deletedAt`; also unpins/expires item). | Admin action should be labeled “Archive announcement”; remove from active feed after success. |

Important: route middleware is `requireRole('admin')`; `super_admin` is not included here by route policy.

## 4.15 AI

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `POST /api/v1/ai/ask` | Requires tenant context and user `aiAccessEnabled=true`. Uses provider if enabled; otherwise safe fallback answer. Returns `source` (`model`/`fallback`) and `statsSource` (`client`/`server`/`none`). | AI assistant panel. Always display source badge; do not assume model call success. |
| `PATCH /api/v1/ai/access/:id` | `admin|super_admin` route guard. Non-super-admin actor can only target active users in same tenant membership. | AI access toggle control in user admin UI. |

FE prompt-context decision:

- You may send `context.stats`, `context.todos`, `context.tasksToApprove`.
- If omitted, backend computes stats.

## 4.16 Audit and Security

| Endpoint | Business Decision and Logic | FE Usage Contract |
|---|---|---|
| `GET /api/v1/audit` | Viewer-only endpoint. Supports filters by action/entity/user/date/search. Super-admin cross-tenant read requires break-glass active tenant alignment. Includes read events (`record_accessed`) and standardized metadata keys (e.g. `requestId`, `source`) on new records. | Audit log explorer with advanced filters; include `record_accessed` in action filter options. |
| `GET /api/v1/audit/security-alerts` | Derives alerts from recent audit events (`repeated_auth_failures`, `cross_tenant_attempts`, `admin_changes`, `break_glass_access`). | Security alerts widget/dashboard. |
| `GET /api/v1/audit/:id` | Fetch single audit log in scoped view. Optional `tenantId` query for super-admin with break-glass constraints. | Drilldown from audit list. |
| `POST /api/v1/audit/break-glass/access` | Super-admin only. Sets active tenant for emergency access and writes immutable-style audit metadata. | Super-admin emergency switch flow with mandatory reason capture. |
| `POST /api/v1/audit/break-glass/release` | Super-admin only. Releases active break-glass tenant context back to previous tenant (or null) and writes release audit metadata. | Provide explicit “Release break-glass” CTA in super-admin UX once incident work is done. |

## 5. Rate Limit Map (Endpoint Overrides)

Global default from env applies to all endpoints unless overridden.

Overrides:

- `POST /api/v1/auth/register`: 5/min
- `GET /api/v1/auth/check-email`: 20/min
- `POST /api/v1/auth/verify-otp`: 10/min
- `POST /api/v1/auth/resend-otp`: 5/min
- `POST /api/v1/auth/login`: 10/min
- `POST /api/v1/auth/mfa/challenge`: 5/min
- `POST /api/v1/auth/mfa/verify`: 10/min
- `POST /api/v1/auth/refresh`: 20/min
- `POST /api/v1/auth/forgot-password`: 5/min
- `POST /api/v1/auth/reset-password`: 5/min
- `POST /api/v1/me/change-password`: 5/min
- `POST /api/v1/ai/ask`: 20/min
- `POST /api/v1/public/book-demo`: 10 per 10 minutes
- `POST /api/v1/public/join-waitlist`: 10 per 10 minutes
- `POST /api/v1/public/contact-us`: 10 per 10 minutes
- `POST /api/v1/announcements/:id/read`: 30/min

## 6. FE Data Type and Serialization Rules

- `date-time` fields are ISO strings in responses.
- `youngPeople.dateOfBirth` is date-only.
- Some create/update schemas accept nullable fields for clear operations.
- Task, vehicle date inputs should be sent as ISO date-time when provided.
- Pagination defaults are usually `page=1`, `pageSize=20`.

## 7. Error Code Playbook for FE

Important backend codes to map to user-facing behavior:

- Auth:
  - `EMAIL_TAKEN`
  - `OTP_INVALID`
  - `OTP_COOLDOWN`
  - `INVALID_CREDENTIALS`
  - `ACCOUNT_LOCKED`
  - `ACCOUNT_INACTIVE`
  - `EMAIL_NOT_VERIFIED`
  - `REFRESH_TOKEN_INVALID`
  - `TENANT_ACCESS_DENIED`
  - `TENANT_CONTEXT_REQUIRED`
  - `MFA_REQUIRED`
  - `MFA_NOT_REQUIRED`
- Tenant/invite:
  - `TENANT_SLUG_TAKEN`
  - `TENANT_MEMBERSHIP_EXISTS`
  - `TENANT_INVITE_EXISTS`
  - `TENANT_INVITE_FORBIDDEN`
  - `TENANT_INVITE_NOT_FOUND`
  - `TENANT_INVITE_ALREADY_ACCEPTED`
  - `TENANT_INVITE_REVOKED`
  - `TENANT_INVITE_EXPIRED`
  - `TENANT_INVITE_EMAIL_MISMATCH`
- Domain:
  - `CARE_GROUP_NOT_FOUND`
  - `HOME_NOT_FOUND`
  - `EMPLOYEE_NOT_FOUND`
  - `YOUNG_PERSON_NOT_FOUND`
  - `VEHICLE_NOT_FOUND`
  - `VEHICLE_REGISTRATION_TAKEN`
  - `TASK_NOT_FOUND`
  - `TASK_ASSIGN_FORBIDDEN`
  - `TASK_APPROVAL_STATE_FORBIDDEN`
  - `INVALID_TASK_STATE`
  - `WIDGET_NOT_FOUND`
  - `ANNOUNCEMENT_NOT_FOUND`
- Audit/security:
  - `BREAK_GLASS_REQUIRED`
  - `FORBIDDEN`

And generic:

- `FST_ERR_VALIDATION` (400)
- `VALIDATION_ERROR` (422)
- `RATE_LIMIT_EXCEEDED` (429)

## 8. FE Implementation Sequence (Recommended)

1. Upgrade API client and session store for token rotation + tenant session context.
2. Implement tenant switcher and mandatory tenant selection flow.
3. Add privileged MFA challenge/verify flow and `MFA_REQUIRED` retry handling.
4. Refactor permission guard system to include global role + tenant role.
5. Update all CRUD screens to tenant-aware 404 semantics and archive wording for task/announcement deletes.
6. Implement tenant invite lifecycle UI (create/email-sent state/copy token/revoke/accept).
7. Integrate summary/tasks permission behaviors and server-calculated comments/rewards.
8. Integrate audit/security alert screens and break-glass access + release flow for super-admin.
9. Harden form handling for 400/422 dual validation style and 429 throttling UX.

## 9. Quick Endpoint Inventory (for FE routing map)

Infrastructure:

- `GET /health`
- `GET /ready`
- `GET /assets/white-logo.svg`

Auth:

- `POST /api/v1/auth/register`
- `GET /api/v1/auth/check-email`
- `POST /api/v1/auth/verify-otp`
- `POST /api/v1/auth/resend-otp`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/mfa/challenge`
- `POST /api/v1/auth/mfa/verify`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/switch-tenant`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/auth/me`

Me:

- `GET /api/v1/me`
- `PATCH /api/v1/me`
- `POST /api/v1/me/change-password`
- `GET /api/v1/me/permissions`
- `GET /api/v1/me/preferences`
- `PATCH /api/v1/me/preferences`

Public:

- `POST /api/v1/public/book-demo`
- `POST /api/v1/public/join-waitlist`
- `POST /api/v1/public/contact-us`

AI:

- `POST /api/v1/ai/ask`
- `PATCH /api/v1/ai/access/:id`

Announcements:

- `GET /api/v1/announcements`
- `GET /api/v1/announcements/:id`
- `POST /api/v1/announcements/:id/read`
- `POST /api/v1/announcements`
- `PATCH /api/v1/announcements/:id`
- `DELETE /api/v1/announcements/:id`

Summary:

- `GET /api/v1/summary/stats`
- `GET /api/v1/summary/todos`
- `GET /api/v1/summary/tasks-to-approve`
- `POST /api/v1/summary/tasks-to-approve/process-batch`
- `POST /api/v1/summary/tasks-to-approve/:id/approve`
- `GET /api/v1/summary/provisions`

Dashboard:

- `GET /api/v1/dashboard/stats`
- `GET /api/v1/dashboard/widgets`
- `POST /api/v1/dashboard/widgets`
- `DELETE /api/v1/dashboard/widgets/:id`

Tenants:

- `GET /api/v1/tenants`
- `GET /api/v1/tenants/:id`
- `POST /api/v1/tenants`
- `POST /api/v1/tenants/self-serve`
- `GET /api/v1/tenants/:id/memberships`
- `POST /api/v1/tenants/:id/memberships`
- `PATCH /api/v1/tenants/:id/memberships/:membershipId`
- `GET /api/v1/tenants/:id/invites`
- `POST /api/v1/tenants/:id/invites`
- `PATCH /api/v1/tenants/:id/invites/:inviteId/revoke`
- `POST /api/v1/tenants/invites/accept`

Care Groups:

- `GET /api/v1/care-groups`
- `GET /api/v1/care-groups/:id`
- `POST /api/v1/care-groups`
- `PATCH /api/v1/care-groups/:id`
- `DELETE /api/v1/care-groups/:id`

Homes:

- `GET /api/v1/homes`
- `GET /api/v1/homes/:id`
- `POST /api/v1/homes`
- `PATCH /api/v1/homes/:id`
- `DELETE /api/v1/homes/:id`

Employees:

- `GET /api/v1/employees`
- `GET /api/v1/employees/:id`
- `POST /api/v1/employees`
- `PATCH /api/v1/employees/:id`
- `DELETE /api/v1/employees/:id`

Young People:

- `GET /api/v1/young-people`
- `GET /api/v1/young-people/:id`
- `POST /api/v1/young-people`
- `PATCH /api/v1/young-people/:id`
- `DELETE /api/v1/young-people/:id`

Vehicles:

- `GET /api/v1/vehicles`
- `GET /api/v1/vehicles/:id`
- `POST /api/v1/vehicles`
- `PATCH /api/v1/vehicles/:id`
- `DELETE /api/v1/vehicles/:id`

Tasks:

- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:id`
- `POST /api/v1/tasks`
- `PATCH /api/v1/tasks/:id`
- `DELETE /api/v1/tasks/:id`

Audit:

- `GET /api/v1/audit`
- `GET /api/v1/audit/security-alerts`
- `GET /api/v1/audit/:id`
- `POST /api/v1/audit/break-glass/access`
- `POST /api/v1/audit/break-glass/release`
