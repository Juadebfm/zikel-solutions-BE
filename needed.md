# zikel-solutions — Required Backend Endpoints

**Project:** zikel-solutions (Therapeutic Operating System)
**Type:** SaaS platform for therapeutic documentation in children's homes
**Stack:** Next.js frontend (App Router) — currently 100% mock data, no real API calls
**Auth pattern:** JWT token, stored client-side, 24-hour expiry
**Role system:** `staff` | `manager` | `admin`

---

## Conventions

- All endpoints are prefixed with `/api/v1`
- All protected endpoints require `Authorization: Bearer <token>` header
- Paginated lists accept `?page=1&limit=20` query params
- Timestamps: ISO 8601 (`2024-01-15T09:00:00Z`)
- Dates (display): `DD/MM/YYYY`
- **MVP Scope Rule:** Every endpoint in this document is MVP-required. No module is deferred to Phase 2 or later.

---

## 1. Authentication

These are the first endpoints needed — every other module depends on a valid session.

### 1.1 Login
```
POST /api/v1/auth/login
```
**Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass1!",
  "rememberMe": true
}
```
**Response:**
```json
{
  "success": true,
  "token": "<jwt>",
  "user": {
    "id": "user-1",
    "email": "user@example.com",
    "firstName": "Sarah",
    "lastName": "Johnson",
    "role": "manager",
    "avatar": null,
    "homeId": "home-1",
    "homeName": "The Homeland",
    "phone": "+44...",
    "jobTitle": "Care Manager",
    "createdAt": "2023-01-15T09:00:00Z",
    "lastLoginAt": "2024-01-10T08:30:00Z"
  }
}
```
**Errors:** `401` invalid credentials, `403` account inactive

---

### 1.2 Register / Signup
```
POST /api/v1/auth/register
```
**Body:**
```json
{
  "country": "UK",
  "firstName": "John",
  "middleName": "",
  "surname": "Doe",
  "gender": "male",
  "email": "john.doe@example.com",
  "phone": "07700900000",
  "phoneCountryCode": "+44",
  "password": "SecurePass1!",
  "acceptTerms": true,
  "acceptMarketing": false
}
```
**Response:**
```json
{
  "success": true,
  "message": "Account created. Verification email sent.",
  "userId": "user-2"
}
```
**Notes:** Creates account in unverified state. Automatically triggers OTP email.
**Errors:** `409` email already registered

---

### 1.3 Check Email Availability
```
GET /api/v1/auth/check-email?email=user@example.com
```
**Response:**
```json
{ "available": true }
```
**Notes:** Called during signup Step 2 to validate uniqueness before user proceeds.

---

### 1.4 Verify OTP (Email Verification)
```
POST /api/v1/auth/verify-otp
```
**Body:**
```json
{
  "email": "john.doe@example.com",
  "code": "123456"
}
```
**Response:**
```json
{
  "success": true,
  "token": "<jwt>",
  "user": { ...userObject }
}
```
**Notes:** On success, auto-logs the user in (returns token). Code expires after 10 minutes.
**Errors:** `400` invalid/expired code

---

### 1.5 Resend OTP
```
POST /api/v1/auth/resend-otp
```
**Body:**
```json
{ "email": "john.doe@example.com" }
```
**Response:**
```json
{ "success": true, "message": "Verification code resent." }
```

---

### 1.6 Forgot Password — Request Reset
```
POST /api/v1/auth/forgot-password
```
**Body:**
```json
{ "email": "user@example.com" }
```
**Response:**
```json
{ "success": true, "message": "Reset link sent if account exists." }
```
**Notes:** Always returns success to prevent email enumeration.

---

### 1.7 Forgot Password — Reset
```
POST /api/v1/auth/reset-password
```
**Body:**
```json
{
  "token": "<reset-token-from-email>",
  "password": "NewSecurePass1!",
  "confirmPassword": "NewSecurePass1!"
}
```
**Response:**
```json
{ "success": true, "message": "Password updated." }
```

---

### 1.8 Refresh Token
```
POST /api/v1/auth/refresh
```
**Body:**
```json
{ "token": "<current-jwt>" }
```
**Response:**
```json
{ "token": "<new-jwt>", "expiresAt": "2024-01-16T09:00:00Z" }
```

---

### 1.9 Logout
```
POST /api/v1/auth/logout
```
**Headers:** `Authorization: Bearer <token>`
**Response:** `204 No Content`
**Notes:** Invalidates token server-side (add to blocklist).

---

## 2. Current User (Me)

These endpoints serve the logged-in user's own profile and settings — loaded immediately after auth on every dashboard page.

### 2.1 Get My Profile
```
GET /api/v1/me
```
**Response:** Full `User` object (same shape as login response user field).

---

### 2.2 Update My Profile
```
PATCH /api/v1/me
```
**Body (partial):**
```json
{
  "firstName": "Sarah",
  "lastName": "Johnson",
  "phone": "+447700900001",
  "avatar": "<base64 or upload URL>"
}
```

---

### 2.3 Change My Password
```
POST /api/v1/me/change-password
```
**Body:**
```json
{
  "currentPassword": "OldPass1!",
  "newPassword": "NewPass1!",
  "confirmPassword": "NewPass1!"
}
```

---

### 2.4 Get My Permissions
```
GET /api/v1/me/permissions
```
**Response:**
```json
{
  "canViewAllHomes": true,
  "canViewAllYoungPeople": true,
  "canViewAllEmployees": true,
  "canApproveIOILogs": true,
  "canManageUsers": false,
  "canManageSettings": false,
  "canViewReports": true,
  "canExportData": true
}
```

---

### 2.5 Get My Language Preference
```
GET /api/v1/me/preferences
```
**Response:**
```json
{ "language": "en", "timezone": "Europe/London" }
```

### 2.6 Update My Preferences
```
PATCH /api/v1/me/preferences
```
**Body:**
```json
{ "language": "fr", "timezone": "Europe/Paris" }
```

---

## 3. My Summary

The landing page after login — shows personalised task stats and a snapshot of the user's workload.

### 3.1 Get My Summary Stats
```
GET /api/v1/me/summary
```
**Response:**
```json
{
  "overdue": 3,
  "dueToday": 7,
  "pendingApproval": 12,
  "rejected": 2,
  "draft": 5,
  "future": 18,
  "comments": 4,
  "rewards": 6
}
```
**Notes:** Counts are scoped to the authenticated user's assignments and role visibility.

---

### 3.2 Get My Recent Tasks
```
GET /api/v1/me/tasks?status=overdue&limit=10
```
**Response:** Paginated list of `Task` objects assigned to the current user.

---

## 4. My Dashboard (Widgets)

The personal dashboard with configurable widgets (charts, tables, stat cards).

### 4.1 Get My Dashboard Widgets
```
GET /api/v1/me/dashboard/widgets
```
**Response:**
```json
[
  {
    "id": "widget-1",
    "type": "data-card",
    "title": "Tasks Overdue",
    "position": 0,
    "config": { "statKey": "overdue", "color": "red" }
  },
  {
    "id": "widget-2",
    "type": "pie-chart",
    "title": "Task Status Distribution",
    "position": 1,
    "config": {}
  }
]
```
**Widget types:** `data-card` | `pie-chart` | `bar-chart` | `line-chart` | `table`

---

### 4.2 Save / Update My Dashboard Widgets
```
PUT /api/v1/me/dashboard/widgets
```
**Body:** Full array of widget objects (replaces current configuration).

---

### 4.3 Get Widget Data
```
GET /api/v1/me/dashboard/widgets/:widgetId/data
```
**Notes:** Returns the resolved data for a specific widget (chart data, table rows, etc). Params depend on `config`.

---

## 5. Announcements

System-wide announcements displayed on every page. Users can mark them read.

### 5.1 List Announcements
```
GET /api/v1/announcements?status=unread&page=1&limit=20
```
**Query params:** `status` (`read` | `unread` | all)
**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "title": "System Maintenance Tonight",
      "description": "The system will be unavailable...",
      "images": ["https://..."],
      "startsAt": "2024-01-15T22:00:00Z",
      "endsAt": "2024-01-16T02:00:00Z",
      "status": "unread"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

---

### 5.2 Get Single Announcement
```
GET /api/v1/announcements/:id
```
**Notes:** Automatically marks as read for the current user on fetch.

---

### 5.3 Mark Announcement as Read
```
POST /api/v1/announcements/:id/read
```
**Response:** `204 No Content`

---

### 5.4 Create Announcement (Admin only)
```
POST /api/v1/announcements
```
**Body:**
```json
{
  "title": "New Policy Update",
  "description": "...",
  "images": [],
  "startsAt": "2024-01-20T09:00:00Z",
  "endsAt": "2024-01-27T09:00:00Z"
}
```

---

### 5.5 Update Announcement (Admin only)
```
PATCH /api/v1/announcements/:id
```

### 5.6 Delete Announcement (Admin only)
```
DELETE /api/v1/announcements/:id
```

---

## 6. Care Groups

Top-level organisational unit. Each care group contains multiple homes.

### 6.1 List Care Groups
```
GET /api/v1/care-groups?page=1&limit=20&search=&type=
```
**Query params:** `type` (`private` | `public` | `charity`), `search` (name)
**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "name": "Bright Futures Care",
      "type": "private",
      "phoneNumber": "+44...",
      "email": "admin@brightfutures.com",
      "faxNumber": "",
      "description": "...",
      "website": "https://...",
      "defaultUserIpRestriction": false,
      "homes": ["home-1", "home-2"],
      "manager": "John Smith",
      "lastUpdated": "2024-01-10T09:00:00Z",
      "lastUpdatedBy": "Admin User",
      "contact": "Jane Doe",
      "addressLine1": "123 Care St",
      "addressLine2": "",
      "city": "London",
      "countryRegion": "England",
      "postcode": "EC1A 1BB",
      "twilioSid": null,
      "twilioToken": null,
      "twilioPhoneNumber": null
    }
  ],
  "total": 23,
  "page": 1,
  "limit": 20
}
```

