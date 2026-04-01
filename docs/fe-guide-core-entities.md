# FE Integration Guide — Core Entities

All endpoints require Bearer token + MFA. Base URL: `/api/v1`

---

## 1. Homes

### List Homes
```
GET /homes?page=1&pageSize=20&status=current&careGroupId=X&search=north
```

| Query Param | Values | Default |
|---|---|---|
| `page` | int | 1 |
| `pageSize` | int (max 500) | 20 |
| `search` | string | — |
| `careGroupId` | string | — |
| `status` | `current`, `past`, `planned`, `all` | `all` |
| `isActive` | boolean | — |

**Response** includes `counts` for each home:
```json
{
  "data": [{
    "id": "...",
    "name": "Northbridge Home",
    "description": "Specialist residential care home...",
    "address": "21 Northbridge Road, Manchester M4 8QA",
    "postCode": "M4 8QA",
    "capacity": 12,
    "category": "Children's Home",
    "region": "North West",
    "status": "current",
    "phoneNumber": "+44 161 000 1001",
    "email": "northbridge@example.co.uk",
    "careGroupId": "...",
    "careGroupName": "Izu Care Group North",
    "admin": { "id": "...", "name": "Izu Obani" },
    "personInCharge": { "id": "...", "name": "Izu Obani" },
    "responsibleIndividual": { "id": "...", "name": "Izu Obani" },
    "startDate": "2025-11-18T00:00:00.000Z",
    "endDate": null,
    "isSecure": false,
    "shortTermStays": false,
    "minAgeGroup": 8,
    "maxAgeGroup": 17,
    "ofstedUrn": "SC500123",
    "compliance": {
      "patDate": null,
      "electricalCertificate": null,
      "gasCertificate": null,
      "dayFireDrill": null,
      "nightFireDrill": null,
      "healthSafetyRiskDate": null,
      "fireRiskDate": null,
      "employersLiabilityInsuranceDate": null
    },
    "counts": {
      "employees": 3,
      "youngPeople": 2,
      "vehicles": 2,
      "tasks": 45
    },
    "isActive": true,
    "createdAt": "...",
    "updatedAt": "..."
  }],
  "meta": { "total": 2, "page": 1, "pageSize": 20, "totalPages": 1 }
}
```

### Get Home Detail
```
GET /homes/:id
```
Same fields as list item.

### Get Home Summary (aggregated dashboard)
```
GET /homes/:id/summary
```
Returns everything above PLUS:
```json
{
  "youngPeople": [{ "id": "...", "firstName": "Ethan", "lastName": "Mills", "status": "current", "type": "Fulltime Resident", "roomNumber": "Room 3" }],
  "employees": [{ "id": "...", "name": "Kemi Adeyemi", "jobTitle": "Senior Support Worker", "roleName": "Residential Care Worker", "status": "current" }],
  "vehicles": [{ "id": "...", "registration": "IZU-VC-001", "make": "Ford", "model": "Transit Custom", "status": "current" }],
  "upcomingEvents": [{ "id": "...", "title": "Reg 44 Visit", "startsAt": "...", "endsAt": "..." }],
  "todayShifts": [{ "id": "...", "employeeName": "Kemi Adeyemi", "startTime": "...", "endTime": "..." }],
  "taskStats": { "pending": 10, "completed": 30, "in_progress": 5 }
}
```

### Create Home
```
POST /homes
```
**Required:** `careGroupId`, `name`
**All fields from the list response are settable** (description, address, postCode, capacity, category, region, status, phoneNumber, email, adminUserId, personInChargeId, responsibleIndividualId, startDate, endDate, isSecure, shortTermStays, minAgeGroup, maxAgeGroup, ofstedUrn, compliance, details)

### Update Home
```
PATCH /homes/:id
```
Send only the fields you want to change. Send `null` to clear optional fields.

### Deactivate Home
```
DELETE /homes/:id
```

