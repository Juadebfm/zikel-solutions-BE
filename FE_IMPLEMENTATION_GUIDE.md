# Frontend API Implementation Guide (Live Backend)

This document is for frontend integration against the currently live backend.
It is based on the registered routes in this repository, not on planned endpoints.

## 1) Base URL and Prefix

- Base URL (production): your Render service URL, e.g. `https://<service>.onrender.com`
- API prefix: `/api/v1`
- Full API base: `https://<service>.onrender.com/api/v1`

Infrastructure endpoints (no `/api/v1` prefix):
- `GET /health`
- `GET /ready`

## 2) Headers

Public endpoints:
- `Content-Type: application/json`

Protected endpoints:
- `Content-Type: application/json`
- `Authorization: Bearer <accessToken>`

Optional:
- `x-request-id: <uuid>` (if omitted, backend generates one)

## 3) Response Envelope

Success:
```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Error:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Notes:
- `meta` is only present on paginated endpoints.
- Do not parse errors from plain text; always use `error.code` and `error.message`.

## 4) Auth and Token Flow

- Access token expiry: configured by `JWT_ACCESS_EXPIRY` (default `15m`)
- Refresh token expiry: configured by `JWT_REFRESH_EXPIRY` (default `7d`)
- Refresh token rotation is enforced. After a successful refresh, the old refresh token is invalid.

Recommended FE behavior:
1. On login/verify-otp/refresh, store both `accessToken` and `refreshToken`.
2. On `401` from protected endpoints, try one refresh call.
3. If refresh succeeds, retry original request once.
4. If refresh fails, clear session and redirect to login.

## 5) Error and Status Handling

Common statuses:
- `200` OK
- `201` Created
- `401` Invalid/missing auth or expired/invalid token
- `403` Authenticated but not allowed (RBAC)
- `404` Resource not found
- `409` Conflict/state error (duplicate or invalid workflow state)
- `422` Validation error
- `429` Rate limit/cooldown

Common codes:
- `VALIDATION_ERROR`
- `FORBIDDEN`
- `RATE_LIMIT_EXCEEDED`
- module-specific codes like `OTP_INVALID`, `EMAIL_TAKEN`, etc.

## 6) Endpoint Contracts

All routes below are relative to `/api/v1`.

### 6.1 Auth

#### POST `/auth/register` (public)
Body:
```json
{
  "country": "UK",
  "firstName": "John",
  "middleName": "K",
  "lastName": "Doe",
  "gender": "male",
  "email": "john@example.com",
  "phoneNumber": "07000000000",
  "password": "SecurePass1!",
  "confirmPassword": "SecurePass1!",
  "acceptTerms": true
}
```
Response `201`:
```json
{
  "success": true,
  "data": {
    "userId": "cuid",
    "message": "OTP sent to your email address."
  }
}
```

#### GET `/auth/check-email?email=user@example.com` (public)
Response `200`:
```json
{
  "success": true,
  "data": { "available": true }
}
```

#### POST `/auth/verify-otp` (public)
Accepted body format A:
```json
{ "email": "john@example.com", "code": "123456" }
```
Accepted body format B (legacy):
```json
{ "userId": "cuid", "code": "123456", "purpose": "email_verification" }
```
Response `200`:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "cuid",
      "email": "john@example.com",
      "role": "staff",
      "firstName": "John",
      "middleName": null,
      "lastName": "Doe",
      "gender": "male",
      "country": "UK",
      "phoneNumber": null,
      "avatarUrl": null,
      "language": "en",
      "timezone": "Europe/London",
      "emailVerified": true,
      "acceptedTerms": true,
      "isActive": true,
      "lastLoginAt": null,
      "createdAt": "2026-03-11T10:00:00.000Z",
      "updatedAt": "2026-03-11T10:00:00.000Z"
    },
    "tokens": {
      "accessToken": "<jwt>",
      "refreshToken": "<refresh-token>"
    }
  }
}
```

