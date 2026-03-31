# Core Entities Buildout — Homes, Young People, Vehicles, Staff/Users & Roles

## Context

Building out the full operational backbone matching ClearCare's data model. Each entity gets rich detail fields, proper CRUD, and feeds into the others. Homes are the centre — staff, young people, and vehicles are assigned to homes.

---

## Phase 1: Schema Migration — New Fields

### 1.1 Home — add rich detail fields

**New columns on `Home` model:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | String? | no | Home description |
| `category` | String? | no | e.g. "Children's Home", "Residential" |
| `region` | String? | no | Geographic region |
| `status` | String | yes, default `'current'` | `current`, `past`, `planned` |
| `phoneNumber` | String? | no | Contact phone |
| `email` | String? | no | Contact email |
| `postCode` | String? | no | Post code |
| `adminUserId` | String? | no | Home Administrator (FK to User) |
| `personInChargeId` | String? | no | Person in Charge (FK to User) |
| `responsibleIndividualId` | String? | no | Responsible Individual (FK to User) |
| `startDate` | DateTime? | no | ClearCare start date |
| `endDate` | DateTime? | no | ClearCare end date |
| `isSecure` | Boolean | yes, default `false` | Secure accommodation? |
| `shortTermStays` | Boolean | yes, default `false` | Accommodates short term stays? |
| `minAgeGroup` | Int? | no | Min age group |
| `maxAgeGroup` | Int? | no | Max age group |
| `ofstedUrn` | String? | no | Ofsted URN |
| `compliance` | Json? | no | PAT date, gas cert, fire drill dates, H&S dates, etc. |

- [x] Migration SQL
- [ ] Update Prisma schema
- [ ] Run `prisma generate`

### 1.2 YoungPerson — add rich detail fields

**New columns on `YoungPerson` model:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `preferredName` | String? | no | Preferred/nickname |
| `namePronunciation` | String? | no | |
| `description` | String? | no | |
| `gender` | String? | no | Male, Female, Other |
| `ethnicity` | String? | no | |
| `religion` | String? | no | |
| `niNumber` | String? | no | National Insurance number |
| `roomNumber` | String? | no | |
| `status` | String | yes, default `'current'` | `current`, `past`, `planned` |
| `type` | String? | no | e.g. "Fulltime Resident" |
| `admissionDate` | DateTime? | no | |
| `placementEndDate` | DateTime? | no | |
| `avatarFileId` | String? | no | FK to UploadedFile |
| `avatarUrl` | String? | no | |
| `keyWorkerId` | String? | no | FK to Employee |
| `practiceManagerId` | String? | no | FK to User |
| `adminUserId` | String? | no | YP Administrator (FK to User) |
| `socialWorkerName` | String? | no | External — not a system user |
| `independentReviewingOfficer` | String? | no | External |
| `placingAuthority` | String? | no | e.g. "Northamptonshire County Council" |
| `legalStatus` | String? | no | e.g. "Section 20" |
| `isEmergencyPlacement` | Boolean | yes, default `false` | |
| `isAsylumSeeker` | Boolean | yes, default `false` | |
| `contact` | Json? | no | address, previous address, discharge info |
| `health` | Json? | no | NHS#, doctor, allergies, medical needs, etc. |
| `education` | Json? | no | school, UPN, SEN, full-time, school run |

- [ ] Migration SQL
- [ ] Update Prisma schema

### 1.3 Vehicle — add rich detail fields

**New columns on `Vehicle` model:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | String? | no | |
| `status` | String | yes, default `'current'` | `current`, `past`, `planned` |
| `vin` | String? | no | Vehicle Identification Number |
| `registrationDate` | DateTime? | no | |
| `taxDate` | DateTime? | no | |
| `fuelType` | String? | no | Petrol, Diesel, Electric, Hybrid |
| `insuranceDate` | DateTime? | no | |
| `ownership` | String? | no | Purchased, Leased |
| `leaseStartDate` | DateTime? | no | |
| `leaseEndDate` | DateTime? | no | |
| `purchasePrice` | Decimal? | no | |
| `purchaseDate` | DateTime? | no | |
| `startDate` | DateTime? | no | In-service date |
| `endDate` | DateTime? | no | Decommission date |
| `adminUserId` | String? | no | Vehicle administrator (FK to User) |
| `contactPhone` | String? | no | |

- [ ] Migration SQL
- [ ] Update Prisma schema

### 1.4 Employee — add rich detail fields

**New columns on `Employee` model:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | String | yes, default `'current'` | `current`, `past`, `planned` |
| `endDate` | DateTime? | no | Employment end date |
| `contractType` | String? | no | Full-time, Part-time, Agency, Bank |
| `qualifications` | Json? | no | Qualifications data |
| `dbsNumber` | String? | no | DBS certificate number |
| `dbsDate` | DateTime? | no | DBS check date |