---

### 6.2 Get Single Care Group
```
GET /api/v1/care-groups/:id
```

---

### 6.3 Create Care Group (Admin only)
```
POST /api/v1/care-groups
```
**Body:** Full `CareGroup` object minus `id`, `lastUpdated`, `lastUpdatedBy`.

---

### 6.4 Update Care Group (Admin only)
```
PATCH /api/v1/care-groups/:id
```

---

### 6.5 Delete Care Group (Admin only)
```
DELETE /api/v1/care-groups/:id
```

---

### 6.6 Get Care Group Homes
```
GET /api/v1/care-groups/:id/homes?status=current
```
**Query params:** `status` (`current` | `past` | `planned`)
**Response:** List of `CareGroupHome` objects.

---

### 6.7 Get Care Group Stakeholders
```
GET /api/v1/care-groups/:id/stakeholders
```
**Response:**
```json
[
  {
    "id": 1,
    "name": "Jane Doe",
    "position": "Director",
    "responsibleIndividual": true,
    "startDate": "2020-01-01",
    "endDate": null,
    "userId": "user-5"
  }
]
```

---

### 6.8 Add Stakeholder to Care Group
```
POST /api/v1/care-groups/:id/stakeholders
```
**Body:**
```json
{
  "name": "Jane Doe",
  "position": "Director",
  "responsibleIndividual": true,
  "startDate": "2024-01-01",
  "userId": "user-5"
}
```

---

### 6.9 Update Stakeholder
```
PATCH /api/v1/care-groups/:careGroupId/stakeholders/:stakeholderId
```

### 6.10 Remove Stakeholder
```
DELETE /api/v1/care-groups/:careGroupId/stakeholders/:stakeholderId
```

---

### 6.11 Get Care Group Settings
```
GET /api/v1/care-groups/:id/settings
```
**Notes:** Returns Twilio config, IP restriction defaults, notification settings.

### 6.12 Update Care Group Settings
```
PATCH /api/v1/care-groups/:id/settings
```
**Body:**
```json
{
  "defaultUserIpRestriction": true,
  "twilioSid": "ACXXX",
  "twilioToken": "auth_token",
  "twilioPhoneNumber": "+1..."
}
```

