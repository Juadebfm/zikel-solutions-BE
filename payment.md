# Phase 7 + 8 — AI rewrite, Token-Metered Subscriptions & Billing

**Master plan for the 2.5-day push.** Covers AI consistency cleanup, the conversational AI rewrite, and Stripe billing with token metering — sequenced so each phase is shippable on its own.

Each checkbox is real, shippable code. No placeholders.

**Status:** Plan-only. No code written yet — awaiting final sign-off + Stripe account setup.

---

## Pre-flight decisions (all locked)

### Billing
- [x] **Provider:** Stripe only (UK + Nigeria via single Stripe account)
- [x] **Pricing:** **£30 / month** or **£300 / year** (annual = 2 months free, ≈17% discount)
- [x] **Trial:** 7 days, no payment method required
- [x] **Past-due enforcement:** 3-day grace → 11-day read-only → hard suspend
- [x] **Read-only matrix (during the 11-day window):**
  - ✅ Login, refresh, MFA
  - ✅ GETs (read dashboards, lists, detail pages)
  - ✅ Billing routes (`/api/v1/billing/*`)
  - ❌ Mutations (POST/PATCH/PUT/DELETE) → `402 SUBSCRIPTION_PAST_DUE`
  - ❌ AI (chat + chronology narrative) → `402 SUBSCRIPTION_PAST_DUE`
  - ❌ Exports → `402 SUBSCRIPTION_PAST_DUE`
- [x] **Existing tenant grandfathering:** 30-day trial migration on rollout
- [x] **Stripe Tax:** ON
- [x] **PDF invoices:** ON (Stripe sends to Owner email)
- [x] **Checkout UI:** Stripe Hosted Checkout + Stripe Customer Portal
- [x] **Stripe API version:** Pinned (no auto-upgrade)

### Token metering & AI
- [x] **Plan includes:** 1,000 AI calls / month per tenant
- [x] **Top-up packs (one-time charges):**
  - Small: 250 calls — £5
  - Medium: 1,000 calls — £15
  - Large: 5,000 calls — £40
- [x] **Quota structure:** Hybrid — tenant-level pool (1,000/month), with **optional** per-role and per-user caps the Owner can configure
- [x] **AI surfaces sharing the quota:**
  - `POST /api/v1/ai/ask` (page-aware structured cards — existing, kept for dashboards)
  - `POST /api/v1/ai/conversations/:id/messages` (new conversational chat — built in Phase 8)
  - Chronology narrative (when `includeNarrative: true`)
- [x] **Conversational AI:** No streaming (full response in one chunk), conversations kept forever, pure free-form (no page binding), user-scoped (many conversations per user, ChatGPT-sidebar style)

### Sequencing
- [x] **Path:** 🅒 — 2.5-day push, all phases, sequenced so AI ships first (Day 1) and billing ships second (Day 2-3)
- [x] **Stripe API version:** Pinned to a specific date (e.g. `'2025-08-27.basil'`) — do NOT auto-upgrade

---

## Day 1 — AI consistency + conversational rewrite (~16–18h)

### Phase 8.1 — AI consistency cleanup (~3h)

Foundational changes that the conversational rewrite + billing both depend on.

- [ ] Schema: add `Tenant.aiEnabled` (Boolean, default `true`). Tenant-level master switch. Flipped to `false` automatically by the billing enforcement middleware in past-due-readonly / suspended states.
- [ ] Schema: flip `TenantUser.aiAccessEnabled` default from `false` → `true`. Migration sets all *existing* users to `true` to avoid breaking current AI access (preserves explicit `false` overrides).
- [ ] Schema: new `AiCallEvent` model:
  ```
  id, tenantId, userId, surface (enum: chat | dashboard_card | chronology_narrative),
  model, status (enum: success | fallback | error | quota_blocked),
  tokensIn (nullable), tokensOut (nullable), latencyMs, errorReason (nullable),
  createdAt
  ```
  Indexes: `(tenantId, createdAt)`, `(tenantId, userId, createdAt)`, `(surface, createdAt)`.
- [ ] New helper `assertAiEnabledForRequest(userId, surface)` in `src/lib/ai-access.ts`. Single shared gate — checks all four conditions:
  1. `AI_ENABLED` env true
  2. `Tenant.subscriptionStatus IN ('trialing', 'active', 'past_due_grace')`
  3. `Tenant.aiEnabled === true`
  4. `TenantUser.aiAccessEnabled === true`
  Throws `403 AI_ACCESS_DISABLED` if (3) or (4) is false; throws `402 SUBSCRIPTION_PAST_DUE` if (2) blocks; falls through silently to fallback if (1) is false.
- [ ] Apply `assertAiEnabledForRequest` to BOTH AI call sites:
  - `src/modules/ai/ai.service.ts` `askAi()` — replaces existing `assertAiAccessEnabled`
  - `src/modules/safeguarding/safeguarding.service.ts` `buildNarrative()` — currently has NO check