#### POST `/auth/resend-otp` (public)
Accepted body format A:
```json
{ "email": "john@example.com", "purpose": "email_verification" }
```
Accepted body format B (legacy):
```json
{ "userId": "cuid", "purpose": "password_reset" }
```
Response `200`:
```json
{
  "success": true,
  "data": {
    "message": "A new OTP has been sent to your email.",
    "cooldownSeconds": 60
  }
}
```

#### POST `/auth/login` (public)
Body:
```json
{ "email": "john@example.com", "password": "SecurePass1!" }
```
Response `200`: same shape as verify-otp auth response.

#### POST `/auth/refresh` (public)
Accepted body format A:
```json
{ "refreshToken": "<refresh-token>" }
```
Accepted body format B (legacy):
```json
{ "token": "<refresh-token>" }
```
Response `200`: same auth response shape with rotated refresh token.

#### POST `/auth/logout` (protected)
Body:
```json
{ "refreshToken": "<refresh-token>" }
```
Response `200`:
```json
{
  "success": true,
  "data": { "message": "Logged out successfully." }
}
```

#### POST `/auth/forgot-password` (public)
Body:
```json
{ "email": "john@example.com" }
```
Response `200` (always generic):
```json
{
  "success": true,
  "data": { "message": "If that email is registered, an OTP has been sent." }
}
```

#### POST `/auth/reset-password` (public)
Body:
```json
{
  "email": "john@example.com",
  "code": "123456",
  "newPassword": "NewSecurePass1!",
  "confirmPassword": "NewSecurePass1!"
}
```
Response `200`:
```json
{
  "success": true,
  "data": {
    "message": "Password reset successfully. Please log in with your new password."
  }
}
```

#### GET `/auth/me` (protected)
Response `200`: same `user` shape as auth response.

---

### 6.2 Me (all protected)

#### GET `/me`
Response `200`:
```json
{
  "success": true,
  "data": {
    "id": "cuid",
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "staff",
    "avatar": null,
    "homeId": "cuid",
    "homeName": "Sunrise House",
    "phone": null,
    "jobTitle": "Support Worker",
    "language": "en",
    "timezone": "Europe/London",
    "createdAt": "2026-03-11T10:00:00.000Z",
    "lastLoginAt": "2026-03-11T10:10:00.000Z"
  }
}
```

#### PATCH `/me`
Body (at least one field):
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "07000000000",
  "avatar": null
}
```
Response `200`: same shape as `GET /me`.

#### POST `/me/change-password`
Body:
```json
{
  "currentPassword": "OldSecure1!",
  "newPassword": "NewSecure1!",
  "confirmPassword": "NewSecure1!"
}
```
Response `200`:
```json
{ "success": true, "data": { "message": "Password updated." } }
```

#### GET `/me/permissions`
Response `200`:
```json
{
  "success": true,
  "data": {
    "canViewAllHomes": true,
    "canViewAllYoungPeople": true,
    "canViewAllEmployees": true,
    "canApproveIOILogs": true,
    "canManageUsers": false,
    "canManageSettings": false,
    "canViewReports": true,
    "canExportData": true
  }
}
```

#### GET `/me/preferences`
Response `200`:
```json
{ "success": true, "data": { "language": "en", "timezone": "Europe/London" } }
```

#### PATCH `/me/preferences`
Body (at least one field):
```json
{ "language": "en", "timezone": "Europe/London" }
```
Response `200`: same as get preferences.

---

### 6.3 Public (no auth)

All three endpoints are rate limited (`10 requests / 10 minutes / IP`).

Important enum update:
- `serviceOfInterest` now uses `care_documentation_platform`.
- Deprecated legacy values are removed and will return `422 VALIDATION_ERROR` if sent.

#### POST `/public/book-demo`
Body:
```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "organisationName": "Org Ltd",
  "rolePosition": "Manager",
  "phoneNumber": "07000000000",
  "serviceOfInterest": "care_documentation_platform",
  "numberOfStaffChildren": "20",
  "keyChallenges": "Challenge text",
  "message": "Message text",
  "source": "website"
}
```
Response `201`:
```json
{
  "success": true,
  "data": {
    "id": "cuid",
    "message": "Thanks for your interest! We'll be in touch shortly to arrange your demo."
  }
}
```

#### POST `/public/join-waitlist`
Body:
```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "organisation": "Org Ltd",
  "serviceOfInterest": "ai_staff_guidance",
  "source": "website"
}
```
Response `201`:
```json
{
  "success": true,
  "data": {
    "id": "cuid",
    "message": "You're on the list! We'll notify you as soon as we're ready for you."
  }
}
```

#### POST `/public/contact-us`
Body:
```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "phoneNumber": "07000000000",
  "serviceOfInterest": "general_enquiry",
  "message": "Message text",
  "source": "website"
}
```
Response `201`:
```json
{
  "success": true,
  "data": {
    "id": "cuid",
    "message": "Thanks for getting in touch! We'll get back to you shortly."
  }
}
```

`serviceOfInterest` allowed values:
- `care_documentation_platform`
- `ai_staff_guidance`
- `training_development`
- `healthcare_workflow`
- `general_enquiry`

---

### 6.4 Announcements (all protected)

#### GET `/announcements?status=unread&page=1&limit=20`
- `status`: optional `read | unread`
- `page`: default `1`
- `limit`: default `20`, max `100`

Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "title": "System update",
      "description": "Body text",
      "images": [],
      "startsAt": "2026-03-11T09:00:00.000Z",
      "endsAt": null,
      "isPinned": false,
      "status": "unread",
      "createdAt": "2026-03-11T09:00:00.000Z",
      "updatedAt": "2026-03-11T09:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "pageSize": 20, "totalPages": 1 }
}
```