---

## 7. Homes

Individual care home / facility. Each home belongs to a care group.

### 7.1 List Homes
```
GET /api/v1/homes?page=1&limit=20&search=&status=active&careGroupId=
```
**Response:**
```json
{
  "data": [
    {
      "id": "home-1",
      "name": "The Homeland",
      "address": "45 Oak Street, London, EC1A 1BB",
      "capacity": 6,
      "currentOccupancy": 4,
      "manager": "Sarah Johnson",
      "phone": "+44 20 1234 5678",
      "status": "active",
      "careGroupId": 1
    }
  ],
  "total": 8,
  "page": 1,
  "limit": 20
}
```

---

### 7.2 Get Single Home
```
GET /api/v1/homes/:id
```

### 7.3 Create Home (Admin only)
```
POST /api/v1/homes
```

### 7.4 Update Home
```
PATCH /api/v1/homes/:id
```

### 7.5 Delete Home (Admin only)
```
DELETE /api/v1/homes/:id
```

---

### 7.6 Get Home Settings
```
GET /api/v1/homes/:id/settings?category=
```
**Query params:** `category` — one of:
`reg-report-types` | `medication-stock-types` | `medication-stock-categories` | `shift-types` | `custom-information-groups` | `custom-information-fields` | `file-categories`

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "name": "Daily Report",
      "systemGenerated": true,
      "hidden": false,
      "createdBy": "Admin",
      "createdAt": "2023-01-01T00:00:00Z",
      "updatedOn": "2024-01-01T00:00:00Z",
      "updatedBy": "Admin",
      "category": "reg-report-types",
      "sortOrder": 1
    }
  ]
}
```

### 7.7 Create Home Setting Item
```
POST /api/v1/homes/:id/settings
```

### 7.8 Update Home Setting Item
```
PATCH /api/v1/homes/:homeId/settings/:itemId
```

### 7.9 Delete Home Setting Item
```
DELETE /api/v1/homes/:homeId/settings/:itemId
```

---

### 7.10 Get Home Audit Log
```
GET /api/v1/homes/:id/audit?category=&page=1&limit=20
```
**Query params:** `category` — one of:
`medication-locations` | `medication-stocks` | `medication-stock-audits` | `medication-stock-types` | `medication-stock-categories` | `regulatory-reports` | `regulatory-report-types` | `regulatory-report-type-sections` | `regulatory-report-values`

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "event": "Update",
      "createdBy": "Sarah Johnson",
      "createdAt": "2024-01-10T09:00:00Z",
      "category": "medication-stocks",
      "before": [{ "field": "quantity", "value": "10" }],
      "after": [{ "field": "quantity", "value": "8" }]
    }
  ],
  "total": 45
}
```

---

## 8. Young People (Residents)

Core entity — each child/young adult placed in a home.

### 8.1 List Young People
```
GET /api/v1/young-people?page=1&limit=20&search=&status=current&homeId=&type=
```
**Query params:** `status` (`current` | `past` | `planned`), `type` (`child` | `young-adult`), `homeId`
**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "firstName": "James",
      "lastName": "Wilson",
      "dateOfBirth": "15/03/2010",
      "homeId": "home-1",
      "homeName": "The Homeland",
      "status": "current",
      "youngPersonType": "child",
      "gender": "male",
      "category": "Residential",
      "avatar": null,
      "admissionDate": "01/06/2023",
      "keyWorker": "Sarah Johnson"
    }
  ],
  "total": 14,
  "page": 1,
  "limit": 20
}
```

---

### 8.2 Get Single Young Person
```
GET /api/v1/young-people/:id
```

### 8.3 Create Young Person
```
POST /api/v1/young-people
```

### 8.4 Update Young Person
```
PATCH /api/v1/young-people/:id
```

### 8.5 Delete Young Person (Admin/Manager only)
```
DELETE /api/v1/young-people/:id
```

---

### 8.6 Get Young Person's Tasks
```
GET /api/v1/young-people/:id/tasks?status=&page=1&limit=20
```

### 8.7 Get Young Person's IOI Logs
```
GET /api/v1/young-people/:id/ioi-logs?status=&page=1&limit=20
```

---

### 8.8 Get Young Person's Rewards
```
GET /api/v1/young-people/:id/rewards?page=1&limit=20
```
**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "youngPersonName": "James Wilson",
      "rewardType": "Achievement Badge",
      "points": 50,
      "awardedBy": "Sarah Johnson",
      "awardedAt": "2024-01-10T09:00:00Z",
      "status": "awarded"
    }
  ]
}
```

### 8.9 Award Reward
```
POST /api/v1/young-people/:id/rewards
```
**Body:**
```json
{
  "rewardType": "Achievement Badge",
  "points": 50,
  "notes": "Excellent behaviour this week"
}
```

### 8.10 Update Reward Status
```
PATCH /api/v1/young-people/:youngPersonId/rewards/:rewardId
```
**Body:** `{ "status": "redeemed" }`

---