### Home Sub-Resources
```
GET /homes/:id/young-people?page=1&pageSize=20
GET /homes/:id/employees?page=1&pageSize=20
GET /homes/:id/vehicles?page=1&pageSize=20
GET /homes/:id/tasks?page=1&pageSize=20
```

---

## 2. Home Events (Calendar)

```
GET    /homes/:id/events?page=1&pageSize=20
POST   /homes/:id/events
PATCH  /homes/:id/events/:eventId
DELETE /homes/:id/events/:eventId
```

**Create/Update body:**
```json
{
  "title": "Reg 44 Visit",
  "description": "Monthly inspection",
  "startsAt": "2026-04-03T10:00:00.000Z",
  "endsAt": "2026-04-03T12:00:00.000Z"
}
```
`title` and `startsAt` required on create. All optional on update.

---

## 3. Employee Shifts (Rotas)

```
GET    /homes/:id/shifts?page=1&pageSize=20
POST   /homes/:id/shifts
PATCH  /homes/:id/shifts/:shiftId
DELETE /homes/:id/shifts/:shiftId
```

**Create body:**
```json
{
  "employeeId": "employee_cuid",
  "startTime": "2026-04-01T07:00:00.000Z",
  "endTime": "2026-04-01T15:00:00.000Z"
}
```

**Response includes employee name:**
```json
{
  "id": "...",
  "homeId": "...",
  "employeeId": "...",
  "employeeName": "Kemi Adeyemi",
  "startTime": "...",
  "endTime": "..."
}
```

---

## 4. Young People

### List
```
GET /young-people?page=1&pageSize=20&homeId=X&status=current&gender=Male&type=Fulltime%20Resident
```

### Get Detail
```
GET /young-people/:id
```

**Response (all fields):**
```json
{
  "id": "...",
  "homeId": "...",
  "homeName": "Northbridge Home",
  "firstName": "Ethan",
  "lastName": "Mills",
  "preferredName": "Ethan",
  "namePronunciation": null,
  "description": null,
  "dateOfBirth": "2010-03-15",
  "gender": "Male",
  "ethnicity": "White British",
  "religion": null,
  "referenceNo": "IZU-YP-001",
  "niNumber": null,
  "roomNumber": "Room 3",
  "status": "current",
  "type": "Fulltime Resident",
  "admissionDate": "2025-11-24T00:00:00.000Z",
  "placementEndDate": null,
  "avatarUrl": null,
  "keyWorker": { "id": "...", "name": "Kemi Adeyemi" },
  "practiceManager": null,
  "admin": { "id": "...", "name": "Izu Obani" },
  "socialWorkerName": "Hazel Kapfunde",
  "independentReviewingOfficer": null,
  "placingAuthority": "Northamptonshire County Council",
  "legalStatus": "Section 20",
  "isEmergencyPlacement": false,
  "isAsylumSeeker": false,
  "contact": {
    "currentAddress": "1 Sunderland Street NN5 5ES",
    "previousAddress": null,
    "dischargeType": null,
    "dischargeAddress": null,
    "email": null,
    "mobile": null
  },
  "health": {
    "nhsNumber": null,
    "currentDoctor": null,
    "dentist": null,
    "medicalNeeds": null,
    "knownAllergies": null,
    "registeredDisabled": false
  },
  "education": {
    "universalPupilNumber": null,
    "schoolAttended": null,
    "attendsSchoolRunByCareGroup": false,
    "senStatement": false,
    "inFullTimeEducation": false
  }
}
```

### Create
```
POST /young-people
```
**Required:** `homeId`, `firstName`, `lastName`
All other fields optional. Send `contact`, `health`, `education` as JSON objects.

### Update
```
PATCH /young-people/:id
```

### Deactivate
```
DELETE /young-people/:id
```

---

## 5. Vehicles

### List
```
GET /vehicles?page=1&pageSize=20&homeId=X&status=current&fuelType=Diesel&sortBy=registration&sortOrder=asc
```

### Get Detail
```
GET /vehicles/:id
```

