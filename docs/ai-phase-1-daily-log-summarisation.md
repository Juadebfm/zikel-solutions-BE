# AI Phase 1 — Daily-log Summarisation

**Status:** Phase 1 complete locally — all endpoints, OpenAPI schemas, audit-log coverage, tests, smoke runbook, and FE handoff doc shipped (371 pass, 0 fail). Awaiting PR review.
**Branch:** `add-generative-artifacts`
**Estimated effort:** ~3 weeks end-to-end (collapsed in practice)
**Last updated:** 2026-05-26

---

## Why this first

Of the FE's market-parity gap list, daily-log summarisation is the right wedge:

- It's the **foundation work**. Builds the audit-trail primitive (`GenerativeArtifact`) that all later generative features (Reg 44/45, safeguarding pattern detection, care-plan drafting) inherit.
- **Lowest Ofsted risk** — we're condensing existing logged facts, not generating new claims.
- **Highest reach** — every shift logs daily, so every staff member benefits within a week.
- **Sync, single-source** — no streaming/async/multi-source machinery yet; that ships in Phase 2.

Voice→note and Reg 44/45 reports are deferred to Phase 2+ once the audit-trail primitive is proven.

## Ground truth (matters for design)

- **Daily logs are not a separate model.** They are stored as `Task` rows with `category: 'daily_log'`
  ([src/modules/daily-logs/daily-logs.service.ts](src/modules/daily-logs/daily-logs.service.ts) — `createDailyLog` delegates to `tasksService.createTask` with `category: 'daily_log'`).
- The summariser queries `prisma.task.findMany` filtered by `category: 'daily_log'`, `homeId`, and a date range.
- Existing AI infrastructure to reuse:
  - `callModel()` in [src/modules/ai/ai.service.ts](src/modules/ai/ai.service.ts) — provider call with redaction, fallback, language guardrail
  - `TokenAllocation` + `TokenLedgerEntry` models — token accounting per tenant per period
  - `source: 'model' | 'fallback'` response field convention

## Decisions locked

| Decision | Value | Source |
|---|---|---|
| Phase 1 feature | Daily-log summarisation (single day, single home) | Julius, 2026-05-26 (after dropping voice-note from the candidate list) |
| Phase 1 trigger | Manual button on `/daily-logs` page (no auto-on-shift-end yet) | Defaults — lowest UX risk |
| Phase 1 input scope | One home, one date — sum the day's daily-log Tasks | Defaults — keeps prompt simple, lowers cost |
| Lifecycle | `draft → review → commit` with full edit history | Locked — Ofsted-defensibility requirement |
| Source traceability | Every artifact stores `sourceRecordIds` (array of Task IDs) it was generated from | Locked — non-negotiable |
| Edit tracking | Append-only `editHistory` JSON on the artifact (atIso, byUserId, beforeContent, afterContent) | Defaults — simplest defensible model |
| Provider | Reuse the existing AI provider call (`callModel`) | Locked — don't add a parallel provider stack |
| Group tier | Group-tier tenants get summaries — quota is enforced per tenant, not gated by tier | Locked — generative features should not be tier-gated |

## Locked decisions (resolved 2026-05-26)

| Question | Decision | Implementation |
|---|---|---|
| Token meter location | **Shared pool, two visible counters** (Option 1) | Summaries debit the shared `TokenAllocation` by `SUMMARY_TOKEN_MULTIPLIER = 25` call-equivalents per generation. `/billing/quota` surfaces both `usedCalls` (chat surface) and `summaries.used` / `summaries.included` (summary surface). |
| Pricing impact | **Stay at £7/bed** | No Stripe Price change. Per-bed economics absorb the cost; re-evaluate at day-30 with real usage data. |
| Per-tier summary cap | **Generous defaults: 90 / 450 / null** | `Plan.summariesIncludedPerPeriod` column. Single Home 90/mo (3/day for 1 home), Multi-Home 450/mo (3/day across 5 homes), Group unlimited. Adjustable via DB update, no code change required. |
| Summary multiplier value | **25× a chat call** | Constant `SUMMARY_TOKEN_MULTIPLIER` in `src/modules/generative/quota.ts`. Re-tune after day-30 usage review. |

## Schema additions

### `GenerativeArtifact` — the audit-trail primitive (used by ALL generative features)

