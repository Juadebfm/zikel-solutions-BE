# Payment runbook

Operational playbook for the Phase 7 billing system. Read this before the first live charge, and keep it open for any billing incident.

---

## 0. Pre-launch checklist (one-time, before first live tenant)

- [ ] **Stripe account live mode activated.** Business verification complete in Stripe Dashboard. Payouts enabled (your bank account verified).
- [ ] **Live keys set in Render.** Replace test-mode env vars with live-mode equivalents:
  - `STRIPE_SECRET_KEY=sk_live_…`
  - `STRIPE_PUBLISHABLE_KEY=pk_live_…`
  - `STRIPE_WEBHOOK_SECRET=whsec_…` (the LIVE webhook endpoint's secret, not the test one)
  - `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_ANNUAL`, `STRIPE_PRICE_ID_TOPUP_*` — the LIVE price ids
- [ ] **Webhook endpoint URL pointed at production.** In Stripe Dashboard → Developers → Webhooks, create a LIVE endpoint at `https://<prod-host>/api/v1/integrations/billing/webhook` listening for the 8 event types in payment.md.
- [ ] **Stripe Tax enabled** with origin address. Tax behavior: Inclusive.
- [ ] **Customer Portal configured** with: update PM ✓, plan switching ✓, cancellation at period end ✓, invoice history ✓.
- [ ] **Boot seeder ran successfully** — check Render logs for `Billing seed:` info lines. Confirm `Plan` and `TopUpPack` rows exist via `GET /api/v1/billing/plans` (Owner credentials).
- [ ] **Grandfather migration run against prod.** `npm run grandfather:tenants` (or run with `DRY_RUN=1` first to preview). Owner emails fan out automatically.
- [ ] **First-charge canary.** Subscribe ONE friendly internal tenant first; manually verify in Stripe Dashboard that the invoice posted, the webhook fired, and `Subscription.status='active'` in our DB.

---

## 1. Day-to-day ops

### How a customer subscribes (the happy path)
1. Owner hits `POST /api/v1/billing/checkout-session` with `{ planCode: 'standard_monthly' }`.
2. They're redirected to Stripe Hosted Checkout, enter card, complete.
3. Stripe redirects to `BILLING_CHECKOUT_SUCCESS_URL`.
4. Stripe fires `checkout.session.completed` then `customer.subscription.created` → our webhook handler upserts the `Subscription` row + flips `Tenant.subscriptionStatus`.
5. Owner now sees `status: 'trialing'` in `GET /api/v1/billing/subscription` (7-day trial from Stripe).

If anything in that flow looks off in production, **first place to look is `BillingEvent`** (via `GET /admin/billing/events?tenantId=…`). Every webhook delivery writes one.

### How a customer buys a top-up
1. Owner hits `POST /api/v1/billing/topup-checkout-session` with `{ packCode: 'topup_medium' }`.
2. Hosted Checkout (mode=payment, one-time charge).
3. Stripe fires `checkout.session.completed` with `metadata.kind='topup'` → handler calls `creditTopUp` → `TokenAllocation.topUpCalls += pack.calls` + ledger row written.
4. The credit is available immediately for AI calls.

### How past-due → suspended progresses (automated)
Our cron (`runPastDueTransitionPass`) runs hourly. State machine:
- Stripe `invoice.payment_failed` → `Subscription.pastDueSince = now`, status → `past_due_grace`. Stripe also retries the charge automatically on its dunning schedule.
- Day 0–3 since first failure → `past_due_grace` (full access; banner shown).
- Day 3–14 → `past_due_readonly` (mutations + AI + exports return 402; reads still work; billing routes still work).
- Day 14+ → `suspended` (existing Phase 6 mechanism; tenant `isActive=false`; all sessions revoked).
- Stripe `invoice.paid` (recovery) → cleared; status → `active`; cron skips.

---

## 2. Common incidents

### "Customer says they paid but they're still locked out"
1. Look up their Subscription: `GET /admin/billing/subscriptions/<tenantId>`.
2. Check `status` and `pastDueSince`. Compare against most recent `Invoice.status`.
3. Check `BillingEvent` for the most recent `invoice.paid` event (`GET /admin/billing/events?tenantId=<tenantId>&kind=invoice_paid`).
4. **If Stripe fired `invoice.paid` but our DB never recovered:** the webhook handler must have failed. Look at `BillingEvent.processingError` for that event row. Replay manually via the Stripe Dashboard (Webhooks → Recent deliveries → Resend) — our idempotency table will accept it.
5. **If Stripe never fired `invoice.paid`:** check Stripe Dashboard directly. Maybe it's still in retry. Maybe an open invoice. Don't flip our DB by hand — let Stripe drive the truth.
6. **As a last-resort emergency unblock:** apply a manual override (see "Emergency: grant immediate access" below).

### "Customer wants to upgrade / change plan / change card"
Send them to the Customer Portal (`POST /api/v1/billing/portal-session`). They handle everything there — we don't need to touch the DB. Stripe fires webhook events when state changes; our handlers sync.

### "Webhook handler exception in production"
Logs will have a structured `[billing-webhook]` error. The `BillingEvent` row will have `processedAt: null` and `processingError: <message>`. To recover:
1. Identify the `BillingEvent.id` (or the `stripeEventId`).
2. Fix the underlying bug (deploy the patch).
3. Resend the event from the Stripe Dashboard. Our idempotency check sees the same `stripeEventId`, returns 200 immediately. Then the next handler run is on you — we don't currently auto-replay failed events. **Future:** a manual replay endpoint for the BillingEvent row is on the follow-up list.

### "Grandfather email didn't send for tenant X"
Grandfather emails are best-effort. If `RESEND_API_KEY` was unset at run time the email body went to logs. Re-run for that one tenant:
```bash
npx tsx scripts/grandfather-tenants.ts # re-runs across all tenants; existing rows skipped silently
```
The grandfather is idempotent — re-running won't create a second Subscription row. But it WILL re-send the email. If you want to re-send to a single tenant, write a one-shot script using the `grandfatherTenant` + `sendGrandfatheredTrialEmail` exports.

### "Top-up purchased but calls didn't credit"
1. Check `BillingEvent` for the `topup_purchased` event for this tenant.
2. If present and `processedAt` set: the credit ran. Check `TokenLedgerEntry` for a matching `credit_topup` row. Check `TokenAllocation.topUpCalls`.
3. If present but `processingError` set: handler failed. Same recovery as webhook failure (above).
4. If NOT present: the webhook never arrived. Check the Stripe Dashboard's Webhooks tab — was a `checkout.session.completed` event delivered for that session?

---

## 3. Emergency: grant immediate access

A customer is locked out, you're on a call with them, and you need to unblock NOW. Use the platform_admin override:

```bash
curl -X POST https://<prod>/admin/billing/subscriptions/<tenantId>/override \
  -H "Authorization: Bearer <YOUR_PLATFORM_JWT>" \
  -H "content-type: application/json" \
  -d '{
    "grantFullAccessUntil": "2026-05-12T00:00:00Z",
    "reason": "Stripe outage on 2026-05-09 caused billing failure. Granted full access until customer can update their card."
  }'
```

`grantFullAccessUntil` makes the enforcement middleware bypass the gate until that timestamp, regardless of Subscription.status. Logged in `PlatformAuditLog` and `BillingEvent`.

**Other override actions:**
- `extendTrialDays: 30` — bumps `trialEndsAt` and (if status was non-allowing) flips back to `trialing`. Use when a customer needs more evaluation time.
- `addBonusCalls: 1000` — credits the AI pool. Use as goodwill credit.

All three can be combined in one request.

---

## 4. Refunds

Refunds are issued via the **Stripe Dashboard**, not via our API. We don't model "refunded" as a billing state — we just receive the resulting `invoice.updated` or `charge.refunded` events (which we currently don't handle).