**Response (all fields):**
```json
{
  "id": "...",
  "homeId": "...",
  "registration": "IZU-VC-001",
  "make": "Ford",
  "model": "Transit Custom",
  "year": 2021,
  "colour": "White",
  "description": "Primary transport vehicle for Northbridge Home.",
  "status": "current",
  "vin": "WF0XXXGCDX1234567",
  "registrationDate": null,
  "taxDate": null,
  "fuelType": "Diesel",
  "insuranceDate": null,
  "ownership": "Purchased",
  "leaseStartDate": null,
  "leaseEndDate": null,
  "purchasePrice": null,
  "purchaseDate": "2021-03-15T00:00:00.000Z",
  "startDate": "2021-04-01T00:00:00.000Z",
  "endDate": null,
  "adminUserId": null,
  "contactPhone": "+44 7483 420596",
  "nextServiceDue": "2026-05-05T09:00:00.000Z",
  "motDue": "2026-05-30T09:00:00.000Z"
}
```

### Create
```
POST /vehicles
```
**Required:** `registration`

### Update
```
PATCH /vehicles/:id
```

### Deactivate
```
DELETE /vehicles/:id
```

---

## 6. Employees

### List
```
GET /employees?page=1&pageSize=20&homeId=X&status=current&roleId=X
```

### Get Detail
```
GET /employees/:id
```

**Response:**
```json
{
  "id": "...",
  "userId": "...",
  "user": { "id": "...", "email": "kemi@zikelsolutions.com", "firstName": "Kemi", "lastName": "Adeyemi", "role": "staff" },
  "homeId": "...",
  "homeName": "Northbridge Home",
  "roleId": "...",
  "roleName": "Residential Care Worker",
  "jobTitle": "Senior Support Worker",
  "startDate": "...",
  "endDate": null,
  "status": "current",
  "contractType": "Full-time",
  "dbsNumber": "DBS-001-2025",
  "dbsDate": "2025-06-15T00:00:00.000Z",
  "qualifications": null
}
```

### Create (existing user)
```
POST /employees
```
**Required:** `userId` (the user must already have a tenant membership)

### Create with New User (multi-step)
```
POST /employees/create-with-user
```
Creates User + Membership + Employee in one call.

**Required:** `firstName`, `lastName`, `email`, `password`

```json
{
  "firstName": "Sarah",
  "lastName": "Jenkins",
  "otherNames": null,
  "email": "sarah.jenkins@example.com",
  "dateOfBirth": "1990-05-15T00:00:00.000Z",
  "userType": "internal",
  "roleId": "role_cuid",
  "avatarUrl": null,

  "password": "SecurePass123!",
  "disableLoginAt": null,
  "passwordExpiresAt": null,
  "landingPage": "My Summary",
  "hideFutureTasks": false,
  "enableIpRestriction": false,
  "passwordExpiresInstantly": false,
  "isActive": true,

  "homeId": "home_cuid",
  "jobTitle": "Support Worker",
  "startDate": "2026-04-01T00:00:00.000Z",
  "contractType": "Full-time"
}
```