```prisma
enum GenerativeArtifactType {
  daily_log_summary
  // Phase 2+: reg_44_45_report, safeguarding_pattern_alert, care_plan_draft
}

enum GenerativeArtifactStatus {
  draft       // newly generated, not yet committed
  edited      // human has modified the draft
  committed   // finalised; immutable from here
  superseded  // a later regeneration replaced this artifact
}

model GenerativeArtifact {
  id                String                  @id @default(cuid())
  tenantId          String

  artifactType      GenerativeArtifactType
  status            GenerativeArtifactStatus @default(draft)

  // What was summarised. entityType + entityId locate the "thing".
  // For Phase 1 daily-log summary: entityType='home', entityId=<homeId>.
  entityType        String
  entityId          String

  // Which source records produced this artifact. For Phase 1: array of Task IDs
  // where category='daily_log' on the target date. Non-negotiable for Ofsted
  // defensibility — every committed artifact can be traced back to its inputs.
  sourceRecordIds   Json                    // string[]

  // The AI run that produced the draft.
  modelId           String                  // e.g. 'gpt-5.4-mini'
  promptVersion     String                  // semver-ish, e.g. 'v1.0.0'
  source            String                  // 'model' | 'fallback' (mirrors /ai/ask convention)

  // Content. JSON so the shape can evolve per artifactType without migrations.
  draftContent      Json                    // original AI output, immutable
  currentContent    Json                    // current state (draft + edits applied), mutable
  committedContent  Json?                   // snapshot at commit time, null until committed

  // Lifecycle authorship.
  createdById       String                  // who triggered the generation
  committedById     String?                 // who clicked commit
  committedAt       DateTime?

  // Append-only edit history. Each entry: { atIso, byUserId, before, after }.
  // Never overwritten — full diff trail for inspection defensibility.
  editHistory       Json                    @default("[]")  // array of {atIso, byUserId, before, after}

  createdAt         DateTime                @default(now())
  updatedAt         DateTime                @updatedAt

  @@index([tenantId, artifactType, createdAt])
  @@index([tenantId, entityType, entityId])
  @@index([status])
}
```

### `DailyLogSummary` — Phase 1 specific lookup

A thin index table so the FE can ask "is there a summary for {home, date}?" without scanning all artifacts. The actual content lives on `GenerativeArtifact`.

```prisma
model DailyLogSummary {
  id              String   @id @default(cuid())
  tenantId        String
  homeId          String
  summaryDate     DateTime @db.Date           // the date being summarised (not when the summary was made)
  artifactId      String   @unique            // FK to the current active GenerativeArtifact

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  artifact        GenerativeArtifact @relation(fields: [artifactId], references: [id], onDelete: Cascade)
  home            Home               @relation(fields: [homeId], references: [id], onDelete: Cascade)

  // One ACTIVE summary per home per date. Regenerations supersede (status='superseded' on the old artifact)
  // and update this row to point at the new one.
  @@unique([tenantId, homeId, summaryDate])
  @@index([tenantId, homeId, summaryDate])
}
```

## API contracts

### `POST /api/v1/generative/daily-log-summary`

Request:
```ts
{
  homeId: string,       // cuid
  date: string,         // ISO date 'YYYY-MM-DD'
  regenerate?: boolean, // default false; if true, supersede the existing summary for this {home, date}
}
```

Response (200):
```ts
{
  success: true,
  data: {
    artifact: {
      id: string,
      artifactType: 'daily_log_summary',
      status: 'draft',
      entityType: 'home',
      entityId: string,
      sourceRecordIds: string[],  // Task IDs
      modelId: string,
      promptVersion: string,
      source: 'model' | 'fallback',
      currentContent: DailyLogSummaryContent,
      createdAt: string,  // ISO datetime
    }
  }
}
```

Errors:
- `404 NO_SOURCE_RECORDS` — no daily-log Tasks for this {home, date}
- `409 SUMMARY_EXISTS` — a draft/committed summary exists; pass `regenerate: true` to supersede
- `402 SUMMARIES_QUOTA_EXHAUSTED` — tenant has used its summary quota for the period
- `403 HOME_NOT_FOUND` / `HOME_ACCESS_DENIED` — standard tenant-scope errors

### `GET /api/v1/generative/artifacts/{id}`

Response (200):
```ts
{
  success: true,
  data: {
    artifact: <full GenerativeArtifact incl. editHistory + committedContent>
  }
}
```

### `PATCH /api/v1/generative/artifacts/{id}`

For human edits. Only allowed when `status` is `draft` or `edited`. Locks the artifact briefly (in-row optimistic check via `updatedAt`) so concurrent edits don't lose data.

Request:
```ts
{
  currentContent: DailyLogSummaryContent,  // the new full content (not a delta)
  expectedUpdatedAt: string,               // for optimistic concurrency
}
```

Response (200): updated artifact.

Errors:
- `409 STALE_CONTENT` — `expectedUpdatedAt` doesn't match; refetch and retry
- `409 ALREADY_COMMITTED` — status is committed; edits no longer allowed

### `POST /api/v1/generative/artifacts/{id}/commit`