#### GET `/announcements/:id`
- Marks announcement as read automatically.

Response `200`: same item shape as list.

#### POST `/announcements/:id/read`
Response `200`:
```json
{ "success": true, "data": { "message": "Announcement marked as read." } }
```

#### POST `/announcements` (admin only)
Body:
```json
{
  "title": "Title",
  "description": "Body text",
  "images": ["https://..."],
  "startsAt": "2026-03-11T09:00:00.000Z",
  "endsAt": "2026-03-12T09:00:00.000Z",
  "isPinned": false
}
```
Response `201`: announcement item shape.

#### PATCH `/announcements/:id` (admin only)
Body: any subset of create fields (at least one field).
Response `200`: announcement item shape.

#### DELETE `/announcements/:id` (admin only)
Response `200`:
```json
{ "success": true, "data": { "message": "Announcement deleted." } }
```

---

### 6.5 Summary (all protected)

#### GET `/summary/stats`
Response `200`:
```json
{
  "success": true,
  "data": {
    "overdue": 3,
    "dueToday": 4,
    "pendingApproval": 2,
    "rejected": 1,
    "draft": 0,
    "future": 5,
    "comments": 0,
    "rewards": 0
  }
}
```

#### GET `/summary/todos?page=1&pageSize=20&sortBy=dueDate&sortOrder=asc&search=foo`
Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "title": "Task title",
      "relation": "Liam Carter",
      "status": "pending",
      "approvalStatus": "not_required",
      "priority": "medium",
      "assignee": "Noah North",
      "dueDate": "2026-03-11T16:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "pageSize": 20, "totalPages": 1 }
}
```

#### GET `/summary/tasks-to-approve?page=1&pageSize=20`
- Manager/admin only (otherwise `403 FORBIDDEN`).
Response `200`: `{ success, data: Task[], meta }`

#### POST `/summary/tasks-to-approve/process-batch`
Body:
```json
{
  "taskIds": ["taskId1", "taskId2"],
  "action": "approve",
  "rejectionReason": "optional when action=reject"
}
```
Response `200`:
```json
{
  "success": true,
  "data": {
    "processed": 2,
    "failed": []
  }
}
```

#### POST `/summary/tasks-to-approve/:id/approve`
Body:
```json
{ "comment": "optional comment" }
```
Response `200`: `{ success, data: Task }`

#### GET `/summary/provisions`
Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "homeId": "cuid",
      "homeName": "Sunrise House",
      "events": [
        {
          "id": "cuid",
          "title": "Morning Provision Planning",
          "time": "2026-03-11T09:00:00.000Z",
          "description": "Daily support planning"
        }
      ],
      "shifts": [
        {
          "employeeId": "cuid",
          "employeeName": "Noah North",
          "startTime": "2026-03-11T07:00:00.000Z",
          "endTime": "2026-03-11T15:00:00.000Z"
        }
      ]
    }
  ]
}
```