### 8.11 Get Outcome Star Entries
```
GET /api/v1/young-people/:id/outcome-stars?page=1&limit=20
```
**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "youngPersonName": "James Wilson",
      "completedBy": "Sarah Johnson",
      "completedAt": "2024-01-10T09:00:00Z",
      "score": 7,
      "status": "completed"
    }
  ]
}
```

### 8.12 Create Outcome Star Entry
```
POST /api/v1/young-people/:id/outcome-stars
```

---

### 8.13 Get Young People Settings
```
GET /api/v1/young-people/settings?category=
```
**Query params:** `category` — one of:
`reward-types` | `behaviour-categories` | `outcome-star-factors` | `key-worker-types` | `placement-types` | `file-categories`

### 8.14 Create Young People Setting Item
```
POST /api/v1/young-people/settings
```

### 8.15 Update Young People Setting Item
```
PATCH /api/v1/young-people/settings/:itemId
```

### 8.16 Delete Young People Setting Item
```
DELETE /api/v1/young-people/settings/:itemId
```

---

### 8.17 Get Young People Audit Log
```
GET /api/v1/young-people/audit?youngPersonId=&category=&page=1&limit=20
```
**Query params:** `category` — one of:
`placements` | `rewards` | `behaviours` | `outcome-stars` | `key-sessions` | `incidents` | `file-uploads`

---

## 9. Employees

Staff members working at homes. Separate from `User` (a user account may be linked to an employee record).

### 9.1 List Employees
```
GET /api/v1/employees?page=1&limit=20&search=&status=current&homeId=&role=
```
**Query params:** `status` (`current` | `past` | `planned`), `role` (`staff` | `manager` | `admin`)
**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "firstName": "Sarah",
      "lastName": "Johnson",
      "email": "sarah@example.com",
      "role": "manager",
      "homeId": "home-1",
      "homeName": "The Homeland",
      "phone": "+44...",
      "jobTitle": "Care Manager",
      "status": "current",
      "startDate": "01/01/2022",
      "avatar": null
    }
  ],
  "total": 22,
  "page": 1,
  "limit": 20
}
```

---

### 9.2 Get Single Employee
```
GET /api/v1/employees/:id
```

---

### 9.3 Create Employee (6-step wizard submission)
```
POST /api/v1/employees
```
**Body (full wizard payload):**
```json
{
  "summary": {
    "employeeName": "John Doe",
    "nexusStartDate": "2024-01-15",
    "nexusEndDate": null,
    "administrator": "user-1",
    "profileImage": "<base64 or upload key>",
    "colour": "#3B82F6",
    "careGroupJoiningDate": "2024-01-15",
    "careGroupLeavingDate": null,
    "extraDetails": "..."
  },
  "personalDetails": {
    "nationality": "British",
    "ethnicity": "White British",
    "gender": "male",
    "residesAtCareHome": "no",
    "nextOfKin": "Jane Doe",
    "nationalInsuranceNumber": "AB123456C"
  },
  "employmentDetails": {
    "jobTitle": "Care Worker",
    "employmentType": "Full-time",
    "currentGrading": "Level 3",
    "weeklyContractingHours": "37.5",
    "lineManager": "user-2",
    "onProbation": "no",
    "inCareRole": "yes",
    "yearsOfExperience": "3",
    "monthsOfExperience": "6",
    "contractType": "Permanent",
    "annualLeaveFlexibility": "Standard"
  },
  "userDetails": {
    "setCorrespondingUserRecord": true,
    "userId": "user-5"
  },
  "associations": {
    "homeSchool": "home-1",
    "admissionDate": "2024-01-15",
    "leavingDate": null
  },
  "permissions": {
    "users": [
      { "userId": "u1", "accessLevel": "read-only" },
      { "userId": "u2", "accessLevel": "read-write" }
    ]
  }
}
```

---

### 9.4 Update Employee
```
PATCH /api/v1/employees/:id
```
**Body:** Partial update — any fields from the Create body.

### 9.5 Delete Employee (Admin only)
```
DELETE /api/v1/employees/:id
```

---

### 9.6 Get Employee Permissions
```
GET /api/v1/employees/:id/permissions
```
**Response:** List of users and their access level to this employee's record.

### 9.7 Update Employee Permissions
```
PUT /api/v1/employees/:id/permissions
```
**Body:**
```json
{
  "users": [
    { "userId": "u1", "accessLevel": "read-only" },
    { "userId": "u3", "accessLevel": "none" }
  ]
}
```

---

### 9.8 Get Employee Settings
```
GET /api/v1/employees/settings?category=
```
**Query params:** `category` — one of:
`job-titles` | `reference-ratings` | `qualification-types` | `qualification-issuing-bodies` | `evidence-types` | `contract-types` | `contract-events` | `file-categories` | `leave-types` | `leave-statuses` | `genders` | `employment-types` | `custom-personal-group` | `custom-personal-fields` | `annual-leave-flexibility-types`

### 9.9 Create Employee Setting Item
```
POST /api/v1/employees/settings
```

### 9.10 Update Employee Setting Item
```
PATCH /api/v1/employees/settings/:itemId
```

### 9.11 Delete Employee Setting Item
```
DELETE /api/v1/employees/settings/:itemId
```

---

### 9.12 Get Employee Audit Log
```
GET /api/v1/employees/audit?employeeId=&category=&page=1&limit=20
```
**Query params:** `category` — one of: `genders` | `employment-types`

---

## 10. Users (Admin only)

System user accounts — separate from employee records. Manages login credentials and roles.

### 10.1 List Users
```
GET /api/v1/users?page=1&limit=20&search=&role=&status=
```

### 10.2 Get Single User
```
GET /api/v1/users/:id
```

### 10.3 Create User
```
POST /api/v1/users
```
**Body:**
```json
{
  "email": "newstaff@example.com",
  "role": "staff",
  "firstName": "Alice",
  "lastName": "Cooper",
  "homeId": "home-1",
  "phone": "+44...",
  "jobTitle": "Support Worker",
  "sendInviteEmail": true
}
```

### 10.4 Update User
```
PATCH /api/v1/users/:id
```

### 10.5 Deactivate / Delete User
```
DELETE /api/v1/users/:id
```

### 10.6 Reset User Password (Admin triggered)
```
POST /api/v1/users/:id/reset-password
```
**Response:** Sends reset email to user. `{ "success": true }`

---

## 11. Tasks

Task tracking with statuses, assignments, and approval workflow.

### 11.1 List Tasks
```
GET /api/v1/tasks?page=1&limit=20&status=&assignedTo=&youngPersonId=&homeId=&priority=&category=
```
**Query params:** `status` (`overdue` | `due-today` | `pending` | `rejected` | `draft` | `future` | `completed` | `comments` | `rewards`)
**Response:**
```json
{
  "data": [
    {
      "id": "task-1",
      "title": "Weekly Risk Assessment",
      "description": "Complete weekly risk assessment for James",
      "status": "overdue",
      "dueDate": "2024-01-08T23:59:00Z",
      "assignedTo": "user-1",
      "assignedToName": "Sarah Johnson",
      "youngPersonId": "1",
      "youngPersonName": "James Wilson",
      "category": "Risk Assessment",
      "priority": "high",
      "createdAt": "2024-01-01T09:00:00Z",
      "updatedAt": "2024-01-08T10:00:00Z"
    }
  ],
  "total": 47,
  "page": 1,
  "limit": 20
}
```

