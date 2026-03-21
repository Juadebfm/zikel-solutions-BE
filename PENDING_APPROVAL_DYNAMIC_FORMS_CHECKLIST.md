# Pending Approval + Dynamic Forms Implementation Checklist

This checklist tracks the backend implementation for:
- Dynamic form templates
- Dynamic submitted task payloads
- Pending Approval list/detail endpoints
- KPI bucket consistency (`overdue`, `due today`, `pending approval`, etc.)

## Phase 1: Schema + Migration

- [x] Add `FormTemplate` model to Prisma schema
- [x] Extend `Task` model with dynamic form fields:
  - [x] `formTemplateKey`
  - [x] `formName`
  - [x] `formGroup`
  - [x] `submissionPayload` (JSON)
  - [x] `submittedAt`
  - [x] `submittedById`
  - [x] `updatedById`
- [x] Add indexes for new query paths (`formTemplateKey`, `formGroup`, `submittedById`, `updatedById`)
- [x] Create migration SQL file
- [x] Run `npm run build`
- [x] Run `npm run db:migrate:deploy`

## Phase 2: Pending Approval API (List + Detail)

- [x] Extend `GET /api/v1/summary/tasks-to-approve` response with table-ready fields:
  - [x] `taskRef`
  - [x] `title`
  - [x] `formGroup`
  - [x] `approvalStatus` (+ friendly label mapping)
  - [x] `homeOrSchool`
  - [x] `relatedTo`
  - [x] `taskDate`
  - [x] `submittedOn`
  - [x] `submittedBy`
  - [x] `updatedOn`
  - [x] `updatedBy`
- [x] Add list filters:
  - [x] `formGroup`
  - [x] `taskDateFrom`
  - [x] `taskDateTo`
  - [x] `search`
- [x] Add `GET /api/v1/summary/tasks-to-approve/:id` detail endpoint
- [x] Return dynamic detail payload for FE rendering (`sections`, `fields`, values)
- [x] Update OpenAPI schemas/docs

## Phase 3: Workflow/Bucket Rules

- [x] Enforce/align bucket routing rules in summary stats:
  - [x] `pending_approval` -> Pending Approval
  - [x] `rejected` -> Rejected Tasks
  - [x] `pending + dueDate null` -> Draft Tasks
  - [x] `pending|in_progress + dueDate < today` -> Overdue Tasks
  - [x] `pending|in_progress + dueDate == today` -> Tasks Due Today
  - [x] `pending|in_progress + dueDate > today` -> Future Tasks

## Phase 4: Seed Data (Dynamic Forms)

- [x] Seed form catalog entries from the available form types
- [x] Seed pending approval items across multiple form types
- [x] Seed at least 5 rich detail examples with different payload structures
- [x] Ensure seeded data supports table + detail drill-down views

## Phase 5: Label Cleanup

- [x] Apply standardized backend-facing labels where appropriate:
  - [x] `Pending Approval` -> `Items Awaiting Approval`
  - [x] `Configured Information` -> `Current Filters`
  - [x] `Form Name` -> `Form`
  - [x] `Log Statuses` -> `Submission Status`
  - [x] `Status` -> `Approval Status`
  - [x] `Home Or School` -> `Home / School`
  - [x] `Relates To` -> `Related To`
  - [x] `Task Date` -> `Due Date`
  - [x] `Originally Recorded On` -> `Submitted On`
  - [x] `Originally Recorded By` -> `Submitted By`
  - [x] `Last Updated On` -> `Updated On`
  - [x] `Last Updated By` -> `Updated By`
  - [x] `sent for approval` -> `Awaiting Approval`
  - [x] `reset grid` -> `Reset table`
- [x] Keep per-form field labels dynamic from template/payload (no hardcoded replacement)

## Phase 6: Validation + Deploy

- [x] Add/extend tests for list filters and dynamic detail endpoint
- [x] Verify build + tests pass
- [x] Push changes to `main`
- [x] Deploy to Fly
- [x] Verify live endpoints and expected counts/states
