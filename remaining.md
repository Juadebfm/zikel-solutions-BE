# Remaining API Delivery Checklist

This checklist is split into:
- what is already implemented and verified in this backend (`[x]`)
- what is still required for the FE contract (`[ ]`)

## 1) Verified Existing Endpoints (`[x]`)

### Documents Foundation (Uploads Infrastructure)
- [x] `POST /api/v1/uploads/sessions`
- [x] `POST /api/v1/uploads/:id/complete`
- [x] `GET /api/v1/uploads/:id/download-url`

### Reports (Reg/RI)
- [x] `GET /api/v1/reports/reg44-pack`
- [x] `GET /api/v1/reports/reg45-pack`
- [x] `GET /api/v1/reports/ri-dashboard`
- [x] `GET /api/v1/reports/ri-dashboard/drilldown`

### Existing Entity Export Endpoints (Non-Job Based)
- [x] `GET /api/v1/homes/export`
- [x] `GET /api/v1/employees/export`
- [x] `GET /api/v1/young-people/export`
- [x] `GET /api/v1/vehicles/export`
- [x] `GET /api/v1/tasks/export`

### Settings Foundation
- [x] `GET /api/v1/me`
- [x] `PATCH /api/v1/me`
- [x] `GET /api/v1/me/preferences`
- [x] `PATCH /api/v1/me/preferences`
- [x] `GET /api/v1/notifications/preferences`
- [x] `PUT /api/v1/notifications/preferences`

### Scheduling Foundation (Home-Scoped)
- [x] `GET /api/v1/homes/:id/events`
- [x] `POST /api/v1/homes/:id/events`
- [x] `PATCH /api/v1/homes/:id/events/:eventId`
- [x] `DELETE /api/v1/homes/:id/events/:eventId`
- [x] `GET /api/v1/homes/:id/shifts`
- [x] `POST /api/v1/homes/:id/shifts`
- [x] `PATCH /api/v1/homes/:id/shifts/:shiftId`
- [x] `DELETE /api/v1/homes/:id/shifts/:shiftId`

### Organisation Foundation
- [x] `GET /api/v1/care-groups`
- [x] `GET /api/v1/care-groups/:id`
- [x] `POST /api/v1/care-groups`
- [x] `PATCH /api/v1/care-groups/:id`
- [x] `DELETE /api/v1/care-groups/:id`

## 2) Remaining Endpoints To Implement (`[ ]`)

### 2.1 Documents (Merging Uploads + Documents)
- [x] `GET /api/v1/documents`
- [x] `GET /api/v1/documents/:id`
- [x] `POST /api/v1/documents`
- [x] `PATCH /api/v1/documents/:id`
- [x] `DELETE /api/v1/documents/:id`
- [x] `GET /api/v1/documents/categories`

### 2.2 Reports → Bulk Exports Tab (Job-Based)
- [x] `POST /api/v1/exports`
- [x] `GET /api/v1/exports`
- [x] `GET /api/v1/exports/:id`
- [x] `GET /api/v1/exports/:id/download`

### 2.3 Settings (Organisation/System Scope)
- [x] `GET /api/v1/settings/organisation`
- [x] `PATCH /api/v1/settings/organisation`
- [x] `GET /api/v1/settings/notifications`
- [x] `PATCH /api/v1/settings/notifications`

### 2.4 Scheduling (Calendar + Rotas)

#### Calendar Events
- [x] `GET /api/v1/calendar/events`
- [x] `GET /api/v1/calendar/events/:id`
- [x] `POST /api/v1/calendar/events`
- [x] `PATCH /api/v1/calendar/events/:id`
- [x] `DELETE /api/v1/calendar/events/:id`

#### Rotas
- [x] `GET /api/v1/rotas`
- [x] `GET /api/v1/rotas/:id`
- [x] `POST /api/v1/rotas`
- [x] `PATCH /api/v1/rotas/:id`
- [x] `DELETE /api/v1/rotas/:id`
- [x] `GET /api/v1/rotas/templates`
- [x] `POST /api/v1/rotas/templates`

### 2.5 Organisation (Regions + Groupings)

#### Regions
- [x] `GET /api/v1/regions`
- [x] `GET /api/v1/regions/:id`
- [x] `POST /api/v1/regions`
- [x] `PATCH /api/v1/regions/:id`
- [x] `DELETE /api/v1/regions/:id`

#### Groupings
- [x] `GET /api/v1/groupings`
- [x] `GET /api/v1/groupings/:id`
- [x] `POST /api/v1/groupings`
- [x] `PATCH /api/v1/groupings/:id`
- [x] `DELETE /api/v1/groupings/:id`

### 2.6 Sensitive Data (Standalone)
- [x] `GET /api/v1/sensitive-data`
- [x] `GET /api/v1/sensitive-data/:id`
- [x] `POST /api/v1/sensitive-data`
- [x] `PATCH /api/v1/sensitive-data/:id`
- [x] `DELETE /api/v1/sensitive-data/:id`
- [x] `GET /api/v1/sensitive-data/categories`
- [x] `GET /api/v1/sensitive-data/:id/access-log`

## 3) Current Remaining Count
- [x] Remaining endpoints from this FE contract: **0**
