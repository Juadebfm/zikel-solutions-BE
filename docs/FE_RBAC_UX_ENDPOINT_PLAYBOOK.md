# FE RBAC, UX, and Endpoint Playbook

Last verified: 2026-03-24  
Backend source: `src/routes`, `src/modules/*`, middleware, Prisma schema, and shared schemas.

## Purpose

This document gives frontend teams a single implementation playbook for:

- RBAC and effective permissions
- UX behavior by persona
- Endpoint ownership by workflow
- Must-do rules for making calls safely and correctly

Use this as the handoff baseline for what to build next.

## 1) Roles and Access Model

### 1.1 Role Types

- Global roles: `super_admin`, `admin`, `manager`, `staff`
- Tenant roles: `tenant_admin`, `sub_admin`, `staff`

### 1.2 Important Runtime Concepts

- All operational data is tenant scoped. User must have an active tenant context.
- Access token includes tenant claims (`tenantId`, `tenantRole`) and MFA state (`mfaVerified`).
- Privileged sessions are:
  - global `super_admin`, or
  - tenant role `tenant_admin`

### 1.3 High-Level Capability Matrix

| Capability Area | super_admin | admin | manager | tenant_admin | sub_admin | staff |
|---|---|---|---|---|---|---|
| Tenant registry (`/tenants` root CRUD) | Yes | No | No | No | No | No |
| Tenant membership/invite management | Yes (all roles) | Scoped by tenant role | Scoped by tenant role | Yes (sub_admin/staff) | Yes (staff only) | No |
| Care groups CUD | Via global/tenant checks | Yes | No | Yes | No | No |
| Announcements CUD | Via global/tenant checks | Yes | No | Yes | No | No |
| Homes/employees/young-people CUD | Yes | Yes | Yes | Yes | Yes | No |
| Vehicles CUD | Yes | Yes | Yes | Yes | Yes | No |
| Task approve queue | Yes | Yes | Yes | Yes | Yes | No |
| Audit log/security-alert viewing | Yes | Yes | Yes | Yes | Yes | No |
| Break-glass access/release | Yes | No | No | No | No | No |
| AI ask | If user AI-enabled | If user AI-enabled | If user AI-enabled | If user AI-enabled | If user AI-enabled | If user AI-enabled |
| AI access toggle for user | Yes | Yes | No | Yes | No | No |

Notes:

- For tenant management endpoints, non-super-admin users are still constrained by active tenant membership and hierarchical role limits.
- Even if a global role is elevated, tenant-scoped actions still require valid tenant access.

## 2) Session Contract FE Must Persist

From successful auth responses, FE must persist:

- `data.user`
- `data.session.activeTenantId`
- `data.session.activeTenantRole`
- `data.session.memberships[]`
- `data.session.mfaRequired`
- `data.session.mfaVerified`
- `data.tokens.accessToken`
- `data.tokens.refreshToken` (when present)

Why it matters:

- Tenant context drives all tenant-scoped queries.
- MFA state controls whether write requests are allowed for privileged sessions.
- Token replacement rules differ across endpoints.

## 3) Must-Do Call Rules (Non-Negotiable)

1. Use `/api/v1/*` for app endpoints.
2. Send `Authorization: Bearer <accessToken>` on protected endpoints.
3. Send `Content-Type: application/json` for JSON bodies.
4. Keep active tenant context in app state and update it after `/auth/switch-tenant`.
5. On `401` from protected call:
   - Call `POST /api/v1/auth/refresh` once.
   - Replace both access and refresh tokens.
   - Retry original request once.
6. On `403` with code `MFA_REQUIRED`:
   - `POST /api/v1/auth/mfa/challenge`
   - `POST /api/v1/auth/mfa/verify`
   - Replace access token
   - Retry original write request once
7. Handle both validation families:
   - `400` validation from AJV
   - `422 VALIDATION_ERROR` from service Zod/business rules
8. Do not treat all `404` as deleted records; some are intentional isolation responses.
9. Read/write response envelope is always:
   - success: `{ success: true, data, meta? }`
   - failure: `{ success: false, error: { code, message, details? } }`
10. For invite acceptance, authenticated user email must match invite target email.

## 4) UX Flows by Persona

### 4.1 Care Home Owner (Public Signup)

Flow:

1. `POST /api/v1/auth/register`
2. `POST /api/v1/auth/verify-otp`
3. Store returned `user/session/tokens`
4. If `session.mfaRequired === true`, prompt MFA immediately for privileged write paths

UX expectations:

- User already has an organization and active tenant after OTP verify.
- No separate "create organization" step needed post-login.

### 4.2 Admin-Provisioned Staff Activation

Admin side:

1. `POST /api/v1/tenants/:id/staff` (creates invited staff + sends activation code)