- [ ] Migration SQL
- [ ] Update Prisma schema

### 1.5 Roles — new model

**New `Role` model:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `tenantId` | String | yes | FK to Tenant |
| `name` | String | yes | e.g. "Administrator", "Registered Manager" |
| `description` | String? | no | |
| `isActive` | Boolean | yes, default `true` | |
| `isSystemGenerated` | Boolean | yes, default `false` | |
| `permissions` | Json | yes, default `{}` | Permission key-value map |
| `createdAt` | DateTime | auto | |
| `updatedAt` | DateTime | auto | |

**Constraint:** `unique([tenantId, name])`

**Add to Employee:** `roleId String?` (FK to Role)

**Default roles to seed:**

| Name | Description |
|---|---|
| Administrator | Main system administrator |
| Registered Manager | Home manager |
| Deputy Manager | Deputy home manager |
| Reg 44 Inspector | Ofsted Reg 44 Inspector |
| Residential Care Worker | Delivery of care |
| Team Leader | Care team leader |
| Young Person | Young Person personal login |

**Permission keys** (from screenshots):

| Key | Type | Notes |
|---|---|---|
| `systemAdmin` | Read/Write/No Access | System Administrator |
| `bespokeReporting` | Read/Write/No Access | |
| `bulkExports` | Read/Write/No Access | |
| `calendar` | Read/Write/No Access | |
| `uploads` | Read/Write/No Access | |
| `formsProcedures` | Read/Write/No Access | |
| `groupings` | Read/Write/No Access | |
| `dailyLogs` | Read/Write/No Access | |
| `outcomeStar` | Read/Write/No Access | |
| `regions` | Read/Write/No Access | |
| `rewards` | Read/Write/No Access | |
| `rotas` | Read/Write/No Access | |
| `sensitiveData` | Read/Write/No Access | |
| `tasks` | Read/Write/No Access | |
| `userAdmin` | Read/Write/No Access | |
| `canExportData` | True/False | |
| `canDeleteTasks` | True/False | |
| `billingApproval` | True/False | |
| `hasDashboard` | True/False | |
| `hasDocumentsModule` | True/False | |
| `canDeleteUploads` | True/False | |
| `canCreateYoungPerson` | True/False | |
| `canCreateEmployees` | True/False | |
| `canCreateVehicles` | True/False | |
| `hasReports` | True/False | |
| `hasSummary` | True/False | |

- [ ] Migration SQL
- [ ] Update Prisma schema

---

## Phase 2: Update Existing Services & Schemas

### 2.1 Homes module
- [ ] Update `CreateHomeBodySchema` with new fields
- [ ] Update `UpdateHomeBodySchema` with new fields
- [ ] Update `ListHomesQuerySchema` — add `status` filter (`current`/`past`/`planned`), `region`
- [ ] Update `listHomes` service — include counts (YPs, employees, vehicles)
- [ ] Add `GET /homes/:id/summary` — aggregated view with YPs, staff, vehicles, tasks, events
- [ ] Add `GET /homes/:id/young-people` — list YPs for this home
- [ ] Add `GET /homes/:id/employees` — list staff for this home
- [ ] Add `GET /homes/:id/vehicles` — list vehicles for this home
- [ ] Add `GET /homes/:id/tasks` — list tasks for this home
- [ ] Add `GET /homes/:id/events` — list events for this home
- [ ] Add `GET /homes/:id/shifts` — list shifts for this home
- [ ] Update `createHome` / `updateHome` with new fields
- [ ] Update JSON schemas for OpenAPI
- [ ] Update shared.schemas.ts HomeSchema

### 2.2 Young People module
- [ ] Update `CreateYoungPersonBodySchema` with all new fields
- [ ] Update `UpdateYoungPersonBodySchema`
- [ ] Update `ListYoungPeopleQuerySchema` — add `status`, `gender`, `type` filters
- [ ] Update `listYoungPeople` — return all new fields
- [ ] Update `getYoungPerson` — return full detail (health, education, contact, placement)
- [ ] Update JSON schemas for OpenAPI
- [ ] Update shared.schemas.ts YoungPersonSchema

### 2.3 Vehicles module
- [ ] Update `CreateVehicleBodySchema` with all new fields
- [ ] Update `UpdateVehicleBodySchema`
- [ ] Update `ListVehiclesQuerySchema` — add `status`, `fuelType` filters
- [ ] Update `listVehicles` — return all new fields
- [ ] Update `getVehicle` — return full detail (ownership, insurance, dates)
- [ ] Update JSON schemas for OpenAPI
- [ ] Update shared.schemas.ts VehicleSchema

