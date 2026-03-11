# zikel-solutions MVP Build Tracker

Single source of truth for implementation progress across all endpoints in `needed.md`.
All endpoints are MVP scope.

## Status Legend

- `NS` = Not Started
- `IP` = In Progress
- `BLK` = Blocked
- `DEV-DONE` = Implemented in code
- `QA-DONE` = Tested and verified

## Guardrail Legend (from `guardrails.md`)

- `G1` Authentication & Authorization
- `G2` Input Validation & Injection Prevention
- `G3` Transport & Network Security
- `G4` Rate Limiting & DoS Protection
- `G5` Data Security & Privacy
- `G6` Secure Architectural Patterns
- `G7` Logging, Monitoring & Incident Response
- `G8` Secure API Design
- `G9` Infrastructure & Deployment Security
- `G10` Business Logic & Advanced Patterns
- `G11` Agent Quick-Reference Checklists
- `G12` zikel-solutions Therapeutic/Safeguarding/Compliance Guardrails

## Wave 1 Critical Path

### Auth

- [x] `POST /api/v1/auth/login` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `POST /api/v1/auth/register` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `GET /api/v1/auth/check-email` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/auth/verify-otp` | Status: `IP` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/auth/resend-otp` | Status: `IP` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `POST /api/v1/auth/forgot-password` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `POST /api/v1/auth/reset-password` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `POST /api/v1/auth/refresh` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `POST /api/v1/auth/logout` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`

### Me

- [x] `GET /api/v1/me` | Status: `DEV-DONE` | Guardrails: `G1,G2,G5,G7,G8,G11`
- [x] `PATCH /api/v1/me` | Status: `DEV-DONE` | Guardrails: `G1,G2,G5,G7,G8,G11`
- [x] `POST /api/v1/me/change-password` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `GET /api/v1/me/permissions` | Status: `DEV-DONE` | Guardrails: `G1,G5,G7,G8,G11`
- [x] `GET /api/v1/me/preferences` | Status: `DEV-DONE` | Guardrails: `G1,G5,G7,G8,G11`
- [x] `PATCH /api/v1/me/preferences` | Status: `DEV-DONE` | Guardrails: `G1,G2,G5,G7,G8,G11`

### Announcements

- [x] `GET /api/v1/announcements` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `GET /api/v1/announcements/:id` | Status: `DEV-DONE` | Guardrails: `G1,G2,G5,G7,G8,G11`
- [x] `POST /api/v1/announcements/:id/read` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `POST /api/v1/announcements` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `PATCH /api/v1/announcements/:id` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [x] `DELETE /api/v1/announcements/:id` | Status: `DEV-DONE` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`

## Full Endpoint Backlog (Auto-imported from `needed.md`)