---

### 11.2 Get Single Task
```
GET /api/v1/tasks/:id
```

### 11.3 Create Task
```
POST /api/v1/tasks
```
**Body:**
```json
{
  "title": "Weekly Risk Assessment",
  "description": "...",
  "dueDate": "2024-01-15T23:59:00Z",
  "assignedTo": "user-1",
  "youngPersonId": "1",
  "category": "Risk Assessment",
  "priority": "high"
}
```

### 11.4 Update Task
```
PATCH /api/v1/tasks/:id
```

### 11.5 Delete Task
```
DELETE /api/v1/tasks/:id
```

### 11.6 Submit Task for Approval
```
POST /api/v1/tasks/:id/submit
```

### 11.7 Approve Task (Manager/Admin only)
```
POST /api/v1/tasks/:id/approve
```

### 11.8 Reject Task (Manager/Admin only)
```
POST /api/v1/tasks/:id/reject
```
**Body:** `{ "reason": "Missing required fields." }`

### 11.9 Add Comment to Task
```
POST /api/v1/tasks/:id/comments
```
**Body:** `{ "text": "Please update section 3." }`

### 11.10 Get Task Comments
```
GET /api/v1/tasks/:id/comments
```

---

## 12. Task Explorer (Advanced Search)

Power search across tasks/forms — 3-step filter wizard.

### 12.1 Search Tasks (Task Explorer)
```
POST /api/v1/task-explorer/search
```
**Body:**
```json
{
  "period": "this-month",
  "customDateFrom": null,
  "customDateTo": null,
  "type": "young-person",
  "project": "home-1",
  "forms": ["daily-log", "risk-assessment"],
  "field": "status",
  "keyword": "approved",
  "searchByOther": [],
  "taskId": "",
  "statuses": ["approved", "submitted"],
  "showAuditTrail": false,
  "page": 1,
  "limit": 20
}
```
**Response:**
```json
{
  "data": [
    {
      "id": "log-1",
      "taskId": 1001,
      "title": "Daily Log - James Wilson",
      "formGroup": "Daily Logs",
      "relatesTo": "James Wilson",
      "relatesToIcon": "person",
      "homeOrSchool": "The Homeland",
      "taskDate": "2024-01-10T09:00:00Z",
      "status": "approved",
      "originallyRecordedAt": "2024-01-10T09:00:00Z",
      "originallyRecordedBy": "Sarah Johnson"
    }
  ],
  "total": 134,
  "page": 1,
  "limit": 20
}
```

---

### 12.2 Get Available Forms for Task Explorer
```
GET /api/v1/task-explorer/forms?type=young-person&project=home-1
```
**Response:** List of available form definitions with fields.

---

## 13. IOI Logs (Input-Output-Impact)

Therapeutic session documentation — the core clinical record.

### 13.1 List IOI Logs
```
GET /api/v1/ioi-logs?page=1&limit=20&status=&youngPersonId=&authorId=&homeId=
```
**Query params:** `status` (`draft` | `pending` | `approved` | `rejected`)
**Response:**
```json
{
  "data": [
    {
      "id": "ioi-1",
      "youngPersonId": "1",
      "youngPersonName": "James Wilson",
      "authorId": "user-1",
      "authorName": "Sarah Johnson",
      "sessionDate": "2024-01-10T14:00:00Z",
      "location": "Common Room",
      "status": "pending",
      "input": {
        "situation": "James presented with anxiety...",
        "clientState": "Anxious, withdrawn",
        "goals": "Reduce anxiety, improve engagement"
      },
      "output": {
        "intervention": "Grounding exercise, breathing techniques",
        "techniques": ["Active Listening", "Trauma-Informed Care"],
        "duration": 45
      },
      "impact": {
        "immediateImpact": "James calmed significantly...",
        "clientResponse": "Positive, engaged with techniques",
        "followUpNeeded": true,
        "notes": "Schedule follow-up session"
      },
      "createdAt": "2024-01-10T15:00:00Z",
      "updatedAt": "2024-01-10T15:00:00Z",
      "approvedBy": null,
      "approvedAt": null,
      "rejectionReason": null
    }
  ],
  "total": 58,
  "page": 1,
  "limit": 20
}
```

---

### 13.2 Get Single IOI Log
```
GET /api/v1/ioi-logs/:id
```

### 13.3 Create IOI Log
```
POST /api/v1/ioi-logs
```
**Body:**
```json
{
  "youngPersonId": "1",
  "sessionDate": "2024-01-10T14:00:00Z",
  "location": "Common Room",
  "situation": "James presented with anxiety...",
  "clientState": "Anxious, withdrawn",
  "goals": "Reduce anxiety",
  "intervention": "Grounding exercise",
  "techniques": ["Active Listening"],
  "duration": 45,
  "immediateImpact": "James calmed significantly",
  "clientResponse": "Positive",
  "followUpNeeded": true,
  "notes": "..."
}
```

### 13.4 Update IOI Log (only draft/rejected status)
```
PATCH /api/v1/ioi-logs/:id
```

### 13.5 Delete IOI Log (Admin/Author, only if draft)
```
DELETE /api/v1/ioi-logs/:id
```

### 13.6 Submit IOI Log for Approval
```
POST /api/v1/ioi-logs/:id/submit
```

### 13.7 Approve IOI Log (Manager/Admin only)
```
POST /api/v1/ioi-logs/:id/approve
```

### 13.8 Reject IOI Log (Manager/Admin only)
```
POST /api/v1/ioi-logs/:id/reject
```
**Body:** `{ "reason": "Insufficient detail in impact section." }`

---

## 14. Daily Logs

Day-to-day activity records for a home.

