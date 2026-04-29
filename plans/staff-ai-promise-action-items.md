# Staff AI Promise Action Items

Status: Proposed implementation backlog
Created: 2026-04-29

## Goal

Close the gap between the current backend and the website promise that Zikel can:

- analyse staff activity footprints
- deliver real-time prompts
- send risk escalation alerts
- map patterns across incidents
- provide RI oversight
- suggest supervision actions
- recommend training
- surface workload and support indicators

## Current Reality

The backend already supports:

- Reg 44 and Reg 45 evidence packs
- safeguarding chronology generation
- safeguarding risk alerts
- incident pattern mapping
- RI dashboard metrics
- reflective prompts
- AI-assisted page guidance

The backend does not yet fully support:

- continuous staff activity footprint analysis
- staff-specific supervision suggestions
- training recommendation workflows
- proactive prompt queues across workflows
- documentation-quality scoring
- staff workload/support indicators
- dedicated RI/staff-performance views

## Implementation Principle

Build this in two layers:

1. Deterministic signal engine first
2. AI explanation and coaching layer second

This keeps the system explainable, auditable, and safe for safeguarding and workforce use.

## Phase 1: Activity Footprint Foundation

- [ ] Add a `StaffActivityEvent` model to capture staff workflow events
- [ ] Add a `StaffActivityDailySnapshot` model to store daily aggregated signals per staff member
- [ ] Define canonical event types
- [ ] Capture event timestamps, actor, tenant, home, young person, task, workflow source, and metadata
- [ ] Ensure all activity events are tenant-scoped and auditable
- [ ] Backfill a minimal historical dataset from existing tasks, approvals, daily logs, and incident records

### Minimum event types

- [ ] `task_created`
- [ ] `task_updated`
- [ ] `task_submitted`
- [ ] `task_approved`
- [ ] `task_rejected`
- [ ] `daily_log_created`
- [ ] `daily_log_submitted`
- [ ] `daily_log_rejected`
- [ ] `incident_recorded`
- [ ] `incident_updated`
- [ ] `document_uploaded`
- [ ] `approval_reviewed`
- [ ] `approval_delayed`
- [ ] `reflective_prompt_saved`

### Existing code paths to extend

- [ ] Task create/update/action flows
- [ ] Summary approval flows
- [ ] Daily log create/update flows
- [ ] Safeguarding reflective prompt save flow
- [ ] Document and upload flows where relevant

## Phase 2: Staff Signal Engine

- [ ] Add a `StaffSignal` model for explainable staff-level intelligence outputs
- [ ] Build a service to score recent activity and create/update signals
- [ ] Make every signal evidence-linked, threshold-based, and reviewable
- [ ] Support both event-triggered evaluation and scheduled backfill evaluation

### Initial signal set

- [ ] `documentation_delay`
- [ ] `documentation_inconsistency`
- [ ] `repeat_rejection_pattern`
- [ ] `incident_followup_gap`
- [ ] `high_incident_involvement`
- [ ] `after_hours_activity_spike`
- [ ] `high_unassigned_workload`
- [ ] `supervision_due`
- [ ] `supervision_overdue`
- [ ] `positive_consistency_pattern`

### Each signal must include

- [ ] severity
- [ ] confidence
- [ ] trigger window
- [ ] threshold used
- [ ] evidence references
- [ ] short explanation
- [ ] suggested next action
- [ ] created/reopened/resolved lifecycle

## Phase 3: Proactive Prompt Queue

- [ ] Add a `StaffPrompt` model for proactive prompts delivered to staff
- [ ] Generate prompts from signals and workflow gaps
- [ ] Support prompt states: `new`, `seen`, `acted_on`, `dismissed`
- [ ] Allow prompts to link directly to the relevant task, daily log, incident, or approval item

### Initial prompt types

- [ ] missing documentation prompt
- [ ] incomplete incident follow-up prompt
- [ ] overdue approval evidence prompt
- [ ] reflective recording prompt
- [ ] shift handover completion prompt
- [ ] corrective documentation prompt after rejection

### Delivery channels

- [ ] in-app prompt feed
- [ ] notifications
- [ ] optional webhook events

## Phase 4: Supervision Suggestions

- [ ] Add a `SupervisionSuggestion` model for manager and RI review
- [ ] Generate suggestions from repeated or elevated staff signals
- [ ] Support acknowledgement, owner assignment, due date, note-taking, and resolution
- [ ] Track whether a suggestion led to an actual supervision session

### Initial suggestion triggers

- [ ] repeated documentation delays
- [ ] repeated rejected approvals
- [ ] repeated incident recording quality gaps
- [ ] sustained high-risk workload pattern
- [ ] unresolved safeguarding follow-up patterns

### Output requirements

- [ ] clear reason for suggestion
- [ ] evidence references
- [ ] severity/confidence
- [ ] suggested supervision topic
- [ ] suggested time horizon

## Phase 5: Training Recommendations

- [ ] Add a `TrainingRecommendation` model
- [ ] Map signal combinations to predefined training interventions
- [ ] Store recommendation status: `suggested`, `accepted`, `scheduled`, `completed`, `dismissed`
- [ ] Support manager notes and rationale

