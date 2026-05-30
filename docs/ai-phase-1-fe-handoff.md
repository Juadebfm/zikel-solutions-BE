# FE handoff — AI Phase 1 (Daily-log summarisation)

**Status:** drafted but **not yet sent**. Hold until Julius confirms PR is merged + smoke runbook passes + Julius gives the explicit "send to FE" go-ahead.

---

# Re: AI Phase 1 — daily-log summarisation (live on BE)

The first generative AI surface is live. It produces structured drafts from a day's daily-log Task rows, supports a `draft → edit → commit` lifecycle with full audit-trail traceability, and quotas under the existing AI billing model.

## What's new at a glance

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/generative/daily-log-summary` | Generate a draft for `{homeId, date}` |
| `GET /api/v1/generative/daily-log-summary?homeId&date` | Look up the current active summary for `{home, date}` (use this to choose "Generate" vs "View" CTA) |
| `GET /api/v1/generative/artifacts` | Paginated list of artifacts, filterable by `homeId`, `status`, `artifactType`, date window |
| `GET /api/v1/generative/artifacts/:id` | Fetch a single artifact |
| `PATCH /api/v1/generative/artifacts/:id` | Edit a draft (optimistic concurrency) |
| `POST /api/v1/generative/artifacts/:id/commit` | Finalise (lock) a draft — idempotent |
| `GET /api/v1/billing/quota` | Now includes `summaries: { included, used }` |

## TypeScript shapes

The canonical OpenAPI schema is registered as `GenerativeArtifact` (Swagger should show it). The shape your client should expect:

```ts
type GenerativeArtifact = {
  id: string;
  tenantId: string;
  artifactType: 'daily_log_summary';  // more types in Phase 2+
  status: 'draft' | 'edited' | 'committed' | 'superseded';
  entityType: string;                 // 'home' for daily_log_summary
  entityId: string;                   // homeId for daily_log_summary
  sourceRecordIds: string[];          // Task IDs the prompt saw — Ofsted-defensible
  modelId: string;                    // e.g. 'gpt-5.4-mini' or 'fallback'
  promptVersion: string;              // e.g. 'v1.0.0'
  source: 'model' | 'fallback';       // 'fallback' = deterministic non-AI output
  draftContent: DailyLogSummaryContent;
  currentContent: DailyLogSummaryContent;
  committedContent: DailyLogSummaryContent | null;
  createdById: string;
  committedById: string | null;
  committedAt: string | null;         // ISO datetime
  editHistory: Array<{
    atIso: string;
    byUserId: string;
    before: DailyLogSummaryContent;
    after: DailyLogSummaryContent;
  }>;
  createdAt: string;                  // ISO datetime
  updatedAt: string;                  // ISO datetime
};

type DailyLogSummaryContent = {
  shiftHighlights: string[];
  incidentsOfNote: string[];
  safeguardingFlags: string[];        // non-empty = render warning UI
  followUpRequired: string[];         // candidates for new Tasks
  freeformSummary: string;            // 2-4 sentences
  languageSafetyPassed: boolean;
};
```

## Lifecycle

```
[user clicks Generate]
   ↓
POST /generative/daily-log-summary  →  artifact { status: 'draft' }
   ↓
[user edits in UI]
   ↓
PATCH /generative/artifacts/:id     →  artifact { status: 'edited' }  (editHistory grows)
   ↓
[user clicks Commit]
   ↓