**User types:** `internal`, `external`, `young_person`

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "email": "...", "firstName": "Sarah", "lastName": "Jenkins", "userType": "internal", "isActive": true },
    "employee": { "id": "...", "userId": "...", "homeId": "...", "roleName": "...", ... }
  }
}
```

### Update / Deactivate
```
PATCH /employees/:id
DELETE /employees/:id
```

---

## 7. Roles

### List
```
GET /roles?page=1&pageSize=50&isActive=true&search=admin
```

**Response:**
```json
{
  "data": [{
    "id": "...",
    "name": "Administrator",
    "description": "Main system administrator",
    "isActive": true,
    "isSystemGenerated": true,
    "activeUsers": 5,
    "permissions": {
      "systemAdmin": "read_write",
      "tasks": "read_write",
      "sensitiveData": "read_write",
      "canDeleteTasks": true,
      "hasDashboard": true,
      "hasSummary": true,
      "hasReports": true,
      "canCreateYoungPerson": true,
      "canCreateEmployees": true,
      "canCreateVehicles": true,
      "canExportData": true
    }
  }]
}
```

### Default Roles (pre-seeded)
| Name | Description |
|---|---|
| Administrator | Main system administrator |
| Registered Manager | Home manager |
| Deputy Manager | Deputy home manager |
| Reg 44 Inspector | Ofsted Reg 44 Inspector |
| Residential Care Worker | Delivery of care |
| Team Leader | Care team leader |
| Young Person | Young Person personal login |

### Permission Keys

**Read/Write/No Access permissions:**
`systemAdmin`, `bespokeReporting`, `bulkExports`, `calendar`, `uploads`, `formsProcedures`, `groupings`, `dailyLogs`, `outcomeStar`, `regions`, `rewards`, `rotas`, `sensitiveData`, `tasks`, `userAdmin`

Values: `"read_write"`, `"read"`, `"no_access"`

**Boolean permissions:**
`canExportData`, `canDeleteTasks`, `billingApproval`, `hasDashboard`, `hasDocumentsModule`, `canDeleteUploads`, `canCreateYoungPerson`, `canCreateEmployees`, `canCreateVehicles`, `hasReports`, `hasSummary`

Values: `true` / `false`

### Create / Update / Delete
```
POST   /roles                    — { name, description?, permissions?, isActive? }
PATCH  /roles/:id                — any field
PATCH  /roles/:id/permissions    — send permissions object directly as body
DELETE /roles/:id                — deactivates
```

---

## 8. Home Reports

All require a `homeId` in the URL.

### Daily Audit
```
GET /homes/:id/reports/daily-audit?date=2026-03-31
```
Returns tasks, daily logs, events, shifts for that date + summary counts.

### Employee Stats (Ofsted)
```
GET /homes/:id/reports/employee-stats
```
Returns all employees with DBS, qualifications, contract type, role.

### Statistics
```
GET /homes/:id/reports/statistics
```
Returns: total tasks (by category/status), daily log counts (total + last 30 days), resident/staff/vehicle totals, upcoming events.

### Access Report
```
GET /homes/:id/reports/access?page=1&pageSize=50
```
Returns audit trail of who accessed task logs for this home.

### Weekly Record
```
GET /homes/:id/reports/weekly-record?startDate=2026-03-24&endDate=2026-03-31
```
Defaults to last 7 days if no dates provided. Returns tasks, daily logs, events, shifts + summary.

### Monthly Record
```
GET /homes/:id/reports/monthly-record?startDate=2026-03-01&endDate=2026-03-31
```
Defaults to current month if no dates provided. Same shape as weekly.

---

## Status Values (shared across all entities)

All list endpoints support `status` filter:

| Value | Meaning | Use for tabs |
|---|---|---|
| `current` | Active/current | "Current" tab |
| `past` | Ended/discharged | "Past" tab |
| `planned` | Upcoming/planned | "Planned" tab |
| `all` | No filter (default) | "All" tab |

This maps directly to the ClearCare tabs: **All (X) | Current (X) | Past (X) | Planned (X)**

---

## Seed Data Available for Testing

| Entity | Count | Details |
|---|---|---|
| Homes | 2 | Northbridge Home (12 capacity), Lakeside Home (4 capacity) |
| Young People | 3 | Ethan Mills, Maya Daniels, Jayden Clarke — with full profiles |
| Vehicles | 3 | Ford Transit, Mercedes Vito, Nissan Qashqai — with VIN, fuel, ownership |
| Employees | 3 | Kemi Adeyemi, Liam Okoro, Nadia Mensah — with roles, DBS |
| Roles | 7 | Administrator through Young Person — with permissions |
| Events | 8 | Reg 44, fire drill, LAC review, social worker visits |
| Shifts | 29 | 10 days of coverage across both homes |
| Daily Logs | 20 | Various categories, homes, young people |
