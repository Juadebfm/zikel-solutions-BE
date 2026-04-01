# Core Entities Buildout — Homes, Young People, Vehicles, Staff/Users & Roles

## Status: COMPLETE ✓

---

## Phase 1: Schema Migration — New Fields ✓

- [x] 1.1 Home — 18 new columns (description, postCode, category, region, status, phone, email, admin/personInCharge/responsibleIndividual FKs, dates, Ofsted, compliance, age groups, secure/shortTerm)
- [x] 1.2 YoungPerson — 23 new columns (preferredName, gender, ethnicity, religion, NI#, status, type, placement dates, keyWorker FK, avatar, socialWorker, legal, health/education/contact JSON)
- [x] 1.3 Vehicle — 15 new columns (description, status, VIN, fuelType, insurance, ownership, lease/purchase, dates, admin, phone)
- [x] 1.4 Employee — 6 new columns (roleId FK, endDate, status, contractType, DBS, qualifications)
- [x] 1.5 Role — new model (name, description, permissions JSON, isSystemGenerated)
- [x] 1.6 User — 9 new columns (userType, dateOfBirth, otherNames, landingPage, hideFutureTasks, enableIpRestriction, passwordExpiresInstantly, disableLoginAt, passwordExpiresAt)

---

## Phase 2: Update Existing Services & Schemas ✓

### 2.1 Homes module
- [x] Update `CreateHomeBodySchema` with new fields
- [x] Update `UpdateHomeBodySchema` with new fields
- [x] Update `ListHomesQuerySchema` — add `status` filter
- [x] Update `listHomes` service — include counts (YPs, employees, vehicles)
- [x] Add `GET /homes/:id/summary` — aggregated view
- [x] Add `GET /homes/:id/young-people`
- [x] Add `GET /homes/:id/employees`
- [x] Add `GET /homes/:id/vehicles`
- [x] Add `GET /homes/:id/tasks`
- [x] Add `GET /homes/:id/events`
- [x] Add `GET /homes/:id/shifts`
- [x] Update `createHome` / `updateHome` with new fields
- [x] Update JSON schemas for OpenAPI
- [x] Update shared.schemas.ts HomeSchema

### 2.2 Young People module
- [x] Update `CreateYoungPersonBodySchema` with all new fields
- [x] Update `UpdateYoungPersonBodySchema`
- [x] Update `ListYoungPeopleQuerySchema` — add `status`, `gender`, `type` filters
- [x] Update `listYoungPeople` — return all new fields
- [x] Update `getYoungPerson` — return full detail
- [x] Update JSON schemas for OpenAPI
- [x] Update shared.schemas.ts YoungPersonSchema

### 2.3 Vehicles module
- [x] Update `CreateVehicleBodySchema` with all new fields
- [x] Update `UpdateVehicleBodySchema`
- [x] Update `ListVehiclesQuerySchema` — add `status`, `fuelType` filters
- [x] Update `listVehicles` — return all new fields
- [x] Update `getVehicle` — return full detail
- [x] Update JSON schemas for OpenAPI
- [x] Update shared.schemas.ts VehicleSchema

### 2.4 Employees module
- [x] Update `CreateEmployeeBodySchema` with new fields
- [x] Update `UpdateEmployeeBodySchema`
- [x] Update `ListEmployeesQuerySchema` — add `status`, `roleId` filters
- [x] Update `listEmployees` — return role, qualifications
- [x] Update `getEmployee` — return full detail
- [x] Update JSON schemas for OpenAPI
- [x] Update shared.schemas.ts EmployeeSchema

---

## Phase 3: New Services & Endpoints ✓

### 3.1 Home Events CRUD
- [x] `GET /homes/:id/events`
- [x] `POST /homes/:id/events`
- [x] `PATCH /homes/:id/events/:eventId`
- [x] `DELETE /homes/:id/events/:eventId`

### 3.2 Employee Shifts CRUD
- [x] `GET /homes/:id/shifts`
- [x] `POST /homes/:id/shifts`
- [x] `PATCH /homes/:id/shifts/:shiftId`
- [x] `DELETE /homes/:id/shifts/:shiftId`

### 3.3 Roles CRUD
- [x] `GET /roles`
- [x] `GET /roles/:id`
- [x] `POST /roles`
- [x] `PATCH /roles/:id`
- [x] `PATCH /roles/:id/permissions`
- [x] `DELETE /roles/:id`
- [x] Register routes at `/api/v1/roles`

### 3.4 Users — enhanced create flow
- [x] `POST /employees/create-with-user` — multi-step user+employee creation
  - Step 1: Personal Info (firstName, lastName, otherNames, email, DOB, userType, careGroupId, roleId, avatar)
  - Step 2: Access (password, disableLoginAt, passwordExpiresAt, landingPage, hideFutureTasks, enableIpRestriction, passwordExpiresInstantly)
  - Step 3: Corresponding Record (homeId, jobTitle, startDate, contractType)
- [x] User types: `internal`, `external`, `young_person`
- [x] Creates User + TenantMembership + Employee in one call

---

## Phase 4: Seed Data ✓

- [x] 2 homes with full ClearCare-matching detail (compliance, Ofsted, contact)
- [x] 3 young people with full profiles (health, education, placement, contact)
- [x] 3 vehicles with full detail (VIN, fuel, ownership, dates)
- [x] 3 employees with roles, DBS, contract types
- [x] 7 default roles with permissions
- [x] 8 home events
- [x] 29 employee shifts
- [x] 20 daily logs
- [x] Key worker assignments, home admin/responsible people set

---

## Phase 5: Reports ✓

- [x] `GET /homes/:id/summary` — full aggregated view (YPs, staff, vehicles, events, shifts, task stats)
- [x] `GET /homes/:id/reports/access` — access audit trail
- [x] `GET /homes/:id/reports/daily-audit?date=YYYY-MM-DD` — daily audit
- [x] `GET /homes/:id/reports/employee-stats` — employee info for Ofsted
- [x] `GET /homes/:id/reports/statistics` — home-level statistics
- [x] `GET /homes/:id/reports/weekly-record?startDate=&endDate=` — weekly record
- [x] `GET /homes/:id/reports/monthly-record?startDate=&endDate=` — monthly record

