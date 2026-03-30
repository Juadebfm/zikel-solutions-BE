# Task Plan: Types, Attached Forms, and Backend Readiness

## 1. Catalog Capture Checklist

### Task Status Types (captured from screenshots)

- [x] Submitted
- [x] Draft
- [x] Sent For Approval
- [x] Approved
- [x] Rejected
- [x] Sent For Deletion
- [x] Deleted
- [x] Deleted Draft
- [x] Hidden

### Type: Home (captured list)

- [x] Daily Ligature Check
- [x] Daily PM Sharps Checks
- [x] Daily Window Restrictor Checks
- [x] Fridge/Freezer Temps
- [x] House Evacuation
- [x] House Information
- [x] House Team Meeting
- [x] KPI Home Extended Data
- [x] Location Of Premises Risk Assessment
- [x] Maintenance Request
- [x] Manager's Weekly Medication Audit
- [x] Managers Response To Reg 44 Actions
- [x] Notification To Ofsted
- [x] Petty Cash
- [x] Placement Impact Evaluation
- [x] Pool Car Checks
- [x] Property Damage
- [x] REG 44 OR OFSTED ACTIONS
- [x] REG 44 VISIT REPORT FORM
- [x] Reg 45 Review Summary Form
- [x] Regulation 40
- [x] Regulation 45
- [x] Waking Night Summary
- [x] Weekly Building Audit
- [x] Weekly Coshh Check
- [x] Weekly Deep Cleaning
- [x] Weekly Fire Alarm And Equipment Checks
- [x] Weekly First Aid Checks
- [x] Weekly Vehicle First Aid Checks
- [x] Weekly Water Temp Checks

### Type: Young Person (captured list)

- [x] Absence Form
- [x] Absence Return Form
- [x] Accident/ Injury Form
- [x] Action/ Response Required
- [x] Activity
- [x] Brief Assessment Checklist For Adolescents (Ages 12 To 17)
- [x] Brief Assessment Checklist For Children ( Ages 4-11 )
- [x] CARE PLAN DOCUMENTS
- [x] Celebration
- [x] Children's Global Assessment Scale (CGAS)
- [x] Clinical Commentary
- [x] Clinical Plans
- [x] Complaint
- [x] CONSEQUENCES FORM
- [x] Contact Form
- [x] Daily Handover
- [x] Daily Handover NO TRIGGER
- [x] Daily Summary
- [x] Debrief
- [x] Disclosure
- [x] Education/Work
- [x] Enuresis And Encopresis
- [x] Good News And Achievements
- [x] Health Appointment
- [x] HoNOSCA
- [x] Incident
- [x] Keyworker Session
- [x] KPI Resident Extended Data
- [x] Managers Action/ Response
- [x] Medication Dispensed
- [x] Medication Disposal Form
- [x] Medication Signed Into The Home
- [x] Mood And Feelings Questionaire (Parent Assessment On Child) Long Version
- [x] Mood And Feelings Questionnaire (Adult Self Report) Long Version
- [x] Mood And Feelings Questionnaire (Child Self-Report) Long Version
- [x] My Star Action Plan
- [x] Parent/Carer Strengths And Difficulties Questionnaire
- [x] PEEP Evacuation Matrix
- [x] Personal Development
- [x] Personal Emergency Evacuation Plan (PEEP)
- [x] Physical Intervention
- [x] Placement Information
- [x] Pre-Inspection Individual Summary
- [x] Professional Contact
- [x] Professional Contact Form
- [x] Record Of Conversation
- [x] REG 45 Pre-Inspection Individual Summary
- [x] Response To Complaint
- [x] REWARDS FORM
- [x] Risk Assessment (Activity/Task)
- [x] Room/Possessions Log Search
- [x] Safe And Well Check
- [x] School Report Form
- [x] Self Harm
- [x] Self-Report Strengths And Difficulties Questionnaire
- [x] Spence Anxiety Scale (Parent/Carer)
- [x] Teacher Strengths And Difficulties Questionnaire
- [x] The Estimate Risk Of Adolescent Sexual Offence Recidivism (ERASOR)
- [x] The General Self Efficacy Scale GSE
- [x] The Spence Children's Anxiety Scale (Child Version)
- [x] The Warwick Edinburgh Mental Well-Being Scale (WEMWBS)
- [x] Waking Night Summary
- [x] Weekly Activity Planner
- [x] Weekly Menu
- [x] Weekly Summary Report For YPs
- [x] Young Person Finance Check AM
- [x] Young Person Finance Check PM
- [x] Young Person Finance Check PM 1
- [x] Young Person's Star Action Plan
- [x] Young Person(S) Meeting
- [x] Young Persons Room Check
- [x] YP Centered Professional Meetings

### Type: Vehicle (captured list)

- [x] Car Repairs
- [x] Vehicle Damage Form
- [x] Vehicle Form
- [x] Weekly Vehicle Check

## 2. Task Explorer Backend Implementation Checklist

### Endpoint Coverage

- [x] `GET /api/v1/tasks` implemented with server-side pagination, filtering, sorting, and labels/meta envelope.
- [x] `GET /api/v1/tasks/:id` implemented with detailed payload (`attachments`, `approvalChain`, `activityLog`, `comments`, `formData`, `auditTrail`).
- [x] `POST /api/v1/tasks` implemented.
- [x] `PATCH /api/v1/tasks/:id` implemented.
- [x] `POST /api/v1/tasks/:id/actions` implemented (`submit`, `approve`, `reject`, `reassign`, `request_deletion`, `comment`).
- [x] `GET /api/v1/tasks/categories` implemented.
- [x] `GET /api/v1/tasks/form-templates` implemented.

### Data Contract Coverage

- [x] `taskRef` display ID is returned.
- [x] Task includes `category`, `categoryLabel`, `type`, `typeLabel`, `status`, `statusLabel`, `workflowStatus`, `approvalStatus`, `priority`, `dueAt`, `submittedAt`.
- [x] Task includes `relatedEntity` (`type`, `id`, `name`, `homeId`, `careGroupId`) when resolvable.
- [x] Task includes user identity payloads for `assignee`, `createdBy`, and `approvers` with `avatarUrl` when available.
- [x] Task includes `links` (`taskUrl`, `documentUrl`) and `referenceSummary`.
- [x] Task includes `timestamps` (`createdAt`, `updatedAt`).

### Runtime Verification (done on 2026-03-29)

- [x] `npm run build` passes.
- [x] `npm test` passes (`130 passed`, `1 skipped`).
- [x] Route registration confirmed at `/api/v1/tasks` in `src/routes/index.ts`.

### Remaining Work

- [x] Add explicit happy-path route tests for task detail/create/update/action transitions (covered in `tests/operations.routes.test.ts` for detail/create/update/action happy paths).
- [x] Canonicalize naming/casing differences between seed labels and FE labels before final FE/BE lock (seeded `formGroup` now maps from canonical category label map in `scripts/seed-izu-rich-data.mjs`).
- [ ] FE sign-off on final rendered contract for Task Explorer cards/table/detail drawer.

## 3. Notes

- [x] This document reflects values shown in your UI screenshots (spelling/casing preserved as displayed).
