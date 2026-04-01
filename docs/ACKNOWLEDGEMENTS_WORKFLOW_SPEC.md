# Acknowledgements Workflow Spec

Last verified: 2026-03-24  
Status: Backend enforcement implemented; FE RBAC playbook remains a separate workstream

## Purpose

Define the "Acknowledgements Required" flow where an approver must review item(s) before acknowledging, with support for:

- single-item acknowledge
- multi-select acknowledge
- select-all acknowledge
- single submit action only after all items in the popup have been reviewed

## Scope

This spec covers:

- frontend behavior and validation
- current backend integration path
- current backend-enforced review gate behavior

This spec does not change the RBAC reference document.

## Business Rules

1. Only approval-capable users can acknowledge pending items.
2. A user cannot acknowledge any item until every document in the immediate-login acknowledgement popup has been reviewed.
3. Review means user has attempted one of:
   - open/view detail
   - download/open document
   - navigate to linked task content
4. Each row must reach `reviewed` state before submit can be enabled.
5. User can select 1, many, or all rows and submit once, but only after the global review prerequisite is satisfied.
6. Acknowledge outcome maps to backend approval completion.
7. If any document in the popup has not been reviewed, submit must be blocked regardless of current row selection.

## Role Access

Uses existing summary approval roles from backend:

- `super_admin`
- `admin`
- `manager`
- `tenant_admin`
- `sub_admin`

Non-approver users must not access this workflow.

## State Model

## UI Row State (frontend)

- `pending_review`: item not yet reviewed by current user
- `reviewed`: review prerequisite satisfied
- `acknowledging`: submit in progress
- `acknowledged`: submit succeeded
- `failed`: submit failed with actionable reason

## Backend Task State (current)

- source queue: `approvalStatus = pending_approval`
- acknowledged equivalent: `approvalStatus = approved`

Note: there is no dedicated `acknowledged` enum in current DB schema.

## Current Backend Endpoints (usable now)

- List pending approvals (overdue blocking set): `GET /api/v1/summary/tasks-to-approve?scope=gate`
- List non-blocking non-overdue reminders: `GET /api/v1/summary/tasks-to-approve?scope=popup`
- Full pending queue (admin table views only): `GET /api/v1/summary/tasks-to-approve?scope=all`
- Get item detail: `GET /api/v1/summary/tasks-to-approve/:id`
- Record review evidence: `POST /api/v1/summary/tasks-to-approve/:id/review-events`
- Record review evidence (alias): `POST /api/v1/summary/tasks-to-approve/:id/review-event`
- Single approve: `POST /api/v1/summary/tasks-to-approve/:id/approve`
- Single approve (alias): `POST /api/v1/summary/tasks-to-approve/:id/approval`
- Batch approve/reject: `POST /api/v1/summary/tasks-to-approve/process-batch`
- Batch approve/reject (alias): `POST /api/v1/summary/tasks-to-approve/approvals`

### Response Responsibilities

- `GET /summary/tasks-to-approve` is the queue endpoint and now includes `context` per row:
  - `formName`, `formGroup`, `homeOrSchool`, `relatedTo`, `taskDate`, `submittedBy`, `updatedBy`, `summary`
- `GET /summary/tasks-to-approve/:id` is the canonical full-detail endpoint for rendering complete task/event context.
- `POST /summary/tasks-to-approve/:id/review-events` intentionally returns only review-state metadata and does not return full task details.

Batch request for acknowledge:

```json
{
  "taskIds": ["task_1", "task_2"],
  "action": "approve",
  "signatureFileId": "file_sig_123"
}
```

Single acknowledge request now supports optional signature evidence:

```json
{
  "comment": "Approved",
  "signatureFileId": "file_sig_123",
  "gateScope": "task"
}
```

`gateScope` behavior:
- `task` (default for single approve): requires review of the current task only.
- `global`: requires all overdue pending approvals to be reviewed before submit.

Batch response shape:

```json
{
  "processed": 2,
  "failed": []
}
```

Batch also supports `gateScope`:
- `global` (default for batch approve): global overdue review gate.
- `task`: requires review per selected task IDs.

## UX Flow (target behavior)

1. Load table with pending items.
2. Row status starts as `pending_review`.
3. User reviews row by opening detail or download action.
4. Row switches to `reviewed`.
5. User may select one/many/all rows.
6. User clicks submit once.
7. FE validates all rows in the popup dataset are reviewed (not only selected rows).
8. FE sends batch approve call.
9. Success rows leave queue; failed rows stay visible with reason.

Validation message when blocked:

- `Please review the item(s) before acknowledging.`

## FE Implementation Notes

1. Trigger page/modal only for approval-capable users.
2. Use pending count from `GET /api/v1/summary/stats` (`pendingApproval`) to decide popup trigger.
3. Keep a per-row reviewed flag in state.
4. Update reviewed flag when user performs review action.
5. Keep submit disabled until every row in the popup dataset is reviewed.
6. If submit is attempted early, show: `Please review the item(s) before acknowledging.`
7. Selection is independent of review gate:
   - user may pre-select one/many/all rows;
   - submit still blocked until all popup rows are reviewed.
8. If pagination is used, review state must be tracked across pages; global gate is satisfied only when all rows across the popup dataset are reviewed.
9. Use batch endpoint for submit to support one-click acknowledge.
10. Refresh pending list (`scope=gate`) and stats after submit.
11. Handle `MFA_REQUIRED` retry flow if applicable.

## Enforcement Strategy

Current backend enforcement:

1. Review events are persisted per task + user via `POST /api/v1/summary/tasks-to-approve/:id/review-events`.
2. List/detail payloads expose current-user review status:
   - `reviewedByCurrentUser: boolean`
   - `reviewedAt: string | null`
   - `reviewedByCurrentUserName: string | null`
   - `category: "document" | "task log"`
3. Queue payload exposes concise business context for each row via `context.*`, so users can understand what each task/event is about before opening detail.
4. Approve and batch-approve enforce a server-side review gate.
5. If review prerequisite is not met, backend returns:
   - `409 REVIEW_REQUIRED_BEFORE_ACKNOWLEDGE`

## Error Handling Contract

- `403 FORBIDDEN`: user is not approver role
- `403 MFA_REQUIRED`: complete MFA then retry submit
- `409 INVALID_TASK_STATE`: item no longer pending
- `409 REVIEW_REQUIRED_BEFORE_ACKNOWLEDGE`: review prerequisite not satisfied
- `422 VALIDATION_ERROR`: bad payload
- `422 INVALID_FILE_REFERENCE`: provided `signatureFileId` is not uploaded/available in tenant scope

## Audit Expectations

Current audit coverage:

- review-event recording writes `task_approval_review`
- single approve writes `task_approval`
- batch approve writes `task_approval_batch`

## Acceptance Criteria

1. If any popup row is unreviewed, submit is blocked even when selected rows are reviewed.
2. Selecting one row and submitting succeeds only after all popup rows have been reviewed.
3. Selecting multiple rows and submitting succeeds only after all popup rows have been reviewed.
4. Select-all and submit obeys the same global review gate.
5. After successful submit, rows disappear from pending queue.
6. Pending counter updates after submit.
7. Partial batch failures display row-level reasons.
8. MFA-required scenario retries successfully after challenge/verify.

## Source References

- `src/modules/summary/summary.routes.ts`
- `src/modules/summary/summary.service.ts`
- `src/modules/auth/auth.routes.ts`
- `src/middleware/mfa.ts`