If a refund needs to result in `addBonusCalls`-style restoration, do that manually via the override endpoint with a reason that links to the Stripe refund id. The future enhancement is to handle `charge.refunded` automatically.

---

## 5. Disputes / chargebacks

Stripe handles dispute UI in the Dashboard. If you accept the dispute (refund the customer), follow the refund flow above. If you contest, you do that in Stripe.

If the customer's behaviour caused us to want to suspend them outright after a dispute, do it via the existing Phase 6 suspend route:

```bash
curl -X POST https://<prod>/admin/tenants/<tenantId>/suspend \
  -H "Authorization: Bearer <YOUR_PLATFORM_JWT>" \
  -H "content-type: application/json" \
  -d '{ "reason": "Chargeback filed; account under review." }'
```

---

## 6. Manual replay of a missed webhook

Workflow when you discover a `BillingEvent.processingError` and the underlying bug is fixed:

1. Stripe Dashboard → Developers → Events → search by event id.
2. Click "Resend" on that event.
3. Stripe re-delivers to our endpoint. Our idempotency table sees the same `stripeEventId` and returns 200 immediately — but **doesn't re-run the handler**.
4. **To force re-handling: delete the BillingEvent row first**, then resend from Stripe.
   ```sql
   DELETE FROM "BillingEvent" WHERE "stripeEventId" = '<evt_xxx>';
   ```
   The next delivery runs the handler from scratch.

This is an ops-only path. Future enhancement: a `POST /admin/billing/events/:id/replay` endpoint that does this without manual SQL.

---

## 7. Token quota debugging