### 14.1 List Daily Logs
```
GET /api/v1/daily-logs?page=1&limit=20&homeId=&date=&authorId=
```

### 14.2 Get Single Daily Log
```
GET /api/v1/daily-logs/:id
```

### 14.3 Create Daily Log
```
POST /api/v1/daily-logs
```
**Body:**
```json
{
  "homeId": "home-1",
  "date": "2024-01-10",
  "content": "Morning shift: All residents present...",
  "youngPeoplePresent": ["1", "2"],
  "staffOnDuty": ["user-1", "user-3"]
}
```

### 14.4 Update Daily Log
```
PATCH /api/v1/daily-logs/:id
```

### 14.5 Delete Daily Log
```
DELETE /api/v1/daily-logs/:id
```

---

## 15. Rotas (Shift Scheduling)

Staff shift rota management per home.

### 15.1 Get Rota
```
GET /api/v1/rotas?homeId=home-1&weekOf=2024-01-08
```
**Response:** Weekly rota grid with shifts per employee per day.

### 15.2 Create / Update Rota
```
PUT /api/v1/rotas
```
**Body:**
```json
{
  "homeId": "home-1",
  "weekOf": "2024-01-08",
  "shifts": [
    {
      "employeeId": 1,
      "date": "2024-01-08",
      "startTime": "07:00",
      "endTime": "15:00",
      "shiftType": "Day"
    }
  ]
}
```

### 15.3 Delete Shift
```
DELETE /api/v1/rotas/shifts/:shiftId
```

---

## 16. Calendar Events

Appointments, training, meetings visible in the calendar view.

### 16.1 List Calendar Events
```
GET /api/v1/calendar?homeId=&from=2024-01-01&to=2024-01-31&type=
```
**Query params:** `type` (`shift` | `appointment` | `training` | `meeting` | `other`)
**Response:**
```json
{
  "data": [
    {
      "id": "event-1",
      "title": "Therapy Session - James",
      "date": "2024-01-15",
      "startTime": "14:00",
      "endTime": "15:00",
      "type": "appointment",
      "description": "Weekly therapy session",
      "participants": ["user-1", "user-3"]
    }
  ]
}
```

### 16.2 Get Single Event
```
GET /api/v1/calendar/:id
```

### 16.3 Create Event
```
POST /api/v1/calendar
```

### 16.4 Update Event
```
PATCH /api/v1/calendar/:id
```

### 16.5 Delete Event
```
DELETE /api/v1/calendar/:id
```

---

## 17. Vehicles

Transport/vehicle management per home.