---

### 6.6 Dashboard (all protected)

#### GET `/dashboard/stats`
Response `200`: same as `/summary/stats`.

#### GET `/dashboard/widgets`
Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "userId": "cuid",
      "title": "My Tasks This Month",
      "period": "this_month",
      "reportsOn": "tasks",
      "createdAt": "2026-03-11T09:00:00.000Z",
      "updatedAt": "2026-03-11T09:00:00.000Z"
    }
  ]
}
```

#### POST `/dashboard/widgets`
Body:
```json
{
  "title": "My Tasks This Month",
  "period": "this_month",
  "reportsOn": "tasks"
}
```
`period`: `last_7_days | last_30_days | this_month | this_year | all_time`  
`reportsOn`: `tasks | approvals | young_people | employees`

Response `201`: created widget object.

#### DELETE `/dashboard/widgets/:id`
Response `200`:
```json
{ "success": true, "data": { "message": "Widget deleted." } }
```

---

### 6.7 Care Groups (all protected)

#### GET `/care-groups?page=1&pageSize=20&search=&isActive=true`
Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "name": "Northern Region",
      "description": "Care homes in the northern region",
      "isActive": true,
      "createdAt": "2026-03-11T09:00:00.000Z",
      "updatedAt": "2026-03-11T09:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "pageSize": 20, "totalPages": 1 }
}
```

#### GET `/care-groups/:id`
Response `200`: care group object above.

#### POST `/care-groups` (admin only)
Body:
```json
{ "name": "Northern Region", "description": "optional" }
```
Response `201`: created care group.

#### PATCH `/care-groups/:id` (admin only)
Body (at least one):
```json
{
  "name": "New name",
  "description": null,
  "isActive": true
}
```
Response `200`: updated care group.

#### DELETE `/care-groups/:id` (admin only)
Soft-deletes (sets inactive).  
Response `200`:
```json
{ "success": true, "data": { "message": "Care group deactivated." } }
```

---

### 6.8 Homes (all protected)

#### GET `/homes?page=1&pageSize=20&search=&careGroupId=&isActive=true`
Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "careGroupId": "cuid",
      "careGroupName": "Northern Region",
      "name": "Sunrise House",
      "address": "1 Sunrise Road",
      "capacity": 6,
      "isActive": true,
      "createdAt": "2026-03-11T09:00:00.000Z",
      "updatedAt": "2026-03-11T09:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "pageSize": 20, "totalPages": 1 }
}
```

#### GET `/homes/:id`
Response `200`: home object above.

#### POST `/homes` (admin/manager)
Body:
```json
{
  "careGroupId": "cuid",
  "name": "Sunrise House",
  "address": "1 Sunrise Road",
  "capacity": 6
}
```
Response `201`: created home.

#### PATCH `/homes/:id` (admin/manager)
Body (at least one):
```json
{
  "careGroupId": "cuid",
  "name": "Updated Home",
  "address": null,
  "capacity": null,
  "isActive": true
}
```
Response `200`: updated home.

#### DELETE `/homes/:id` (admin/manager)
Soft delete.  
Response `200`:
```json
{ "success": true, "data": { "message": "Home deactivated." } }
```

---

### 6.9 Employees (all protected)

#### GET `/employees?page=1&pageSize=20&search=&homeId=&isActive=true`
Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "userId": "cuid",
      "user": {
        "id": "cuid",
        "email": "staff@zikel.dev",
        "firstName": "Noah",
        "lastName": "North",
        "role": "staff"
      },
      "homeId": "cuid",
      "homeName": "Sunrise House",
      "jobTitle": "Support Worker",
      "startDate": "2026-01-15T09:00:00.000Z",
      "isActive": true,
      "createdAt": "2026-03-11T09:00:00.000Z",
      "updatedAt": "2026-03-11T09:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "pageSize": 20, "totalPages": 1 }
}
```