### 2.4 Employees module
- [ ] Update `CreateEmployeeBodySchema` with new fields (status, endDate, contractType, roleId, etc.)
- [ ] Update `UpdateEmployeeBodySchema`
- [ ] Update `ListEmployeesQuerySchema` — add `status`, `roleId` filters
- [ ] Update `listEmployees` — return role, qualifications
- [ ] Update `getEmployee` — return full detail
- [ ] Update JSON schemas for OpenAPI
- [ ] Update shared.schemas.ts EmployeeSchema

---

## Phase 3: New Services & Endpoints

### 3.1 Home Events CRUD
- [ ] `GET /homes/:id/events` — list events for a home
- [ ] `POST /homes/:id/events` — create event at a home
- [ ] `PATCH /homes/:id/events/:eventId` — update event
- [ ] `DELETE /homes/:id/events/:eventId` — delete event
- [ ] Schema + service + routes

### 3.2 Employee Shifts CRUD
- [ ] `GET /homes/:id/shifts` — list shifts for a home
- [ ] `POST /homes/:id/shifts` — create shift at a home
- [ ] `PATCH /homes/:id/shifts/:shiftId` — update shift
- [ ] `DELETE /homes/:id/shifts/:shiftId` — delete shift
- [ ] Schema + service + routes

### 3.3 Roles CRUD
- [ ] `GET /roles` — list roles for tenant
- [ ] `GET /roles/:id` — get role with permissions
- [ ] `POST /roles` — create role
- [ ] `PATCH /roles/:id` — update role (name, description, permissions)
- [ ] `DELETE /roles/:id` — deactivate role
- [ ] `PATCH /roles/:id/permissions` — bulk update permissions
- [ ] Register routes at `/api/v1/roles`
- [ ] Schema + service + routes

### 3.4 Users — enhanced create flow (multi-step)
- [ ] Update user creation to support:
  - Step 1: Personal Info (username, name, email, DOB, user type, care group, role)
  - Step 2: Access (password, disable login date, password expiry, landing page, toggles)
  - Step 3: Corresponding Record (link to employee/YP)
- [ ] User types: `internal`, `external`, `young_person`
- [ ] Add `roleId` to user/employee creation

---

## Phase 4: Seed Data

- [ ] Seed rich home data for izuobani tenant (compliance, Ofsted, contact details)
- [ ] Seed young people with full detail (health, education, placement, contact)
- [ ] Seed vehicles with full detail (VIN, insurance, ownership, dates)
- [ ] Seed employees with roles, qualifications, DBS
- [ ] Seed default roles with permissions
- [ ] Seed home events (calendar items)
- [ ] Seed employee shifts (rotas)

---

## Phase 5: Reports (Home-level)

- [ ] `GET /homes/:id/reports/access` — who accessed task logs
- [ ] `GET /homes/:id/reports/daily-audit` — daily audit of tasks by date
- [ ] `GET /homes/:id/reports/employee-stats` — employee info for Ofsted
- [ ] `GET /homes/:id/reports/daily-record` — daily report + logs for a day
- [ ] `GET /homes/:id/reports/monthly-record` — monthly report + logs
- [ ] `GET /homes/:id/reports/weekly-record` — weekly report + logs
- [ ] `GET /homes/:id/reports/statistics` — log statistics

---

## Implementation Order

1. **Phase 1** (Schema) — single migration with all new fields + Role model
2. **Phase 2** (Update services) — homes, YP, vehicles, employees
3. **Phase 3.3** (Roles) — needed before enhanced user creation
4. **Phase 3.1-3.2** (Events + Shifts)
5. **Phase 3.4** (Users enhanced create)
6. **Phase 4** (Seed)
7. **Phase 5** (Reports) — can be incremental

---

## Files to Create/Modify

### New files:
- `prisma/migrations/YYYYMMDD_core_entities_buildout/migration.sql`
- `src/modules/roles/roles.schema.ts`
- `src/modules/roles/roles.service.ts`
- `src/modules/roles/roles.routes.ts`

### Modified files:
- `prisma/schema.prisma` — Home, YoungPerson, Vehicle, Employee, new Role model
- `src/modules/homes/homes.schema.ts`
- `src/modules/homes/homes.service.ts`
- `src/modules/homes/homes.routes.ts`
- `src/modules/young-people/young-people.schema.ts`
- `src/modules/young-people/young-people.service.ts`
- `src/modules/young-people/young-people.routes.ts`
- `src/modules/vehicles/vehicles.schema.ts`
- `src/modules/vehicles/vehicles.service.ts`
- `src/modules/vehicles/vehicles.routes.ts`
- `src/modules/employees/employees.schema.ts`
- `src/modules/employees/employees.service.ts`
- `src/modules/employees/employees.routes.ts`
- `src/openapi/shared.schemas.ts`
- `src/routes/index.ts` — register roles
- `scripts/seed-izu-rich-data.mjs` — rich seed data