### 17.1 List Vehicles
```
GET /api/v1/vehicles?page=1&limit=20&homeId=&status=current
```
**Query params:** `status` (`current` | `past` | `planned`)
**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "name": "Ford Transit",
      "registration": "AB12 CDE",
      "make": "Ford",
      "model": "Transit",
      "homeId": "home-1",
      "homeName": "The Homeland",
      "status": "current",
      "mileage": 45230,
      "nextServiceDate": "2024-06-01",
      "image": null
    }
  ],
  "total": 8,
  "page": 1,
  "limit": 20
}
```

---

### 17.2 Get Single Vehicle
```
GET /api/v1/vehicles/:id
```

### 17.3 Create Vehicle
```
POST /api/v1/vehicles
```
**Body:**
```json
{
  "name": "Ford Transit",
  "registration": "AB12 CDE",
  "make": "Ford",
  "model": "Transit",
  "homeId": "home-1",
  "status": "current",
  "mileage": 0,
  "nextServiceDate": "2025-01-01"
}
```

### 17.4 Update Vehicle
```
PATCH /api/v1/vehicles/:id
```

### 17.5 Delete Vehicle
```
DELETE /api/v1/vehicles/:id
```

---

### 17.6 Get Vehicle Settings
```
GET /api/v1/vehicles/settings?category=
```
**Query params:** `category` — one of:
`file-categories` | `custom-information-groups` | `custom-information-fields`

### 17.7 Create Vehicle Setting Item
```
POST /api/v1/vehicles/settings
```

### 17.8 Update Vehicle Setting Item
```
PATCH /api/v1/vehicles/settings/:itemId
```

### 17.9 Delete Vehicle Setting Item
```
DELETE /api/v1/vehicles/settings/:itemId
```

---

### 17.10 Get Vehicle Audit Log
```
GET /api/v1/vehicles/audit?vehicleId=&category=&page=1&limit=20
```
**Query params:** `category` — one of: `file-categories` | `custom-information-groups` | `custom-information-fields`

---

## 18. Documents / File Management

File uploads attached to any entity (home, young person, employee, vehicle).

### 18.1 List Documents
```
GET /api/v1/documents?entityType=&entityId=&category=&page=1&limit=20
```
**Query params:** `entityType` (`home` | `young-person` | `employee` | `vehicle`)

**Response:**
```json
{
  "data": [
    {
      "id": "doc-1",
      "name": "Risk Assessment Jan 2024.pdf",
      "entityType": "young-person",
      "entityId": "1",
      "category": "Risk Assessment",
      "uploadedBy": "Sarah Johnson",
      "uploadedAt": "2024-01-10T09:00:00Z",
      "fileSize": 204800,
      "mimeType": "application/pdf",
      "url": "https://..."
    }
  ],
  "total": 23
}
```

---

### 18.2 Upload Document
```
POST /api/v1/documents
Content-Type: multipart/form-data
```
**Body:** `file`, `entityType`, `entityId`, `category`, `name`

### 18.3 Get Document (download link)
```
GET /api/v1/documents/:id
```

### 18.4 Delete Document
```
DELETE /api/v1/documents/:id
```

---

## 19. Reports (Bespoke Reporting)

Generate and download reports. Manager/Admin only.

### 19.1 List Available Report Templates
```
GET /api/v1/reports/templates
```
**Response:** List of report definitions (name, description, available filters).

### 19.2 Generate Report
```
POST /api/v1/reports/generate
```
**Body:**
```json
{
  "templateId": "young-people-summary",
  "filters": {
    "homeId": "home-1",
    "dateFrom": "2024-01-01",
    "dateTo": "2024-01-31",
    "status": "current"
  },
  "format": "pdf"
}
```
**Response:** `{ "reportId": "rpt-1", "status": "generating" }` (async)

### 19.3 Get Report Status / Download
```
GET /api/v1/reports/:reportId
```
**Response:** `{ "status": "ready", "downloadUrl": "https://..." }` or `{ "status": "generating" }`

### 19.4 List My Reports
```
GET /api/v1/reports?page=1&limit=20
```

---

## 20. Bulk Exports

Export data in bulk (CSV/Excel). Manager/Admin only.

### 20.1 Request Export
```
POST /api/v1/exports
```
**Body:**
```json
{
  "entity": "young-people",
  "filters": { "homeId": "home-1", "status": "current" },
  "format": "csv"
}
```
**Response:** `{ "exportId": "exp-1", "status": "pending" }`

### 20.2 Get Export Status / Download
```
GET /api/v1/exports/:exportId
```

### 20.3 List My Exports
```
GET /api/v1/exports?page=1&limit=20
```

---

## 21. Uploads (Data Import)

Bulk data import (CSV upload). Admin only.

### 21.1 Upload Import File
```
POST /api/v1/uploads
Content-Type: multipart/form-data
```
**Body:** `file` (CSV), `entityType` (`young-people` | `employees` | `homes`)

### 21.2 Get Upload Status
```
GET /api/v1/uploads/:uploadId
```
**Response:**
```json
{
  "status": "completed",
  "totalRows": 50,
  "successRows": 48,
  "errorRows": 2,
  "errors": [
    { "row": 5, "message": "Invalid date format" }
  ]
}
```

### 21.3 List Uploads
```
GET /api/v1/uploads?page=1&limit=20
```

---

## 22. Forms & Procedures

Configurable form definitions (regulatory reports, daily checks, etc.).

### 22.1 List Form Definitions
```
GET /api/v1/forms?category=&homeId=&page=1&limit=20
```

### 22.2 Get Form Definition
```
GET /api/v1/forms/:id
```
**Response:** Form schema with all field definitions.

### 22.3 Create Form Definition (Admin only)
```
POST /api/v1/forms
```

### 22.4 Update Form Definition (Admin only)
```
PATCH /api/v1/forms/:id
```

### 22.5 Delete Form Definition (Admin only)
```
DELETE /api/v1/forms/:id
```

---

## 23. Regions (Admin only)

Geographic regions used to group homes.

### 23.1 List Regions
```
GET /api/v1/regions
```

### 23.2 Create Region
```
POST /api/v1/regions
```
**Body:** `{ "name": "North West", "description": "..." }`

### 23.3 Update Region
```
PATCH /api/v1/regions/:id
```

### 23.4 Delete Region
```
DELETE /api/v1/regions/:id
```

---

## 24. Groupings (Admin only)

Custom groupings for data segmentation.

### 24.1 List Groupings
```
GET /api/v1/groupings?type=
```

### 24.2 Create Grouping
```
POST /api/v1/groupings
```

### 24.3 Update Grouping
```
PATCH /api/v1/groupings/:id
```

### 24.4 Delete Grouping
```
DELETE /api/v1/groupings/:id
```

---

## 25. Sensitive Data (Admin only)

Restricted access to sensitive personal information.

### 25.1 Get Sensitive Data for Entity
```
GET /api/v1/sensitive-data?entityType=young-person&entityId=1
```
**Notes:** Requires elevated permission check. All access is logged.

### 25.2 Update Sensitive Data
```
PATCH /api/v1/sensitive-data/:id
```

---

## 26. System Settings (Admin only)

Global platform configuration.

### 26.1 Get System Settings
```
GET /api/v1/system-settings
```
**Response:** Key-value map of all system-wide settings.

### 26.2 Update System Settings
```
PATCH /api/v1/system-settings
```
**Body:** Partial object with setting keys to update.

---

## 27. Help / Support

### 27.1 Get Help Articles
```
GET /api/v1/help?search=&category=&page=1&limit=20
```

### 27.2 Get Help Article
```
GET /api/v1/help/:id
```

### 27.3 Submit Support Request
```
POST /api/v1/help/support
```
**Body:**
```json
{
  "subject": "Cannot upload documents",
  "description": "When I try to upload a PDF...",
  "priority": "medium"
}
```

---

## 28. Safeguarding Intelligence & Compliance (Reg 44/45 + RI Monitoring)

This module captures product-owner priorities:

- One-click Reg 44 and Reg 45 evidence packs
- Safeguarding chronology auto-build
- Risk escalation alerts
- Pattern mapping across incidents
- Internal monitoring dashboard for Responsible Individuals (RIs)
- Reflective recording prompts that support therapeutic practice

### 28.1 Generate Reg 44 Evidence Pack
```
POST /api/v1/compliance/evidence-packs/reg44
```
**Body:**
```json
{
  "homeId": "home-1",
  "periodStart": "2026-03-01",
  "periodEnd": "2026-03-31",
  "includeChronologies": true,
  "includePatternMapping": true,
  "format": "zip"
}
```
**Response:** `{ "packId": "pack-1", "status": "queued" }`

### 28.2 Generate Reg 45 Evidence Pack
```
POST /api/v1/compliance/evidence-packs/reg45
```
**Body:** Same shape as Reg 44, with optional organisation-level scope.
**Response:** `{ "packId": "pack-2", "status": "queued" }`

### 28.3 List Evidence Pack Jobs
```
GET /api/v1/compliance/evidence-packs?type=&status=&homeId=&page=1&limit=20
```
**Query params:** `type` (`reg44` | `reg45`), `status` (`queued` | `processing` | `ready` | `failed`)

### 28.4 Get Evidence Pack Job
```
GET /api/v1/compliance/evidence-packs/:packId
```
**Response includes:** generation metadata, evidence manifest summary, failures/warnings.

### 28.5 Download Evidence Pack Artifact
```
GET /api/v1/compliance/evidence-packs/:packId/download
```
**Response:** Streamed file or pre-signed download URL.

---

### 28.6 Get Safeguarding Chronology
```
GET /api/v1/safeguarding/chronologies/:youngPersonId?from=&to=&includeLinkedRecords=true
```
**Notes:** Child-centred timeline built from incidents, IOI logs, tasks, comments, and approvals.

### 28.7 Rebuild Safeguarding Chronology
```
POST /api/v1/safeguarding/chronologies/:youngPersonId/rebuild
```
**Body:**
```json
{ "reason": "Data backfill completed for missing incident records" }
```
**Notes:** Triggers idempotent rebuild job and logs audit trail.

---

### 28.8 List Risk Escalations
```
GET /api/v1/safeguarding/escalations?status=&severity=&homeId=&assignedTo=&page=1&limit=20
```
**Query params:** `status` (`new` | `acknowledged` | `in_progress` | `resolved` | `dismissed`)

### 28.9 Get Risk Escalation Detail
```
GET /api/v1/safeguarding/escalations/:id
```

### 28.10 Acknowledge Risk Escalation
```
POST /api/v1/safeguarding/escalations/:id/acknowledge
```
**Body:** `{ "note": "Reviewed by on-call manager." }`

### 28.11 Resolve Risk Escalation
```
POST /api/v1/safeguarding/escalations/:id/resolve
```
**Body:** `{ "resolutionSummary": "Safety plan updated and guardian informed." }`

---

### 28.12 Incident Pattern Mapping Search
```
POST /api/v1/safeguarding/incidents/patterns/query
```
**Body:**
```json
{
  "homeId": "home-1",
  "youngPersonId": null,
  "windowDays": 90,
  "incidentTypes": ["physical-aggression", "absconding"],
  "page": 1,
  "limit": 20
}
```
**Response:** Pattern clusters with explainability signals and confidence bands.

### 28.13 Get Incident Pattern Detail
```
GET /api/v1/safeguarding/incidents/patterns/:patternId
```
**Response:** Full timeline, related incidents, contributing factors, analyst feedback.

---

### 28.14 RI Monitoring Dashboard Overview
```
GET /api/v1/ri-monitoring/dashboard?homeId=&period=this-month
```
**Response:** KPI cards for safeguarding risk, overdue actions, compliance pack status, and trend lines.

### 28.15 RI Monitoring Home Breakdown
```
GET /api/v1/ri-monitoring/dashboard/homes?period=this-month&page=1&limit=20
```
**Response:** Home-level table for RIs with status, concerns, and escalation counts.

---

### 28.16 Get Reflective Prompt Templates
```
GET /api/v1/recording/prompts/reflective?context=incident
```
**Context values:** `incident` | `ioi-log` | `daily-log`
**Notes:** Returns non-blaming prompt sets aligned to therapeutic recording principles.

### 28.17 Generate Contextual Reflective Prompts
```
POST /api/v1/recording/prompts/reflective/generate
```
**Body:**
```json
{
  "context": "incident",
  "youngPersonId": "1",
  "observedBehaviour": "Property damage during transition period",
  "location": "Dining area"
}
```
**Response:** Reflective prompts such as:
- "What might the child have been communicating?"
- "What emotion may have been underneath the behaviour?"
- "What helped regulate the situation?"

---

### 28.18 Product Language & Safety Rules

- Recording prompts must use non-blaming language and preserve dignity.
- The API must support therapeutic reflection without increasing time burden for staff.
- Safeguarding evidence outputs must remain audit-ready while child-centred in framing.
- All safeguarding and RI endpoints require strict RBAC, full audit trails, and UK GDPR-compliant access logging.

---

## Summary — Endpoint Count by Module

| Module | Endpoints |
|--------|-----------|
| Auth | 9 |
| Current User (Me) | 6 |
| My Summary | 2 |
| My Dashboard (Widgets) | 3 |
| Announcements | 6 |
| Care Groups | 12 |
| Homes | 10 |
| Young People | 17 |
| Employees | 12 |
| Users | 6 |
| Tasks | 10 |
| Task Explorer | 2 |
| IOI Logs | 8 |
| Daily Logs | 5 |
| Rotas | 3 |
| Calendar | 5 |
| Vehicles | 10 |
| Documents | 4 |
| Reports | 4 |
| Bulk Exports | 3 |
| Uploads (Import) | 3 |
| Forms & Procedures | 5 |
| Regions | 4 |
| Groupings | 4 |
| Sensitive Data | 2 |
| System Settings | 2 |
| Help / Support | 3 |
| Safeguarding Intelligence & Compliance | 17 |
| **Total** | **178** |

---

## MVP Execution Order (All Endpoints Mandatory)

All modules below are MVP scope. The order is for engineering execution and dependency management only, not scoping.

### Wave 1 — Core Access & App Shell
1. Auth (all 9 endpoints)
2. Current User / Me (profile, permissions, preferences)
3. Announcements

### Wave 2 — Organisation & Structure
4. Care Groups (CRUD + stakeholders + settings)
5. Homes (CRUD + settings + audit)
6. Regions and Groupings

### Wave 3 — People Domain
7. Young People (CRUD + rewards + outcome stars + settings + audit)
8. Employees (CRUD + permissions + settings + audit)
9. Users (admin lifecycle)

### Wave 4 — Clinical & Operational Records
10. IOI Logs (full workflow: draft, submit, approve/reject)
11. Tasks (full workflow + comments + approvals)
12. Daily Logs
13. Rotas
14. Calendar Events

### Wave 5 — Safeguarding Intelligence & Compliance
15. Reg 44/45 evidence packs
16. Safeguarding chronology auto-build
17. Risk escalation alerts
18. Pattern mapping across incidents
19. RI monitoring dashboard
20. Reflective recording prompts

### Wave 6 — Search, Dashboard, Files & Admin Extensions
21. Task Explorer
22. My Summary stats
23. My Dashboard widgets
24. Documents / file uploads
25. Vehicles
26. Reports and bulk exports
27. Uploads (data import)
28. Forms and procedures
29. Sensitive data
30. System settings
31. Help / support

### MVP Completion Rule
1. MVP is complete only when all 178 endpoints in this document are implemented, secured, tested, and production-ready.