#### GET `/employees/:id`
Response `200`: employee object above.

#### POST `/employees` (admin/manager)
Body:
```json
{
  "userId": "cuid",
  "homeId": "cuid",
  "jobTitle": "Support Worker",
  "startDate": "2026-01-15T09:00:00.000Z",
  "isActive": true
}
```
Response `201`: created employee.

#### PATCH `/employees/:id` (admin/manager)
Body (at least one):
```json
{
  "homeId": null,
  "jobTitle": null,
  "startDate": null,
  "isActive": true
}
```
Response `200`: updated employee.

#### DELETE `/employees/:id` (admin/manager)
Soft delete.  
Response `200`:
```json
{ "success": true, "data": { "message": "Employee deactivated." } }
```

---

### 6.10 Young People (all protected)

#### GET `/young-people?page=1&pageSize=20&search=&homeId=&isActive=true`
Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "id": "cuid",
      "homeId": "cuid",
      "homeName": "Sunrise House",
      "firstName": "Liam",
      "lastName": "Carter",
      "dateOfBirth": "2010-03-15",
      "referenceNo": "YP-NORTH-001",
      "isActive": true,
      "createdAt": "2026-03-11T09:00:00.000Z",
      "updatedAt": "2026-03-11T09:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "page": 1, "pageSize": 20, "totalPages": 1 }
}
```

#### GET `/young-people/:id`
Response `200`: young person object above.

#### POST `/young-people` (admin/manager)
Body:
```json
{
  "homeId": "cuid",
  "firstName": "Liam",
  "lastName": "Carter",
  "dateOfBirth": "2010-03-15",
  "referenceNo": "YP-NORTH-001"
}
```
Response `201`: created young person.

#### PATCH `/young-people/:id` (admin/manager)
Body (at least one):
```json
{
  "homeId": "cuid",
  "firstName": "Liam",
  "lastName": "Carter",
  "dateOfBirth": null,
  "referenceNo": null,
  "isActive": true
}
```
Response `200`: updated young person.

#### DELETE `/young-people/:id` (admin/manager)
Soft delete.  
Response `200`:
```json
{ "success": true, "data": { "message": "Young person deactivated." } }
```

## 7) FE Do and Don't

### Do
- Use `Authorization: Bearer <accessToken>` on all protected routes.
- Implement single-refresh retry logic on `401`.
- Use `pageSize` on most list endpoints.
- Use `limit` (not `pageSize`) on `/announcements`.
- Send ISO date-time where required (e.g. employee `startDate`), and `YYYY-MM-DD` for young person `dateOfBirth`.
- Send `serviceOfInterest: "care_documentation_platform"` for digital documentation/demo use cases.
- Treat `403` as authorization (role/permission), not token expiry.
- Handle `422` by displaying backend validation message to user.
- Expect some "delete" endpoints to be soft-delete (record becomes inactive).

### Don't
- Do not call endpoints listed in `needed.md` that are not implemented here.
- Do not send extra unexpected fields (`additionalProperties: false` is enforced on many bodies).
- Do not keep using an old refresh token after `/auth/refresh` success.
- Do not assume `/announcements/:id` is read-only; it marks as read by design.
- Do not send deprecated `serviceOfInterest` values.
- Do not rely on public endpoint email delivery status for success; DB persistence is the success signal.

## 8) Quick FE Types (optional)

```ts
export type ApiSuccess<T> = { success: true; data: T; meta?: { total: number; page: number; pageSize: number; totalPages: number } };
export type ApiError = { success: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
```

## 9) Live Route Scope

Implemented modules in this backend right now:
- auth
- me
- public
- announcements
- summary
- dashboard
- care-groups
- homes
- employees
- young-people

Not registered yet (planned): vehicles/tasks/audit and other future modules.