- [ ] `POST /api/v1/auth/login` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/auth/register` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/auth/check-email?email=user@example.com` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/auth/verify-otp` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/auth/resend-otp` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/auth/forgot-password` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/auth/reset-password` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/auth/refresh` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/auth/logout` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/me` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/me` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/me/change-password` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/me/permissions` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/me/preferences` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/me/preferences` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/me/summary` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/me/tasks?status=overdue&limit=10` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/me/dashboard/widgets` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PUT /api/v1/me/dashboard/widgets` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/me/dashboard/widgets/:widgetId/data` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/announcements?status=unread&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/announcements/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/announcements/:id/read` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/announcements` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/announcements/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/announcements/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/care-groups?page=1&limit=20&search=&type=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/care-groups/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/care-groups` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/care-groups/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/care-groups/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/care-groups/:id/homes?status=current` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/care-groups/:id/stakeholders` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/care-groups/:id/stakeholders` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/care-groups/:careGroupId/stakeholders/:stakeholderId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/care-groups/:careGroupId/stakeholders/:stakeholderId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/care-groups/:id/settings` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/care-groups/:id/settings` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/homes?page=1&limit=20&search=&status=active&careGroupId=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/homes/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/homes` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/homes/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/homes/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/homes/:id/settings?category=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/homes/:id/settings` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/homes/:homeId/settings/:itemId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/homes/:homeId/settings/:itemId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/homes/:id/audit?category=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/young-people?page=1&limit=20&search=&status=current&homeId=&type=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/young-people/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/young-people` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/young-people/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/young-people/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/young-people/:id/tasks?status=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/young-people/:id/ioi-logs?status=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/young-people/:id/rewards?page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/young-people/:id/rewards` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/young-people/:youngPersonId/rewards/:rewardId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/young-people/:id/outcome-stars?page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/young-people/:id/outcome-stars` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/young-people/settings?category=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/young-people/settings` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/young-people/settings/:itemId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/young-people/settings/:itemId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/young-people/audit?youngPersonId=&category=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/employees?page=1&limit=20&search=&status=current&homeId=&role=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/employees/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/employees` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/employees/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/employees/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/employees/:id/permissions` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PUT /api/v1/employees/:id/permissions` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/employees/settings?category=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/employees/settings` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/employees/settings/:itemId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/employees/settings/:itemId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/employees/audit?employeeId=&category=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/users?page=1&limit=20&search=&role=&status=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/users/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/users` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/users/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/users/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/users/:id/reset-password` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/tasks?page=1&limit=20&status=&assignedTo=&youngPersonId=&homeId=&priority=&category=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/tasks/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/tasks` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/tasks/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/tasks/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/tasks/:id/submit` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/tasks/:id/approve` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/tasks/:id/reject` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/tasks/:id/comments` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/tasks/:id/comments` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/task-explorer/search` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/task-explorer/forms?type=young-person&project=home-1` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/ioi-logs?page=1&limit=20&status=&youngPersonId=&authorId=&homeId=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/ioi-logs/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/ioi-logs` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/ioi-logs/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/ioi-logs/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/ioi-logs/:id/submit` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/ioi-logs/:id/approve` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/ioi-logs/:id/reject` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/daily-logs?page=1&limit=20&homeId=&date=&authorId=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/daily-logs/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/daily-logs` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/daily-logs/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/daily-logs/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/rotas?homeId=home-1&weekOf=2024-01-08` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PUT /api/v1/rotas` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/rotas/shifts/:shiftId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/calendar?homeId=&from=2024-01-01&to=2024-01-31&type=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/calendar/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/calendar` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/calendar/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/calendar/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/vehicles?page=1&limit=20&homeId=&status=current` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/vehicles/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/vehicles` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/vehicles/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/vehicles/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/vehicles/settings?category=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/vehicles/settings` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/vehicles/settings/:itemId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/vehicles/settings/:itemId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/vehicles/audit?vehicleId=&category=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/documents?entityType=&entityId=&category=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/documents` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/documents/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/documents/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/reports/templates` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/reports/generate` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/reports/:reportId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/reports?page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/exports` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/exports/:exportId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/exports?page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/uploads` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/uploads/:uploadId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/uploads?page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/forms?category=&homeId=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/forms/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/forms` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/forms/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/forms/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/regions` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/regions` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/regions/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/regions/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/groupings?type=` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/groupings` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/groupings/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `DELETE /api/v1/groupings/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/sensitive-data?entityType=young-person&entityId=1` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/sensitive-data/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/system-settings` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `PATCH /api/v1/system-settings` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/help?search=&category=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `GET /api/v1/help/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/help/support` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11`
- [ ] `POST /api/v1/compliance/evidence-packs/reg44` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `POST /api/v1/compliance/evidence-packs/reg45` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/compliance/evidence-packs?type=&status=&homeId=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/compliance/evidence-packs/:packId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/compliance/evidence-packs/:packId/download` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/safeguarding/chronologies/:youngPersonId?from=&to=&includeLinkedRecords=true` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `POST /api/v1/safeguarding/chronologies/:youngPersonId/rebuild` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/safeguarding/escalations?status=&severity=&homeId=&assignedTo=&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/safeguarding/escalations/:id` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `POST /api/v1/safeguarding/escalations/:id/acknowledge` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `POST /api/v1/safeguarding/escalations/:id/resolve` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `POST /api/v1/safeguarding/incidents/patterns/query` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/safeguarding/incidents/patterns/:patternId` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/ri-monitoring/dashboard?homeId=&period=this-month` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/ri-monitoring/dashboard/homes?period=this-month&page=1&limit=20` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `GET /api/v1/recording/prompts/reflective?context=incident` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
- [ ] `POST /api/v1/recording/prompts/reflective/generate` | Status: `NS` | Guardrails: `G1,G2,G4,G5,G7,G8,G11,G12`