Staff side:

1. `POST /api/v1/auth/staff-activate` with email + code + password
2. Store returned `user/session/tokens`

### 4.3 Invite-Link Self-Registration (Pending Approval)

Staff side:

1. `GET /api/v1/auth/join/:inviteCode` (validate link, fetch org/role info)
2. `POST /api/v1/auth/join/:inviteCode` (create account in `pending_approval`)
3. `POST /api/v1/auth/verify-otp`
4. Show "awaiting admin approval" state

Admin side:

1. `GET /api/v1/tenants/:id/memberships?status=pending_approval`
2. `PATCH /api/v1/tenants/:id/memberships/:membershipId` with `status=active`

### 4.4 Multi-Tenant Session Switching

1. Display tenant switcher when `session.memberships.length > 1`
2. `POST /api/v1/auth/switch-tenant`
3. Replace access token with returned token
4. Refresh tenant-scoped screens

### 4.5 Privileged MFA Gating Behavior

- Read routes are allowed pre-MFA.
- Mutating routes (`POST/PUT/PATCH/DELETE`) are blocked for privileged sessions until verified.
- Trigger MFA challenge/verify flow when `MFA_REQUIRED` is returned.

## 5) Endpoint Inventory by Domain

## 5.1 Public Endpoints (No Auth)

- `POST /api/v1/public/book-demo`
- `POST /api/v1/public/join-waitlist`
- `POST /api/v1/public/contact-us`
- `GET /health`
- `GET /ready`
- `GET /assets/white-logo.svg`

## 5.2 Auth and Session