- [ ] Change `includeNarrative` default in `src/modules/safeguarding/safeguarding.schema.ts` from `true` → `false`. FE explicitly opts in. Lowest-cost change for the highest spend reduction.
- [ ] Wire `AiCallEvent` writes into both call sites. Captures token counts from OpenAI response (`usage.prompt_tokens`, `usage.completion_tokens`). Fire-and-forget — never blocks the request on the audit write.
- [ ] Document `AI_ENABLED`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS` in `render.yaml` with `sync: false` for documentation hygiene (values stay in dashboard).
- [ ] Tests: `assertAiEnabledForRequest` happy path + each rejection path. `AiCallEvent` write on both surfaces.

### Phase 8.2 — Conversational AI rewrite (~13–15h)

The chat-box experience: free-form, multi-turn, conversation memory, user-scoped.

- [ ] Schema: new `AiConversation` model:
  ```
  id, tenantId, userId, title (nullable — auto-generated after first turn),
  archivedAt (nullable), createdAt, updatedAt
  ```
  Tenant-scoped + user-scoped. Many per user.
- [ ] Schema: new `AiMessage` model:
  ```
  id, conversationId, role (enum: user | assistant | system),
  content (text), tokensIn (nullable), tokensOut (nullable), model (nullable),
  fallbackUsed (bool), errorReason (nullable), createdAt
  ```
- [ ] New routes — all under `/api/v1/ai/conversations/*`, gated by `fastify.authenticate` + `requirePrivilegedMfa` + `assertAiEnabledForRequest('chat')`:
  - [ ] `POST /api/v1/ai/conversations` — create new conversation. Returns `{ id, title: null, createdAt }`.
  - [ ] `GET /api/v1/ai/conversations` — list user's conversations (paginated, ordered by `updatedAt desc`). Excludes archived by default; `?includeArchived=true` to include.
  - [ ] `GET /api/v1/ai/conversations/:id` — get conversation + all messages.
  - [ ] `POST /api/v1/ai/conversations/:id/messages` — post a user message. Server appends user message + assistant reply (calls model with full history). Returns `{ assistantMessage }`.
  - [ ] `PATCH /api/v1/ai/conversations/:id` — rename or archive a conversation.
  - [ ] `DELETE /api/v1/ai/conversations/:id` — hard-delete conversation + all messages.
- [ ] Prompt rewrite for chat:
  - System prompt: brief, role-aware ("You are an assistant for staff at a UK children's care home using the Zikel platform. Be concise, conversational, helpful. You can help with anything related to running a care home.")
  - Pure free-form — NO page context. (Q-Conv-3 = B locked.)
  - Sends conversation history (last N messages, configurable cap to control input tokens) on every turn.
  - Temperature: **0.7** (vs 0.2 for the existing structured `/ai/ask`). Conversational, not deterministic.
  - No PACE guardrails — those belong on safeguarding-specific surfaces, not on general chat.
  - PII redaction still applies (existing `AI_CONTEXT_REDACTION_*` machinery).
- [ ] Auto-title generation: after the first user→assistant exchange, fire a small follow-up call ("summarize this conversation in 4–6 words for a sidebar title"). Cheap (~50 tokens). Updates `AiConversation.title`. Counts against quota as `surface=chat_title` in `AiCallEvent` (tiny but tracked).
- [ ] Quota integration: every chat message decrements the tenant pool by 1. Auto-title generation adds another 1. Per-user/per-role caps respected. (Quota schema lands in Phase 7.4.)
- [ ] Existing `/api/v1/ai/ask` (structured-cards endpoint) — keep but tag clearly: "Used by dashboard widgets; for general chat use `/ai/conversations/*`". Both share the quota.
- [ ] Tests:
  - [ ] Create conversation → post message → assistant reply persisted.
  - [ ] Conversation history threaded correctly (3-turn dialogue, third turn proves model has context from first two).
  - [ ] List, get, archive, delete work + tenant isolation (user A cannot read user B's conversations).
  - [ ] Quota debit on every message + title generation.
  - [ ] Fallback when OpenAI errors — message persisted with `fallbackUsed: true`, user gets graceful canned response, quota still debited (no free retry abuse).

---

## Day 2-3 — Phase 7: Stripe billing with token metering (~30–34h)

### Phase 7.1 — Schema (~2h)

Single migration, runs in one transaction. All new models tenant-scoped where applicable.

- [ ] Enum `SubscriptionStatus`:
  - `trialing` (in trial — full access)
  - `active` (paid up — full access)
  - `past_due_grace` (Stripe says past_due, < 3 days since first failure — full access)
  - `past_due_readonly` (3–14 days past_due — read-only)
  - `suspended` (>14 days past_due OR Stripe `unpaid` — `Tenant.isActive=false`)
  - `cancelled` (Owner cancelled, period ended)
  - `incomplete` (initial state during checkout)
- [ ] Enum `PlanInterval`: `month`, `year`
- [ ] Enum `BillingEventKind`:
  - `subscription_created`, `subscription_updated`, `subscription_deleted`
  - `invoice_paid`, `invoice_payment_failed`
  - `payment_method_updated`
  - `topup_purchased`
  - `tenant_grandfathered`, `manual_admin_override`
  - `quota_reset`
  - `webhook_received`
- [ ] Model `Plan`:
  ```
  id, code (unique: 'standard_monthly' | 'standard_annual'), name, interval (PlanInterval),
  unitAmountMinor (integer pence), currency ('gbp'),
  bundledCallsPerPeriod (integer — 1000 for the Standard plan),
  stripeProductId, stripePriceId, isActive, createdAt, updatedAt
  ```
  Seeded by migration with two rows.
- [ ] Model `TopUpPack`:
  ```
  id, code (unique: 'topup_small' | 'topup_medium' | 'topup_large'), name,
  unitAmountMinor (500 / 1500 / 4000), currency, calls (250 / 1000 / 5000),
  stripeProductId, stripePriceId, isActive, createdAt, updatedAt
  ```
  Seeded by migration with three rows.
- [ ] Model `Subscription` (one row per tenant — `tenantId` is unique):
  ```
  id, tenantId (unique FK), planId (FK), status (SubscriptionStatus),
  stripeCustomerId (unique), stripeSubscriptionId (nullable until first checkout completes),
  trialEndsAt, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd (bool),
  pastDueSince (nullable),
  manuallyOverriddenUntil (nullable — admin support escalation),
  createdAt, updatedAt
  ```
- [ ] Model `Invoice`:
  ```
  id, tenantId, subscriptionId, stripeInvoiceId (unique),
  amountDueMinor, amountPaidMinor, currency, status (Stripe enum string),
  hostedInvoiceUrl, pdfUrl, periodStart, periodEnd, paidAt (nullable),
  createdAt, updatedAt
  ```
- [ ] Model `PaymentMethod`:
  ```
  id, tenantId, stripePaymentMethodId (unique), brand, last4, expMonth, expYear,
  isDefault, createdAt, updatedAt
  ```
- [ ] Model `BillingEvent` (audit + idempotency):
  ```
  id, tenantId (nullable), kind (BillingEventKind),
  stripeEventId (unique nullable — idempotency guard),
  payload (JSON), receivedAt, processedAt (nullable),
  processingError (nullable string)
  ```

### Phase 7.2 — Token metering schema (~2h)

- [ ] Model `TokenAllocation` (one row per tenant per billing period):
  ```
  id, tenantId, periodStart, periodEnd, bundledCalls, topUpCalls,
  usedCalls (denormalised counter — kept in sync with TokenLedgerEntry),
  resetAt, createdAt, updatedAt
  ```
  Unique on `(tenantId, periodStart)`. Created at trial start; rolls over each billing period via cron.
- [ ] Model `TokenLedgerEntry` — append-only ledger of every quota change:
  ```
  id, tenantId, allocationId (FK to TokenAllocation),
  userId (nullable — null for credits like top-ups, set for debits),
  kind (enum: debit_chat | debit_dashboard_card | debit_chronology |
              debit_chat_title | credit_topup | credit_period_reset |
              credit_grandfather | credit_admin_override | credit_refund),
  delta (integer — negative for debits, positive for credits),
  reasonRef (string — e.g. AiCallEvent ID, Stripe Invoice ID, override note),
  createdAt
  ```
  Append-only, immutable. Audit trail. Sum of deltas should equal `TokenAllocation.usedCalls`.
- [ ] Model `TenantAiRestriction` — per-tenant config for the hybrid quota:
  ```
  id, tenantId (unique),
  perRoleCaps (JSON — { Owner: null, Admin: null, "Care Worker": 50, "Read-Only": 0 }),
  perUserCaps (JSON — { "userId123": 200, "userId456": 0 }),
  updatedByUserId, updatedAt
  ```
  All caps are MONTHLY limits. `null` = no cap (free-for-all from pool). `0` = blocked entirely. Number = max calls/month for that role/user, drawn from the pool.

### Phase 7.3 — Stripe wiring (~3h)

- [ ] Add deps: `stripe` (npm)
- [ ] `src/lib/stripe.ts` — singleton client. Reads `STRIPE_SECRET_KEY` from env. Pinned `apiVersion`. Boot-time fail in staging/prod if env var missing.
- [ ] `src/lib/stripe-webhook.ts` — `verifyWebhookSignature(rawBody, signature, secret)`. **Critical: route uses raw-body parser, not Fastify's default JSON parser** — signature verification fails otherwise.
- [ ] Idempotency helper — `recordWebhookEventOnce(stripeEventId, payload)`. Wraps `BillingEvent.create` with the unique constraint on `stripeEventId`; conflict = already processed.
- [ ] `src/lib/billing-status.ts` — single source of truth for `derivePastDueSubStatus(stripeStatus, pastDueSince, now)`. Maps `stripe.status` + elapsed time → our `SubscriptionStatus`.

### Phase 7.4 — Quota enforcement (~3h)

- [ ] `src/middleware/ai-quota.ts` — `requireAvailableQuota(surface)`. Logic:
  1. Load `TokenAllocation` for the tenant's current period (cache per request).
  2. If `usedCalls >= bundledCalls + topUpCalls` → throw `402 AI_QUOTA_EXHAUSTED` with `{ buyTopUpUrl }` link.
  3. Load `TenantAiRestriction`. If `perRoleCaps[user.role] === 0` → `403 AI_DISABLED_FOR_ROLE`. If `perUserCaps[user.id] === 0` → `403 AI_DISABLED_FOR_USER`.
  4. If `perRoleCaps[user.role]` is a number, count user's debits in this period. If exceeded → `402 AI_USER_CAP_EXHAUSTED` with `{ resetAt }`.
  5. Same for `perUserCaps[user.id]` (overrides role cap).
  6. If checks pass, return — caller proceeds to make AI call, then debits via `debitQuota()`.
- [ ] `debitQuota({ tenantId, userId, surface })` — atomic:
  1. Increment `TokenAllocation.usedCalls` (returning).
  2. Insert `TokenLedgerEntry` with `delta = -1`.
  3. Both in one transaction.
- [ ] Apply `requireAvailableQuota` middleware to all 4 AI surfaces:
  - `/api/v1/ai/ask` (dashboard cards)
  - `/api/v1/ai/conversations/:id/messages` (chat)
  - Chronology narrative (called from `/api/v1/safeguarding/chronology/*`)
  - Auto-title generation (internal call, not a route)
- [ ] Quota period reset cron (~hourly). Walks `TokenAllocation` rows where `resetAt < now`. For each:
  - Mark expired (don't delete — keep for history).
  - Create new TokenAllocation for the next period from `Subscription.currentPeriodStart/End`.
  - Write `TokenLedgerEntry { kind: 'credit_period_reset', delta: bundledCalls }`.
- [ ] Tests: pool exhaustion, per-user cap exhaustion, per-role cap exhaustion, top-up immediately replenishes pool, period reset.

### Phase 7.5 — Tenant billing routes (~5h)

All routes: `fastify.authenticate` + `requirePrivilegedMfa`. Add new permissions to `src/auth/permissions.ts`:
- `BILLING_READ` (Owner default)
- `BILLING_WRITE` (Owner only)
- `AI_RESTRICTIONS_WRITE` (Owner default)

- [ ] `GET /api/v1/billing/subscription` — current subscription state + computed UI flags (`isInTrial`, `daysLeftInTrial`, `isReadOnly`, `pastDueSinceDays`, `currentPeriodEnd`).
- [ ] `GET /api/v1/billing/plans` — the Standard plan (monthly + annual variants) + the three top-up packs.
- [ ] `POST /api/v1/billing/checkout-session` — body: `{ planCode: 'standard_monthly' | 'standard_annual' }`. Creates Stripe Checkout Session (mode=subscription). Returns `{ url, expiresAt }`. Reuses existing `stripeCustomerId` if subscription already exists (avoids duplicate Stripe customers).
- [ ] `POST /api/v1/billing/portal-session` — Returns Customer Portal URL. Used to update card, change plan, cancel.
- [ ] `GET /api/v1/billing/invoices` — Paginated invoice history. Includes `hostedInvoiceUrl` and `pdfUrl`.
- [ ] `POST /api/v1/billing/cancel` — Sets `cancelAtPeriodEnd=true` (also accessible via Customer Portal).
- [ ] `GET /api/v1/billing/quota` — current period usage:
  ```
  {
    bundledCalls: 1000,
    topUpCalls: 500,
    usedCalls: 347,
    remainingCalls: 1153,
    periodStart, periodEnd, resetAt,
    perUserUsage: [{ userId, name, role, callsThisPeriod }],
    perRoleUsage: [{ role, callsThisPeriod, capPerUser }]
  }
  ```
- [ ] `POST /api/v1/billing/topup-checkout-session` — body: `{ packCode: 'topup_small' | 'topup_medium' | 'topup_large' }`. Creates Stripe Checkout Session (mode=payment). Returns `{ url, expiresAt }`.
- [ ] `GET /api/v1/billing/ai-restrictions` — current `TenantAiRestriction` config.
- [ ] `PUT /api/v1/billing/ai-restrictions` — update per-role / per-user caps. Body validated against existing role names; `0` means blocked, `null` means no cap, number means cap.

### Phase 7.6 — Webhook handler (~5h)

The hardest single piece. Most defensive code, most testing.

- [ ] `POST /api/v1/integrations/billing/webhook` — public, signature-verified.
- [ ] Raw-body parser registered for THIS route only.
- [ ] Step 1: verify signature → 400 if invalid (Stripe will retry).
- [ ] Step 2: idempotency check — `recordWebhookEventOnce(event.id)`. If already processed, return 200 immediately.
- [ ] Step 3: dispatch by event type. Each handler is wrapped in try/catch; failures write `BillingEvent.processingError` and return 200 to Stripe (handler bug is replayed manually via `replay-billing-event.ts`).

#### Subscription events
- [ ] `checkout.session.completed` (mode=subscription) — link Stripe customer + subscription to Tenant; transition `incomplete → trialing|active`. Initialize first `TokenAllocation`.
- [ ] `customer.subscription.created` — initial sync (race-safety net for the rare case where checkout.session.completed doesn't fire).
- [ ] `customer.subscription.updated` — main state-sync. Maps Stripe `status` → our `SubscriptionStatus` via `derivePastDueSubStatus`. Updates `currentPeriodEnd`, `cancelAtPeriodEnd`, `trialEndsAt`. Mirrors to `Tenant.subscriptionStatus`. **If `currentPeriodEnd` advances, fires `quota_reset` event.**
- [ ] `customer.subscription.deleted` — final state. Move tenant to `cancelled`; if grace expired, also trigger Phase 6 `suspendTenant` with reason `'subscription_cancelled'`.

#### Invoice events
- [ ] `invoice.paid` — upsert Invoice row, set `paidAt`. If subscription was past_due_*, transition to `active`.
- [ ] `invoice.payment_failed` — upsert Invoice. Update `Subscription.pastDueSince` if not already set. Recompute status (fresh failure → `past_due_grace`).

#### Top-up events (one-time payments)
- [ ] `checkout.session.completed` (mode=payment) — branch on session metadata `kind=topup`. Resolves `packCode` → calls. Increments `TokenAllocation.topUpCalls` for the current period. Writes `TokenLedgerEntry { kind: 'credit_topup', delta: +N }`. Writes `BillingEvent { kind: 'topup_purchased' }`.

#### Payment method events
- [ ] `payment_method.attached` / `payment_method.detached` — upsert/delete `PaymentMethod` row.

- [ ] **Replay tooling:** `scripts/replay-billing-event.ts` — given a `BillingEvent.id`, re-runs the appropriate handler. For ops use when a webhook handler bug ships and we have to backfill.

### Phase 7.7 — Enforcement middleware (~3h)

The full status → behaviour matrix:

| Status | Login | GET routes | Mutation routes | AI surfaces | Exports | Billing routes |
|---|---|---|---|---|---|---|
| `trialing` | ✅ | ✅ | ✅ | ✅ (quota) | ✅ | ✅ |
| `active` | ✅ | ✅ | ✅ | ✅ (quota) | ✅ | ✅ |
| `past_due_grace` | ✅ | ✅ | ✅ (banner) | ✅ (quota) | ✅ | ✅ |
| `past_due_readonly` | ✅ | ✅ | ❌ 402 | ❌ 402 | ❌ 402 | ✅ |
| `suspended` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `cancelled` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `incomplete` | ✅ | ✅ | ❌ 402 | ❌ 402 | ❌ 402 | ✅ |

- [ ] `src/middleware/billing-status.ts` exports two middlewares:
  - `requireActiveSubscription` — blocks mutations + AI + exports when status in `(past_due_readonly | incomplete)`. Suspended/cancelled handled via existing `Tenant.isActive=false` (existing Phase 6 mechanism).
  - `requireFullAccess` — stricter, blocks even GETs. (Reserved; not used in v1 — read access stays open in past_due_readonly per matrix.)
- [ ] Apply `requireActiveSubscription` to ALL tenant-side mutating routes EXCEPT `/api/v1/billing/*` and `/api/v1/auth/*`. Done with a single `addHook` at the v1 prefix level, then route-level overrides for the exceptions.
- [ ] Apply to AI surfaces (chat, dashboard cards, chronology) — same middleware, sees `surface=ai` for cleaner error code.
- [ ] Apply to exports module.
- [ ] Past-due transition cron (~hourly): walks subscriptions with `pastDueSince` set. Transitions: 0→3 days = `past_due_grace`; 3→14 days = `past_due_readonly`; >14 days = trigger Phase 6 `suspendTenant`. Each transition writes `BillingEvent`. Reuses the scheduler pattern from `risk-alerts.scheduler.ts` and `otp-retention.ts`.

### Phase 7.8 — Admin (Zikel staff) billing routes (~2h)

- [ ] `GET /admin/billing/subscriptions` — list all subscriptions across all tenants. Filterable, search by tenant name.
- [ ] `GET /admin/billing/subscriptions/:tenantId` — detail (Subscription + recent Invoices + PaymentMethod brand/last4 + current TokenAllocation + recent BillingEvents).
- [ ] `POST /admin/billing/subscriptions/:tenantId/override` — manual override (support escalation). Body: `{ extendTrialDays?, grantFullAccessUntil?, addBonusCalls?, reason }`. Restricted to `platform_admin`. Sets `Subscription.manuallyOverriddenUntil` (bypasses enforcement); optionally credits `addBonusCalls` to current allocation. Logged to `PlatformAuditLog` AND `BillingEvent`.
- [ ] `GET /admin/billing/events` — list `BillingEvent` rows (filterable by tenant, kind, date) for ops debugging.

### Phase 7.9 — Grandfather migration (~1h)

Idempotent — safe to re-run. Part of `phase7_billing_foundation`.

- [ ] For every active tenant with no `Subscription` row:
  - Create a Stripe Customer (metadata only — no PM attached).
  - Create a `Subscription` row with `status='trialing'`, `trialEndsAt = now + 30 days`, `planId = standard_monthly`, `stripeCustomerId` set, `stripeSubscriptionId = null`.
  - Create initial `TokenAllocation { bundledCalls: 1000, periodStart, periodEnd, resetAt }`.
  - Set `Tenant.subscriptionStatus = 'trialing'` and `Tenant.subscriptionId`.
  - Write `BillingEvent { kind: 'tenant_grandfathered' }`.
- [ ] Owner email: trigger via existing Resend pattern after migration. New helper `sendGrandfatheredTrialEmail(ownerEmail, tenantName, trialEndsAt)`. **Body copy must be approved by Julius before send.** Suggested copy in section "Email copy" below.

### Phase 7.10 — Tests (~3h)

- [ ] **Webhook signature** — invalid sig → 400; valid sig → 200; missing header → 400.
- [ ] **Webhook idempotency** — same `event.id` posted twice → second is no-op.
- [ ] **State transitions** — given each Stripe `subscription.updated` payload (`trialing`, `active`, `past_due`, `unpaid`, `canceled`), assert resulting `Subscription.status` and `Tenant.subscriptionStatus`.
- [ ] **Past-due window machine** — drive `pastDueSince` forward in time; assert grace → readonly → suspended at the right thresholds.
- [ ] **Enforcement middleware** — for each status, assert which routes 200 vs 402 vs 401.
- [ ] **Quota machinery** — pool exhaustion → 402; per-user cap → 402; per-role cap → 403; top-up replenishes; period reset.
- [ ] **Checkout session creation** — correct planCode → priceId mapping; stripeCustomerId reuse.
- [ ] **Top-up flow** — checkout.session.completed (mode=payment) → top-up credited correctly.
- [ ] **Grandfather migration** — N tenants without subscriptions → N rows + N tenants tagged `trialing` + N TokenAllocations + N BillingEvents.
- [ ] **Admin override** — manual override bypasses enforcement until expiry.
- [ ] **AI consistency** — `assertAiEnabledForRequest` happy path + 4 rejection paths.
- [ ] **Conversational AI** — multi-turn context preserved; quota debited per message; auto-title fires; tenant isolation; fallback path persists message.

### Phase 7.11 — Real-Stripe-sandbox probe (~2h)

`scripts/_phase7-probe.ts` — temp file, deleted after.

- [ ] Create test customer via Stripe SDK
- [ ] Create checkout session for `standard_monthly`
- [ ] Simulate `checkout.session.completed` webhook (Stripe CLI: `stripe trigger checkout.session.completed`)
- [ ] Assert: Subscription row exists, status=`trialing`, TokenAllocation created
- [ ] Post a chat message → assert quota debited + AiCallEvent + AiMessage rows exist
- [ ] Trigger `invoice.payment_failed` → assert `pastDueSince` set, status=`past_due_grace`
- [ ] Manually advance time (mock cron); assert status flips to `past_due_readonly`
- [ ] Try mutation route → assert 402
- [ ] Trigger `invoice.paid` → assert status=`active`
- [ ] Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0341` (attach-fail), `4000 0025 0000 3155` (3DS)

### Phase 7.12 — Production runbook (`payment-runbook.md`)

Separate doc. ~1h.

- [ ] First-live-charge checklist (verify in Stripe Dashboard before letting FE merge)
- [ ] How to read `BillingEvent` to debug a failed sync
- [ ] How to manually grant access (admin override route)
- [ ] How to issue a refund (Customer Portal flow + manual Stripe Dashboard)
- [ ] How to handle a chargeback / dispute (manual Stripe; mark suspended if needed)
- [ ] How to replay missed webhooks
- [ ] Token quota debug recipes

---

## Stripe setup runbook (for Julius)

Done before any code can hit real Stripe. ~25 minutes.

- [ ] **1. Create Stripe account.** UK country. Test mode for everything below.
- [ ] **2. API keys.** Developers → API keys. Copy `Publishable key` (`pk_test_…`) and `Secret key` (`sk_test_…`).
- [ ] **3. Create the Standard product:** Products → Add product:
  - Name: `Zikel Solutions — Standard`
  - Description: `Per-tenant subscription. All features included. 1,000 AI calls per month.`
  - Tax behavior: Inclusive
- [ ] **4. Add two prices to the Standard product:**
  - £30.00 GBP / monthly recurring → copy price ID → `STRIPE_PRICE_ID_MONTHLY`
  - £300.00 GBP / yearly recurring → copy price ID → `STRIPE_PRICE_ID_ANNUAL`
- [ ] **5. Create three top-up products** (one product each, single one-time price):
  - `Zikel Solutions — 250 AI Calls Top-Up` / £5 one-time → `STRIPE_PRICE_ID_TOPUP_SMALL`
  - `Zikel Solutions — 1,000 AI Calls Top-Up` / £15 one-time → `STRIPE_PRICE_ID_TOPUP_MEDIUM`
  - `Zikel Solutions — 5,000 AI Calls Top-Up` / £40 one-time → `STRIPE_PRICE_ID_TOPUP_LARGE`
- [ ] **6. Enable Stripe Tax.** Settings → Tax → Enable. Origin = your UK business address.
- [ ] **7. Configure Customer Portal.** Settings → Billing → Customer Portal:
  - Update payment methods ✅
  - Plan switching (monthly ↔ annual) ✅
  - Cancellation at period end ✅
  - Invoice history ✅
- [ ] **8. Webhook endpoint.** Developers → Webhooks → Add endpoint:
  - URL: `https://<prod-host>/api/v1/integrations/billing/webhook`
  - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `payment_method.attached`, `payment_method.detached`
  - Copy signing secret → `STRIPE_WEBHOOK_SECRET`
- [ ] **9. Local dev:** `brew install stripe/stripe-cli/stripe`, `stripe login`, then `stripe listen --forward-to http://localhost:3000/api/v1/integrations/billing/webhook`. Use the secret it prints.
- [ ] **10. Hand me the env values** (paste into Render dashboard for staging/prod):
  - `STRIPE_SECRET_KEY`
  - `STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRICE_ID_MONTHLY`
  - `STRIPE_PRICE_ID_ANNUAL`
  - `STRIPE_PRICE_ID_TOPUP_SMALL`
  - `STRIPE_PRICE_ID_TOPUP_MEDIUM`
  - `STRIPE_PRICE_ID_TOPUP_LARGE`

---

## Env vars added in this phase

- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_PUBLISHABLE_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `STRIPE_PRICE_ID_MONTHLY`
- [ ] `STRIPE_PRICE_ID_ANNUAL`
- [ ] `STRIPE_PRICE_ID_TOPUP_SMALL`
- [ ] `STRIPE_PRICE_ID_TOPUP_MEDIUM`
- [ ] `STRIPE_PRICE_ID_TOPUP_LARGE`
- [ ] `BILLING_CHECKOUT_SUCCESS_URL` — e.g. `https://app.zikelsolutions.com/billing/success?session={CHECKOUT_SESSION_ID}`
- [ ] `BILLING_CHECKOUT_CANCEL_URL` — e.g. `https://app.zikelsolutions.com/billing/canceled`
- [ ] `BILLING_PORTAL_RETURN_URL` — e.g. `https://app.zikelsolutions.com/billing`
- [ ] All wired into `render.yaml` (with `sync: false`)

---

## Email copy (suggested — Julius to approve before send)

### Grandfather email (sent on rollout)

> Subject: A small change to your Zikel account — 30-day complimentary trial
>
> Hi {ownerName},
>
> We're rolling out subscriptions on the Zikel platform. As an existing customer, your **{tenantName}** account has been put on a complimentary 30-day trial — you keep full access through {trialEndsAt}, no payment method required.
>
> When the trial ends, you'll be asked to choose between £30/month or £300/year (2 months free). Both include 1,000 AI assistant calls per month and all current features.
>
> No action needed today. We'll remind you 7 days, 1 day, and on the day your trial ends. You can subscribe early at any time from Settings → Billing.
>
> Reply to this email with any questions.
>
> — The Zikel team

---

## Risk register

- [ ] **Webhook idempotency bug = corrupt billing state.** Mitigated by unique constraint on `BillingEvent.stripeEventId`. First test that must pass.
- [ ] **Signature verification bypass = anyone forges subscription events.** Mitigated by signature-first handler. Test: invalid sig → 400, no DB writes.
- [ ] **Race: webhook arrives before checkout completes our redirect.** Mitigated by handling both `checkout.session.completed` AND `customer.subscription.created` defensively (either-first works).
- [ ] **Stripe API version drift.** Mitigated by pinned `apiVersion`. Boot warning if SDK default ≠ pinned.
- [ ] **Past-due cron stalls.** Each transition writes a BillingEvent; if no transitions for >25 hours, follow-up alert (Phase 7.5 follow-up).
- [ ] **Token-metering double-debit.** Mitigated: `debitQuota` is a single transaction (`update + insert ledger entry`); `requireAvailableQuota` is read-only and not atomic with the AI call. Worst case: a quota check passes, AI call fails before debit — user got a free try. Acceptable tradeoff vs. holding a transaction across an external HTTP call.
- [ ] **Quota refund on AI failure.** When OpenAI errors, do we still debit? Decision: **yes** (per the conversational AI test plan above) — prevents free-retry abuse where a user spams a known-bad prompt to drain the model. Errors are logged but quota stays debited.
- [ ] **Conversation history grows unbounded → high input token cost.** Mitigated by capping history sent to model at last 20 messages (configurable). Older messages stay in DB but aren't sent to the model.
- [ ] **First-live transaction surprises.** Extensive sandbox testing; production runbook with first-charge checklist; manual confirmation of the first invoice in production before FE merges billing UI.
- [ ] **24h scope creep.** This document is the only allowed scope. Extensions go into a `phase8.5-followups.md`.

---

## 24h+ timeline (2.5 days)

Times are budget, not commitment. Buffer is real.

### Day 1 — AI (~16-18h)
- [ ] **Hour 0–1** — Plan signed off. Stripe setup runbook started in parallel.
- [ ] **Hour 1–4** — Phase 8.1 (AI consistency): `Tenant.aiEnabled`, `aiAccessEnabled` default flip, `AiCallEvent` schema + writes, `assertAiEnabledForRequest`, default `includeNarrative: false`, render.yaml hygiene. Migration applied.
- [ ] **Hour 4–6** — Phase 8.2 schema: `AiConversation`, `AiMessage`. Migration applied.
- [ ] **Hour 6–10** — Phase 8.2 routes: list, get, create, post-message, archive, delete. Free-form prompt + history threading.
- [ ] **Hour 10–12** — Phase 8.2 polish: auto-title generation, fallback handling, redaction integration.
- [ ] **Hour 12–14** — Phase 8 tests + production smoke (real chat against gpt-4o-mini in staging).
- [ ] **Hour 14–16** — Buffer: prompt tuning if responses still feel off; PII redaction edge cases.

### Day 2 — Billing core (~14-16h)
- [ ] **Hour 16–18** — Phase 7.1 + 7.2 schemas (Plan, Subscription, Invoice, PaymentMethod, BillingEvent, TopUpPack, TokenAllocation, TokenLedgerEntry, TenantAiRestriction). Migration written + reviewed + applied.
- [ ] **Hour 18–21** — Phase 7.3 Stripe wiring (singleton, signature verification, idempotency). First test passing: invalid sig → 400.
- [ ] **Hour 21–24** — Phase 7.4 quota machinery + middleware. Quota tests passing.
- [ ] **Hour 24–28** — Phase 7.5 tenant routes (subscription, plans, checkout, portal, invoices, cancel, quota, topup-checkout, ai-restrictions).
- [ ] **Hour 28–30** — Phase 7.6 webhook handler — subscription events.

### Day 3 — Billing finish + tests (~14-16h)
- [ ] **Hour 30–34** — Phase 7.6 webhook handler — invoice + top-up + payment method events.
- [ ] **Hour 34–37** — Phase 7.7 enforcement middleware. Past-due transition cron. Status matrix tests.
- [ ] **Hour 37–39** — Phase 7.8 admin routes.
- [ ] **Hour 39–40** — Phase 7.9 grandfather migration. Email copy approved + helper wired.
- [ ] **Hour 40–43** — Phase 7.10 full test sweep. Phase 7.11 Stripe sandbox probe.
- [ ] **Hour 43–46** — Phase 7.12 production runbook.
- [ ] **Hour 46–48** — Buffer for inevitable Stripe quirks. Final typecheck + full test suite green + commit-ready.

---

## What I need from you to start

1. **Sign-off on this plan** (or push back on any item).
2. **Approve the grandfather email copy** (under "Email copy" above) — or tell me what to change.
3. **Stripe setup runbook completion** + send me the 8 env vars from step 10. (You can do this in parallel with my Day 1 work — I don't block on it until Day 2 hour 21.)
4. **Confirm the FE team is ready** to consume `/billing/*` and `/ai/conversations/*` — or warn me if they're not so I scope test fixtures appropriately.

When all four are in place, I start. First commit is the AI consistency migration.