POST /generative/artifacts/:id/commit  →  artifact { status: 'committed', committedAt, committedById }
```

After commit, edits are rejected with `409 ALREADY_COMMITTED`. To produce a new summary for the same `{home, date}`, call POST with `regenerate: true` — the existing artifact becomes `superseded` and a new draft is created.

## Optimistic concurrency on edits

Every PATCH must include the `updatedAt` value from the artifact you last read, as `expectedUpdatedAt`. If another editor changed the artifact in between, you get `409 STALE_CONTENT` and should refetch + reapply.

```ts
await fetch(`/api/v1/generative/artifacts/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    expectedUpdatedAt: artifact.updatedAt,    // <-- required
    currentContent: editedContent,
  }),
});
```

## CTA-choice logic for the FE

Before showing a "Generate summary" button on a date row, call the lookup-by-target endpoint:

```ts
// Returns the current active artifact OR 404 SUMMARY_NOT_FOUND
const res = await fetch(`/api/v1/generative/daily-log-summary?homeId=${homeId}&date=${date}`);

if (res.status === 404) {
  // No summary yet → show "Generate" CTA
} else {
  const { data: { artifact } } = await res.json();
  // Show "View summary" CTA; render based on artifact.status
}
```

## Error codes the FE should map

| Status | Code | When | Suggested FE behaviour |
|---|---|---|---|
| 402 | `AI_QUOTA_EXHAUSTED` | Shared AI pool has <25 calls left | "AI quota nearly used — buy a top-up" → link to billing |
| 402 | `SUMMARIES_QUOTA_EXHAUSTED` | Monthly summary cap hit | "Monthly summary limit reached — upgrade your plan" → link to billing |
| 404 | `NO_SOURCE_RECORDS` | No daily logs exist for `{home, date}` | "No logs to summarise — record some daily logs first" |
| 404 | `SUMMARY_NOT_FOUND` | Lookup-by-target with no summary | Choose "Generate" CTA |
| 404 | `ARTIFACT_NOT_FOUND` | Get-by-id with bad/foreign id | "Summary not found" |
| 404 | `HOME_NOT_FOUND` | Tenant-scope mismatch | "Home not found" |
| 409 | `SUMMARY_EXISTS` | POST without `regenerate: true` and one exists | Show "Replace existing draft?" confirmation, then retry with `regenerate: true` |
| 409 | `STALE_CONTENT` | PATCH with outdated `expectedUpdatedAt` | Refetch artifact, show "Someone else edited this — your changes weren't saved" |
| 409 | `ALREADY_COMMITTED` | Edit attempt on committed artifact | "This summary has been committed and can't be edited" |
| 409 | `ARTIFACT_SUPERSEDED` | Edit/commit attempt on a regenerated artifact | "This draft was replaced — view the latest" |
| 422 | `VALIDATION_ERROR` | Body or query failed Zod | Standard fieldErrors mapping |

## Permissions

| Permission | Default roles | What it allows |
|---|---|---|
| `generative:create` | Owner, Admin, Manager, Residential Care Worker | Trigger, list, get, lookup, edit |
| `generative:commit` | Owner, Admin, Manager | Commit (lock) a draft |

RCW can draft and edit but NOT commit. Commit is the inspection-defensible "this is what we say happened" moment.

## Quota panel additions

`GET /api/v1/billing/quota` response now includes:

```ts
{
  // ...existing chat-call fields
  summaries: {
    included: number | null;   // null = unlimited (Group tier)
    used: number;
  }
}
```

The two counters share the same shared token pool — each summary debits 25 call-equivalents from `usedCalls` (visible as the same `usedCalls` value, so chat + summary usage live in one budget). The separate `summaries.used` counter is for surface visibility on the billing page; show both meters:

```
AI assistant calls:   {usedCalls} / {bundledCalls + topUpCalls} used
Summaries this month: {summaries.used} / {summaries.included ?? '∞'}
```

## Audit trail (Ofsted-relevant)

Every commit writes an `AuditLog` row with `entityType: 'generative_artifact_commit'` containing the artifact's `sourceRecordIds`, `modelId`, `promptVersion`, and `source`. Draft creations + regenerations also write `entityType: 'generative_artifact'` rows. Both are queryable through the existing `/api/v1/audit` endpoint and visible to tenant Owners/Admins.

The `editHistory` on each artifact carries the full before/after diff for every PATCH — surfaced through the FE as a "Show edit history" affordance if you want, but not required for v1.

## What's NOT in scope for this phase

- Voice/ambient dictation → note (deferred)
- Reg 44/45 / MARS report generation (Phase 2)
- Safeguarding pattern detection (Phase 3)
- Weekly/monthly summary periods (Phase 2 — same artifact primitive, different `entityType`)
- Care-plan drafting (later)
- Inspection-readiness scoring (later)

## Day-30 review

Token multiplier (25× per summary) and per-tier inclusion caps (90 / 450 / null) were set on educated defaults. We'll revisit ~2026-06-26 with actual usage data and tighten/loosen if needed. No FE changes required — the numbers are DB-tunable.

## Verification I've already done

- Full BE test suite: **371 pass, 2 skipped (intentional), 0 fail**
- 21 service tests (lifecycle, list, lookup, audit)
- 7 generator tests (fetch + AI path + fallback paths)
- 7 quota tests (pool + surface cap + multiplier)
- TypeScript clean
- Smoke runbook drafted ([docs/ai-phase-1-smoke-runbook.md](docs/ai-phase-1-smoke-runbook.md))

Ping me with the request ID if anything looks off when you wire it up.