### Initial recommendation mappings

- [ ] documentation quality refresher
- [ ] incident recording coaching
- [ ] medication safety refresher
- [ ] safeguarding escalation refresher
- [ ] reflective recording coaching
- [ ] approval workflow coaching

### Important rule

- [ ] Recommendations must be based on explicit signal mappings, not freeform AI inference alone

## Phase 6: RI and Manager Oversight Dashboard Expansion

- [ ] Extend the RI dashboard with staff-performance and documentation-quality views
- [ ] Add team-level and staff-level drilldowns
- [ ] Add filters for tenant, care group, home, staff member, date range, and signal type

### New dashboard metrics

- [ ] documentation timeliness
- [ ] rejection rate
- [ ] unresolved follow-up gaps
- [ ] prompt completion rate
- [ ] supervision due/overdue count
- [ ] training recommendation count and completion rate
- [ ] workload/support indicators

### Explicitly avoid promising until built

- [ ] burnout detection
- [ ] wellbeing scoring
- [ ] behavioural judgement of staff

Use safer framing such as:

- workload indicators
- support indicators
- documentation and workflow patterns

## Phase 7: AI Explanation Layer

- [ ] Extend the AI assistant so it can summarize staff signals and manager actions
- [ ] Generate non-blaming coaching summaries from deterministic signals
- [ ] Generate manager-facing suggested wording for supervision conversations
- [ ] Generate staff-facing reflective next-step guidance
- [ ] Keep all AI outputs grounded in evidence references only

### AI must not do

- [ ] diagnose staff wellbeing
- [ ] infer misconduct without supporting workflow evidence
- [ ] create hidden performance scores
- [ ] recommend punitive action without human review

## Phase 8: Governance, Fairness, and Auditability

- [ ] Add audit logging for signal creation, prompt delivery, recommendation creation, and supervision suggestion actions
- [ ] Add reviewer-visible explanation fields for every signal
- [ ] Add access controls so only appropriate roles can see staff-level intelligence
- [ ] Add retention rules for staff intelligence artifacts
- [ ] Add policy wording and operational guidance for fair-use of staff intelligence

### Role access to define

- [ ] staff can view their own prompts only
- [ ] managers can view staff prompts/signals within scope
- [ ] tenant admins can view team-level intelligence within scope
- [ ] RIs can view oversight dashboards and drilldowns within scope

## Phase 9: Delivery and Rollout

- [ ] Add feature flags for staff intelligence modules
- [ ] Launch internal pilot with a small tenant set
- [ ] Validate false-positive rates before wider rollout
- [ ] Add telemetry for prompt usage, signal creation, escalation follow-through, and recommendation acceptance
- [ ] Review copy claims before each rollout wave

## API and Data Surface To Add

- [ ] `GET /api/v1/staff-intelligence/prompts/me`
- [ ] `POST /api/v1/staff-intelligence/prompts/:id/seen`
- [ ] `POST /api/v1/staff-intelligence/prompts/:id/acted`
- [ ] `GET /api/v1/staff-intelligence/signals`
- [ ] `GET /api/v1/staff-intelligence/signals/:id`
- [ ] `GET /api/v1/staff-intelligence/supervision-suggestions`
- [ ] `POST /api/v1/staff-intelligence/supervision-suggestions/:id/acknowledge`
- [ ] `POST /api/v1/staff-intelligence/supervision-suggestions/:id/resolve`
- [ ] `GET /api/v1/staff-intelligence/training-recommendations`
- [ ] `POST /api/v1/staff-intelligence/training-recommendations/:id/status`
- [ ] dashboard expansions under `/api/v1/reports/ri-dashboard` or a dedicated staff-intelligence dashboard namespace

## Definition of Done for Website Promise

Do not claim the full website promise until all of the following are true:

- [ ] staff activity events are continuously captured by the backend
- [ ] deterministic staff signals are generated automatically
- [ ] prompts are proactively delivered without requiring the user to ask AI first
- [ ] supervision suggestions exist as persisted manager-facing objects
- [ ] training recommendations exist as persisted reviewable objects
- [ ] RI dashboard includes staff-intelligence metrics and drilldowns
- [ ] all outputs are explainable, evidence-linked, and auditable
- [ ] governance wording is approved for staff-facing and manager-facing use

## Copy Guardrail Until Delivery

Until the above is complete, use safer language on the website:

- `AI-assisted guidance` instead of `AI continuously analyses staff activity`
- `rule-based risk escalation alerts` instead of `AI detects staff behaviour risk thresholds`
- `workload and documentation indicators` instead of `wellbeing indicators` or `burnout detection`
- `reflective prompts and oversight signals` instead of `supervision triggers and training recommendations`

## Recommended Build Order

1. Phase 1: Activity footprint foundation
2. Phase 2: Staff signal engine
3. Phase 3: Proactive prompt queue
4. Phase 4: Supervision suggestions
5. Phase 6: Dashboard expansion
6. Phase 5: Training recommendations
7. Phase 7: AI explanation layer
8. Phase 8: Governance and audit hardening
9. Phase 9: Pilot rollout and copy approval