- `POST /api/v1/auth/register`
- `GET /api/v1/auth/join/:inviteCode`
- `POST /api/v1/auth/join/:inviteCode`
- `POST /api/v1/auth/staff-activate`
- `GET /api/v1/auth/check-email`
- `POST /api/v1/auth/verify-otp`
- `POST /api/v1/auth/resend-otp`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/mfa/challenge` (auth required)
- `POST /api/v1/auth/mfa/verify` (auth required)
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/switch-tenant` (auth required)
- `POST /api/v1/auth/logout` (auth required)
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/auth/me` (auth required)

## 5.3 Profile and Preferences

- `GET /api/v1/me`
- `PATCH /api/v1/me`
- `POST /api/v1/me/change-password`
- `GET /api/v1/me/permissions`
- `GET /api/v1/me/preferences`
- `PATCH /api/v1/me/preferences`

## 5.4 Tenant and Membership Governance

Super-admin only:

- `GET /api/v1/tenants`
- `GET /api/v1/tenants/:id`
- `POST /api/v1/tenants`

Scoped tenant management:

- `GET /api/v1/tenants/:id/memberships`
- `POST /api/v1/tenants/:id/memberships`
- `PATCH /api/v1/tenants/:id/memberships/:membershipId`
- `POST /api/v1/tenants/:id/staff`
- `GET /api/v1/tenants/:id/invites`
- `POST /api/v1/tenants/:id/invites`
- `PATCH /api/v1/tenants/:id/invites/:inviteId/revoke`
- `POST /api/v1/tenants/:id/invite-link`
- `GET /api/v1/tenants/:id/invite-links`
- `PATCH /api/v1/tenants/:id/invite-links/:linkId/revoke`
- `POST /api/v1/tenants/invites/accept`

## 5.5 Operational Modules

Care groups:

- `GET /api/v1/care-groups`
- `GET /api/v1/care-groups/:id`
- `POST /api/v1/care-groups` (`admin` or `tenant_admin`)
- `PATCH /api/v1/care-groups/:id` (`admin` or `tenant_admin`)
- `DELETE /api/v1/care-groups/:id` (`admin` or `tenant_admin`)

Homes:

- `GET /api/v1/homes`
- `GET /api/v1/homes/:id`
- `POST/PATCH/DELETE /api/v1/homes/:id?` (`admin|manager|tenant_admin|sub_admin`)

Employees:

- `GET /api/v1/employees`
- `GET /api/v1/employees/:id`
- `POST/PATCH/DELETE /api/v1/employees/:id?` (`admin|manager|tenant_admin|sub_admin`)

Young people:

- `GET /api/v1/young-people`
- `GET /api/v1/young-people/:id`
- `POST/PATCH/DELETE /api/v1/young-people/:id?` (`admin|manager|tenant_admin|sub_admin`)

Vehicles:

- `GET /api/v1/vehicles`
- `GET /api/v1/vehicles/:id`
- `POST/PATCH/DELETE /api/v1/vehicles/:id?` (`super_admin|admin|manager|tenant_admin|sub_admin`)

Announcements:

- `GET /api/v1/announcements`
- `GET /api/v1/announcements/:id`
- `POST /api/v1/announcements/:id/read`
- `POST/PATCH/DELETE /api/v1/announcements/:id?` (`admin` or `tenant_admin`)

## 5.6 Tasks, Summary, Dashboard

Tasks (`/api/v1/tasks`):

- List/get/create/update/archive all require auth.
- Business rules for non-privileged users:
  - only own/assigned scope visible
  - can only self-assign
  - cannot freely mutate approval states

Summary:

- `GET /api/v1/summary/stats`
- `GET /api/v1/summary/todos`
- `GET /api/v1/summary/overdue-tasks`
- `GET /api/v1/summary/provisions`
- `GET /api/v1/summary/tasks-to-approve` (approver roles only)
  - default `scope=all`: full pending queue (including reviewed/non-overdue)
  - `scope=gate`: unreviewed overdue items (dashboard-blocking set)
  - `scope=popup`: unreviewed upcoming/undated items (non-blocking reminders)
- `GET /api/v1/summary/tasks-to-approve/:id` (approver roles only)
- `POST /api/v1/summary/tasks-to-approve/:id/review-events` (approver roles only)
- `POST /api/v1/summary/tasks-to-approve/process-batch` (approver roles only)
- `POST /api/v1/summary/tasks-to-approve/:id/approve` (approver roles only)
  - approve endpoints now accept optional `signatureFileId` for acknowledgement evidence

Uploads (`/api/v1/uploads`):

- `POST /api/v1/uploads/sessions` (create presigned PUT session)
- `POST /api/v1/uploads/:id/complete` (finalize upload)
- `GET /api/v1/uploads/:id/download-url` (signed read URL)

Dashboard:

- `GET /api/v1/dashboard/stats`
- `GET /api/v1/dashboard/widgets`
- `POST /api/v1/dashboard/widgets`
- `DELETE /api/v1/dashboard/widgets/:id` (user can only delete own widgets)

## 5.7 Audit and Security

- `GET /api/v1/audit`
- `GET /api/v1/audit/:id`
- `GET /api/v1/audit/security-alerts`
- `POST /api/v1/audit/break-glass/access` (super_admin only)
- `POST /api/v1/audit/break-glass/release` (super_admin only)

Critical note for FE:

- Super-admin must enter target tenant via break-glass before reading that tenant audit scope.

## 5.8 AI and Integrations

AI:

- `POST /api/v1/ai/ask` (user must have `aiAccessEnabled=true`)
- `PATCH /api/v1/ai/access/:id` (`super_admin|admin|tenant_admin`)

Integrations:

- `POST /api/v1/integrations/security-alerts/webhook` (signed integration endpoint)

## 6) FE Error Handling Map

Common error codes FE must branch on:

- `MFA_REQUIRED`: run MFA flow then retry write call
- `REFRESH_TOKEN_INVALID`: force logout
- `TENANT_CONTEXT_REQUIRED`: prompt tenant selection
- `TENANT_ACCESS_DENIED`: remove hidden tenant assumptions, block action
- `BREAK_GLASS_REQUIRED`: show super-admin support workflow
- `OTP_COOLDOWN`: disable resend UI until suggested retry
- `ACCOUNT_LOCKED`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_INACTIVE`: show explicit auth status screens

## 7) Implementation Checklist (Where to Continue)

1. Build a central API client with:
   - access token injection
   - one-time refresh retry
   - MFA-required retry path for writes
2. Build RBAC-aware UI guards from:
   - `session.role`, `session.tenantRole`, and `/api/v1/me/permissions`
3. Build tenant switcher using:
   - `session.memberships` + `/api/v1/auth/switch-tenant`
4. Complete tenant-admin workspace:
   - memberships
   - invites
   - staff provisioning
   - invite links
5. Complete approvals workspace:
   - pending queue list, detail, review-event capture, single approve, batch process
   - signature upload path:
     - create upload session
     - PUT file to presigned URL
     - complete upload
     - pass `signatureFileId` to `approve` or `process-batch`
   - respect backend review gate (`REVIEW_REQUIRED_BEFORE_ACKNOWLEDGE`) before approve/batch approve
   - dynamic form rendering from `renderPayload`
   - if present, render `renderPayload.referenceLinks[]` (document/task instruction links)
   - route by `category` first (`document` download flow, `task log` in-app navigation)
   - show reviewer name from `reviewedByCurrentUserName`

## 8) Reference Files

- `src/modules/auth/*`
- `src/modules/tenants/*`
- `src/modules/tasks/*`
- `src/modules/summary/*`
- `src/modules/audit/*`
- `src/middleware/rbac.ts`
- `src/middleware/mfa.ts`
- `src/lib/tenant-context.ts`
- `src/openapi/shared.schemas.ts`