Locks the artifact. `committedContent` = current snapshot. Subsequent edits rejected. Writes an audit log row.

Response (200):
```ts
{
  success: true,
  data: {
    artifact: <full GenerativeArtifact with status='committed'>
  }
}
```

### `DailyLogSummaryContent` shape

```ts
{
  // Structured fields the model populates, easy for FE to render as labeled sections.
  shiftHighlights: string[],            // 3-6 bullets
  incidentsOfNote: string[],            // empty if none
  safeguardingFlags: string[],          // empty if none — non-empty triggers FE warning UI
  followUpRequired: string[],           // empty if none — non-empty creates suggested Tasks (FE opt-in, not auto)
  freeformSummary: string,              // 2-4 sentence prose summary
  languageSafetyPassed: boolean,        // reuses the existing therapeutic-language guardrail
}
```

## Build checklist

### Foundation (Week 1) — no AI yet
- [x] `GenerativeArtifactType` + `GenerativeArtifactStatus` enums in Prisma schema
- [x] `GenerativeArtifact` model + back-relations on Tenant/TenantUser/Home
- [x] `DailyLogSummary` model (unique-keyed pointer table for {home, date})
- [x] Migration `20260530135051_add_generative_artifacts` applied
- [x] `src/modules/generative/generative.service.ts` lifecycle: `createDailyLogSummaryDraft` / `getArtifact` / `editArtifact` (optimistic concurrency) / `commitArtifact` (locks + audit log)
- [x] `src/modules/generative/generative.routes.ts` — four endpoints mounted at `/api/v1/generative`
- [x] 15 lifecycle tests covering create / supersede / get / edit-history append / stale-check / already-committed / commit-idempotency

### Week 1.5 — Plan column for surface cap
- [x] `Plan.summariesIncludedPerPeriod` column added (`Int?` — null = unlimited)
- [x] Migration `20260530140215_add_plan_summaries_included` applied
- [x] Seed values: 90 (Single Home) / 450 (Multi-Home) / null (Group)
- [x] `mapPlan` exposes the new field on `GET /billing/plans`

### AI integration (Week 2)
- [x] `src/modules/generative/daily-log-summary.generator.ts` — fetcher + prompt + model call + deterministic fallback
- [x] Date-window fetch: `Task` rows where `category='daily_log'`, `tenantId+homeId` match, `submittedAt` in UTC `[date 00:00, date+1 00:00)`
- [x] System prompt baked in with strict rules: no invention, non-blaming language, safeguarding flags, structured JSON output
- [x] Fallback path (no AI key OR provider failure OR malformed response) marked `source: 'fallback'`
- [x] Route handler now calls real `generateDailyLogSummary` (stub gone)
- [x] `NO_SOURCE_RECORDS` (404) if no logs exist for the date
- [x] 7 generator tests: fetch query shape, no-source short-circuit, fallback path, model path (success + 4 failure modes)

### Token meter integration (Week 2)
- [x] `TokenLedgerEntryKind.debit_generative_summary` enum value added
- [x] Migration `20260530141521_add_summary_ledger_kind` applied
- [x] `src/modules/generative/quota.ts` — `requireSummaryQuotaAvailable` + `debitForSummary`
- [x] Shared pool check: throws `402 AI_QUOTA_EXHAUSTED` if remaining < 25 calls
- [x] Surface cap check: throws `402 SUMMARIES_QUOTA_EXHAUSTED` at `Plan.summariesIncludedPerPeriod`
- [x] Pre-flight gate: route checks BEFORE calling the model (don't burn tokens on a request we'd refuse to persist)
- [x] Post-success debit: 25-call increment + one ledger row with `kind=debit_generative_summary`, `reasonRef=summary:<artifactId>`
- [x] `getQuotaSnapshotForTenant` now surfaces `summaries: { included, used }` alongside the existing chat-call counters
- [x] 7 quota tests: happy path, pool-exhaustion, surface-cap-hit, Group unlimited, dev/no-sub fallback, debit ledger shape, multiplier value lock

### OpenAPI + permissions
- [x] `GENERATIVE_CREATE` permission added (Owner/Admin/Manager/Residential Care Worker)
- [x] `GENERATIVE_COMMIT` permission added (Owner/Admin/Manager — RCW excluded from commit by design)
- [x] Canonical `GenerativeArtifact` + `DailyLogSummaryContent` schemas registered in `src/openapi/shared.schemas.ts`
- [x] Routes bind to canonical `$ref: 'GenerativeArtifact#'` (no more loose `additionalProperties: true`)
- [x] Wired into `src/routes/index.ts` under `/api/v1/generative`

