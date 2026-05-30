# AI Phase 1 — Smoke-test runbook

Manual end-to-end verification of the daily-log summarisation feature after the
`add-generative-artifacts` PR merges and Render deploys. Walks through draft →
edit → commit → audit verification → quota counter increment.

**Prerequisites:**
- Be on a tenant with at least one home that has `category: 'daily_log'` tasks
  for a specific date. If you don't have one, create a daily log first via
  `POST /api/v1/daily-logs` for any home + date.
- Your user has the `generative:create` permission (Owner/Admin/Manager/RCW).
- You have a valid `accessToken` from `POST /api/v1/auth/login`.
- `BASE=https://api.zikelsolutions.com` (or the local tunnel URL).

Run each block, paste the values from the previous step where indicated.

---

## Step 1 — Generate a draft

```bash
curl -s -X POST "$BASE/api/v1/generative/daily-log-summary" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "homeId": "<your-home-id>",
    "date": "2026-05-26"
  }' | jq .
```

**Expected:** `200` with `data.artifact.status = "draft"`, `data.artifact.id` set, `data.artifact.sourceRecordIds` matching the daily-log Task IDs for that date, `data.artifact.source` either `"model"` (AI ran) or `"fallback"` (no AI key / provider down).

**Failure modes to verify:**
- `404 NO_SOURCE_RECORDS` if you pick a date with no daily logs
- `409 SUMMARY_EXISTS` if you re-run without `"regenerate": true`
- `402 AI_QUOTA_EXHAUSTED` if the shared pool has <25 calls left
- `402 SUMMARIES_QUOTA_EXHAUSTED` if you've hit the plan cap (90 for Single Home)

**Capture:** `ARTIFACT_ID=<copied from data.artifact.id>`

## Step 2 — Verify quota counter incremented

```bash
curl -s "$BASE/api/v1/billing/quota" \
  -H "Authorization: Bearer $TOKEN" | jq '{ usedCalls, summaries }'
```

**Expected:** `summaries.used` should be `1` more than before step 1; `usedCalls` should be `25` higher (the 25× multiplier).

## Step 3 — Fetch the artifact by ID

```bash
curl -s "$BASE/api/v1/generative/artifacts/$ARTIFACT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.artifact | { id, status, sourceRecordIds, source, modelId }'
```

**Expected:** the same artifact you got back in step 1.

## Step 4 — List artifacts (filtered to your home)

```bash
curl -s "$BASE/api/v1/generative/artifacts?homeId=<your-home-id>&pageSize=10" \
  -H "Authorization: Bearer $TOKEN" | jq '{ count: .data | length, meta }'
```

**Expected:** `data[]` includes your new artifact; `meta.total >= 1`.

## Step 5 — Lookup by target

```bash
curl -s "$BASE/api/v1/generative/daily-log-summary?homeId=<your-home-id>&date=2026-05-26" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.artifact | { id, status }'
```

**Expected:** the same artifact ID. This is what the FE will use to choose between "Generate" and "View" CTAs.

**Failure check:** call with a date that has no summary → expect `404 SUMMARY_NOT_FOUND`.

## Step 6 — Edit the draft

First, capture the `updatedAt` field (needed for optimistic concurrency):

```bash
EXPECTED=$(curl -s "$BASE/api/v1/generative/artifacts/$ARTIFACT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.artifact.updatedAt')
```

Then PATCH with a modified `currentContent`:

```bash
curl -s -X PATCH "$BASE/api/v1/generative/artifacts/$ARTIFACT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "expectedUpdatedAt": "$EXPECTED",
  "currentContent": {
    "shiftHighlights": ["Reviewed by manager — added context."],
    "incidentsOfNote": [],
    "safeguardingFlags": [],
    "followUpRequired": ["Check on YP X tomorrow morning"],
    "freeformSummary": "Edited summary text for verification.",
    "languageSafetyPassed": true
  }
}
EOF
)" | jq '.data.artifact | { status, editHistory_length: (.editHistory | length) }'
```

**Expected:** `status: "edited"`, `editHistory_length: 1`.

**Failure check:** PATCH again with the OLD `EXPECTED` value → expect `409 STALE_CONTENT`.

## Step 7 — Commit

```bash
curl -s -X POST "$BASE/api/v1/generative/artifacts/$ARTIFACT_ID/commit" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.artifact | { status, committedById, committedAt }'
```

**Expected:** `status: "committed"`, `committedById` matches your user, `committedAt` set.

**Idempotency check:** call commit again → returns the same artifact (no error, no double-audit).

## Step 8 — Verify the audit trail

```bash
curl -s "$BASE/api/v1/audit?entityType=generative_artifact_commit&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | { entityId, action, metadata }'
```

**Expected:** Your `ARTIFACT_ID` appears with metadata containing `event: "generative_artifact_committed"`, `modelId`, `promptVersion`, and the original `sourceRecordIds`.

You should also see a corresponding `generative_artifact_drafted` event if you query `entityType=generative_artifact`:

```bash
curl -s "$BASE/api/v1/audit?entityType=generative_artifact&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | { entityId, metadata: .metadata.event }'
```

## Step 9 — Edit-after-commit (negative check)

PATCH the now-committed artifact again. **Expected:** `409 ALREADY_COMMITTED`.

```bash
curl -s -X PATCH "$BASE/api/v1/generative/artifacts/$ARTIFACT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "expectedUpdatedAt": "2020-01-01T00:00:00.000Z",
    "currentContent": { "shiftHighlights": ["nope"], "incidentsOfNote": [], "safeguardingFlags": [], "followUpRequired": [], "freeformSummary": "should fail", "languageSafetyPassed": true }
  }' | jq '.error'
```

**Expected:** `{ "code": "ALREADY_COMMITTED", ... }`.

## Step 10 — Regenerate (supersede flow)

```bash
curl -s -X POST "$BASE/api/v1/generative/daily-log-summary" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "homeId": "<your-home-id>",
    "date": "2026-05-26",
    "regenerate": true
  }' | jq '.data.artifact | { id, status, source }'
```

**Expected:** New artifact ID, `status: "draft"`. The old artifact is now `superseded` (verify with step 3 against the old `ARTIFACT_ID` — `status: "superseded"`).

The `DailyLogSummary` pointer now points at the new artifact — verify by re-running step 5 (lookup-by-target) and confirming the ID matches the new one.

## What "green" looks like

- Steps 1-10 all produce the expected responses
- `summaries.used` on `/billing/quota` incremented by 2 (one for the initial draft, one for the regeneration)
- `usedCalls` incremented by 50 (25 per summary)
- Audit log has at least 3 new rows: 2 `drafted/regenerated` + 1 `committed`

If any step deviates, capture the response body and the `requestId` from the response headers and ping me.