### "Customer says AI is broken"
1. `GET /api/v1/billing/quota` (as that tenant's Owner) — shows pool, top-ups, used, per-user breakdown.
2. If `remainingCalls === 0`: pool exhausted. Recommend they buy a top-up or wait for period reset.
3. If a specific user is blocked: check `TenantAiRestriction.perRoleCaps` / `perUserCaps`. The Owner might have set a cap.
4. If pool is fine but AI still failing: it's an AI provider issue (OpenAI down / API key wrong / model name wrong). Look at recent `AiCallEvent` rows with `status='error'` or `status='fallback'`.

### "I want to bump a specific user's monthly cap"
That's a tenant-Owner action via `PUT /api/v1/billing/ai-restrictions`, not a platform action. If they need help, walk them through the admin UI.

### "Period reset didn't fire"
The cron runs hourly and uses `Subscription.currentPeriodEnd` as the trigger. If the cron hasn't run for a tenant whose period has ended:
- Check `Subscription.currentPeriodEnd` for that tenant.
- Check `TokenAllocation` rows for that tenant — there should be a row with `resetAt < now`.
- Look at recent `BillingEvent` rows with `kind='quota_reset'`.
- If the cron is stalled, the `setInterval` died or Render restarted the instance after the last run. Force a one-shot reset by manually running the function in a node REPL OR (production-safe) write a script that calls `resetExpiredAllocations()`.

---

## 8. Schema rollback (last-resort disaster recovery)

**Don't.** The Phase 7 schema is intertwined with running customer state. A rollback after the first paying customer means manual money reconciliation against Stripe.

If you absolutely must, the migration file is `prisma/migrations/20260509070957_phase7_billing_foundation`. Reversing it requires:
1. Drop new tables (`Plan`, `Subscription`, etc.) — **all data gone**.
2. Drop the `Tenant.subscriptionStatus` column.
3. Drop the new enums.

Talk to engineering before pulling this trigger.

---

## 9. Useful queries

### "Who's about to fall off trial in the next 3 days?"
```sql
SELECT t.name, t.slug, s."trialEndsAt"
FROM "Subscription" s
JOIN "Tenant" t ON t.id = s."tenantId"
WHERE s.status = 'trialing'
  AND s."trialEndsAt" BETWEEN now() AND now() + interval '3 days'
ORDER BY s."trialEndsAt" ASC;
```

### "Who's currently past_due?"
```sql
SELECT t.name, s.status, s."pastDueSince",
  EXTRACT(DAY FROM now() - s."pastDueSince") AS days_past_due
FROM "Subscription" s
JOIN "Tenant" t ON t.id = s."tenantId"
WHERE s."pastDueSince" IS NOT NULL
ORDER BY s."pastDueSince" ASC;
```

### "Which tenants are heavy AI users this period?"
```sql
SELECT t.name, ta."usedCalls", ta."bundledCalls", ta."topUpCalls",
  (ta."bundledCalls" + ta."topUpCalls" - ta."usedCalls") AS remaining
FROM "TokenAllocation" ta
JOIN "Tenant" t ON t.id = ta."tenantId"
WHERE ta."resetAt" > now()
ORDER BY ta."usedCalls" DESC
LIMIT 20;
```

### "All BillingEvent failures (unprocessed)"
```sql
SELECT id, "tenantId", kind, "stripeEventId", "processingError", "receivedAt"
FROM "BillingEvent"
WHERE "processingError" IS NOT NULL
ORDER BY "receivedAt" DESC
LIMIT 50;
```

---

## 10. Contact

- Stripe support: <https://support.stripe.com>
- Resend support: <support@resend.com> (for email delivery issues)
- Production env: Render dashboard → `zikel-solutions-be`
- Database: Neon (serverless Postgres) — connection details in Render env

---

## Appendix: env var reference

| Var | Required in prod | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | Server-side Stripe SDK |
| `STRIPE_PUBLISHABLE_KEY` | yes | FE / Stripe.js |
| `STRIPE_WEBHOOK_SECRET` | yes | HMAC verification on inbound events |
| `STRIPE_API_VERSION` | yes (defaults to pinned date) | Lock SDK against breaking API upgrades |
| `STRIPE_PRICE_ID_MONTHLY` | yes | The £30/mo Stripe Price id |
| `STRIPE_PRICE_ID_ANNUAL` | yes | The £300/yr Stripe Price id |
| `STRIPE_PRICE_ID_TOPUP_SMALL/MEDIUM/LARGE` | yes | The three top-up Price ids |
| `BILLING_CHECKOUT_SUCCESS_URL` | yes | FE redirect after Stripe Checkout success |
| `BILLING_CHECKOUT_CANCEL_URL` | yes | FE redirect after Stripe Checkout cancel |
| `BILLING_PORTAL_RETURN_URL` | yes | FE redirect after Customer Portal exit |

Set them in `render.yaml` (declarations) + Render dashboard (values, `sync: false`).