### FE-readiness gaps (added before any FE handoff)
- [x] `GET /api/v1/generative/artifacts` — paginated list, filterable by `homeId`, `artifactType`, `status`, `dateFrom`/`dateTo`
- [x] `GET /api/v1/generative/daily-log-summary?homeId&date` — lookup-by-target (returns active artifact or 404 SUMMARY_NOT_FOUND)
- [x] Audit log entries for drafts (`generative_artifact_drafted`) and regenerations (`generative_artifact_regenerated`) in addition to commits — full forensic trail
- [x] Smoke-test runbook: `docs/ai-phase-1-smoke-runbook.md`
- [x] FE handoff doc drafted (held until Julius approves): `docs/ai-phase-1-fe-handoff.md`
- [x] **`scripts/refresh-system-role-permissions.ts`** — one-shot ops script (with `DRY_RUN=1`) to refresh `Role.permissions` on existing tenants when new permission codes are added to the catalogue. **MUST RUN POST-DEPLOY** or every existing tenant will hit 403 PERMISSION_DENIED on every generative call. Surfaced during local smoke test on 2026-05-30 — same problem will hit production until this runs.

### Deploy procedure
1. Merge PR → Render auto-deploys
2. Wait for the new build to go green on Render
3. From local: `npm run refresh:role-permissions` (writes via the production DATABASE_URL in your `.env.local`). Run with `DRY_RUN=1` first to preview.
4. Smoke runbook against `https://api.zikelsolutions.com`
5. Send FE handoff if smoke passes

### Verification
- [x] `npx tsc --noEmit` clean
- [x] Full suite: **371 pass, 2 skipped (intentional), 0 fail** (+20 net vs. pre-Phase-1)
- [ ] Manual smoke test in production (Julius to run after PR merges + Render deploys — see [smoke runbook](ai-phase-1-smoke-runbook.md))
- [ ] FE handoff (send `docs/ai-phase-1-fe-handoff.md` only after smoke test passes and Julius approves)

## Permissions

Two new permission codes (add to `src/auth/permissions.ts`):

| Code | Meaning | Default roles |
|---|---|---|
| `generative:create` | Trigger draft generation | Owner, Admin, Manager, Residential Care Worker |
| `generative:commit` | Finalise / lock a draft | Owner, Admin, Manager |

Edits between draft and commit require `generative:create`. Commit is the gated action because it's the inspection-defensible "this is what we say happened" moment.

## Open questions / risks

- [ ] **Quota allowance per tier.** What's the included summary count per tenant per month? Suggested defaults: Single Home 30 summaries/mo (≈1/day for one home), Multi-Home 150/mo (≈1/day for 5 homes), Group: unlimited. Verify with Julius.
- [ ] **What's the "summary period" if the FE wants weekly/monthly summaries later?** Out of Phase 1 scope; flag for Phase 2 — same artifact type, different `entityType` (e.g. `young_person/{id}/week/{iso}`).
- [ ] **Regeneration cost.** Regenerating a summary consumes another quota call. Decide whether the first regen-within-1-hour is free or always counted. Default: always counted (simplest; surfaces real cost).
- [ ] **PII redaction depth.** The existing redaction layer strips names/DOBs but may not strip free-text references ("Saw John in the kitchen…"). For summarisation specifically, we may want a tighter pre-call redaction step or rely on the model with a strict system prompt. Decide after prompt eng.
- [ ] **Mobile note-taking.** Out of Phase 1. Voice→note (the deferred feature) would need a mobile recorder; not in scope here.

## Sequencing

1. **Foundation PR (`add-generative-artifacts`)** — Week 1. Ships the audit-trail primitive + lifecycle ops + hardcoded-draft endpoints + tests. Low risk, no AI provider dependency. Mergeable on its own.
2. **AI integration PR (`generative-daily-log-summary`)** — Week 2. Builds on `main` after the foundation merges. Wires the prompt, the model call, token meter, fallback.
3. **Polish + FE handoff** — Week 3. OpenAPI shapes, quota surface, smoke test, ship.

After Phase 1 ships and 2-4 weeks of usage data accumulate, we re-evaluate: does the audit-trail primitive feel right? Is token cost tractable? Then start Phase 2 (Reg 44/45 report generation) on the same foundation.

## References

- Existing AI infrastructure to reuse: `src/modules/ai/ai.service.ts` (`callModel`, redaction, fallback, language guardrail)
- Token accounting: `TokenAllocation` + `TokenLedgerEntry` ([prisma/schema.prisma:2169](prisma/schema.prisma#L2169))
- Daily logs are Task rows: [src/modules/daily-logs/daily-logs.service.ts:8](src/modules/daily-logs/daily-logs.service.ts#L8)
- Related build doc pattern: [docs/billing-tiers-build.md](docs/billing-tiers-build.md)
