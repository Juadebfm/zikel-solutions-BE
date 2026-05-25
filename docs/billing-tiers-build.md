# Billing Tiers Build — Single Home / Multi-Home / Group

**Status:** scoped, not yet started
**Branch (planned):** `add-plan-tiers`
**Estimated effort:** ~3 days end-to-end (no live customers — migration tooling not needed)
**Last updated:** 2026-05-25

---

## Decisions locked

| Decision | Value | Source |
|---|---|---|
| Tier shape | **Single Home / Multi-Home / Group** | Julius, 2026-05-25 (after industry research showed 3-tier converts 1.4× vs 2-tier and "Group" is care-native vocabulary) |
| Per-bed rate | **£7/bed/mo flat** across Single + Multi tiers (Group is sales-led, no published rate) | Julius — matches CareDocs mid-market positioning |
| Monthly minimum / floor fee | **None** — pure per-bed | Julius |
| Product status | **Not live** — no paying customers exist. Migration tooling, comms emails, and grandfathering are all out of scope | Julius, 2026-05-25 |
| Tier lever | Per-bed pricing + capacity limits (homes / seats / AI calls) | Industry norm |
| CTA per tier | Self-serve checkout (Single + Multi) / Contact-sales form (Group) | Standard SaaS |

## Tier specifications

| Field | Single Home | Multi-Home | Group |
|---|---|---|---|
| Bed rate | £7/bed/mo | £7/bed/mo | Custom |
| Max homes | 1 | 5 | Unlimited |
| Max seats | 25 | 75 | Unlimited |
| Monthly AI calls | 1,000 | 5,000 | Custom |
| Top-ups available | Yes | Yes | Custom |
| Stripe billing model | Metered (`usage_type: 'metered'`) | Metered | None — sales contract |
| CTA on pricing page | "Subscribe" → Stripe Checkout | "Subscribe" → Stripe Checkout | "Contact sales" → form endpoint |
| Feature set | Full Zikel suite (safeguarding, audit, AI, MFA, etc.) | Same as Single | Same + dedicated onboarding/support |

## Build checklist

### Schema (Prisma migrations)
- [x] Add `Plan.pricePerBedMinor` (Int, nullable) — pence per bed/month
- [x] Add `Plan.maxHomes` (Int, nullable; null = unlimited)
- [x] Add `Plan.maxSeats` (Int, nullable; null = unlimited)
- [x] Add `Subscription.maxHomesOverride` (Int, nullable; null = inherit from Plan) — retained for future Group-tier negotiated contracts
- [x] Add `Subscription.maxSeatsOverride` (Int, nullable) — same rationale
- [x] Add `Subscription.bedCountSnapshot` (Int, nullable) — last reported bed count for usage reporting
- [x] Add `Subscription.lastUsageReportedAt` (DateTime, nullable)
- [x] ~~Add `Home.bedCount`~~ — **not needed.** `Home.capacity` (Int, nullable, 1-1000) already exists at [prisma/schema.prisma:896](prisma/schema.prisma#L896) and is semantically the bed count. Reuse it; tighten the create-home schema to require it for new homes (deferred to Day 3 enforcement work).
- [x] Migration applied: `20260525180843_add_plan_tiers_and_per_bed_billing` (additive only, no data risk)

### Stripe configuration (manual + via API)
- [ ] Create new Stripe Product: "Zikel Single Home"
- [ ] Create new Stripe Product: "Zikel Multi-Home"
- [ ] Create metered Price under Single Home: £7/bed/mo, `usage_type: 'metered'`, `aggregate_usage: 'last_during_period'`
- [ ] Create metered Price under Multi-Home: £7/bed/mo, same config
- [x] Add env vars schema entries: `STRIPE_PRICE_ID_SINGLE_HOME`, `STRIPE_PRICE_ID_MULTI_HOME` (in `src/config/env.ts`)
- [x] Remove `STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_ANNUAL` from env schema (deprecated — flat-fee plans never went live)
- [ ] Set actual price IDs in deployment env (Render dashboard) once Stripe Products are created

### Seed updates (`src/modules/billing/billing.seed.ts`)
- [x] Deactivate (not delete — FK safety) existing `standard_monthly` and `standard_annual` rows
- [x] Insert new `single_home` Plan row (£7/bed, 1 home, 25 seats, 1000 AI)
- [x] Insert new `multi_home` Plan row (£7/bed, 5 homes, 75 seats, 5000 AI)
- [x] Insert new `group` Plan row (`stripePriceId: null`, `pricePerBedMinor: null`, all limits null, `salesLed: true` so it seeds regardless of env)

### API: `GET /api/v1/billing/plans`
- [x] Update `mapPlan()` to expose `pricePerBedMinor`, `maxHomes`, `maxSeats`, `bundledCallsPerPeriod`
- [x] Add derived `cta` field to plan response: `'subscribe'` if `stripePriceId !== null` else `'contact_sales'`
- [x] Update OpenAPI summary text + response schema (`additionalProperties: true` allows new fields through)
- [x] Update tests in `tests/billing.routes.test.ts` (asserts new fields + cta values for both subscribe and contact_sales tiers)
- [x] Refactored `getSubscriptionState` to use `mapPlan` instead of inlining plan shape (so `cta` flows through to the active-subscription view too)

### API: Checkout flow rewrite for per-unit (quantity) subscriptions
- [x] Update `createSubscriptionCheckoutSession` to accept the new plan codes (`single_home`, `multi_home`)
- [x] Pass initial bed-count quantity to Stripe at checkout (so the first invoice has a basis)
- [x] `group` plan code rejected at request schema level — Zod enum allows only `single_home | multi_home`
- [x] Course-corrected from metered usage records → per-unit quantity (matches care-SaaS norm; Stripe handles proration natively)

### Enforcement guards
- [x] New module: `src/modules/billing/capacity-enforcement.ts` — `assertHomeCapAvailable` + `assertSeatCapAvailable`
- [x] `homes.service.createHome` calls `assertHomeCapAvailable` before any other work — throws `HOME_LIMIT_REACHED` (402)
- [x] `invitations.service.createInvitation` calls `assertSeatCapAvailable` — throws `SEAT_LIMIT_REACHED` (402); counts active members + pending non-expired invites so mass-invite cannot bypass cap
- [x] Effective cap reads `Subscription.maxHomesOverride ?? plan.maxHomes` (same for seats)
- [x] `null` cap means unlimited (Group tier) — short-circuits without counting
- [x] No-subscription state logs a warning and allows — guards against breaking dev/test where Subscription row may not exist yet
- [x] AI calls: already enforced via `requireAvailableQuota`, no change needed
- [x] Error messages are FE-displayable directly ("Home limit reached. You're using 1 of 1 homes on the Single Home plan. Upgrade your plan to add more homes.")

### `POST /api/v1/billing/contact-sales`
- [x] Added route in `billing.routes.ts`
- [x] Zod body schema: `{ phone?, companyName?, estimatedHomes?, message? }` — name + email come from the authenticated user (no override possible)
- [x] Rate-limit: 5 req / 10 min per IP
- [x] Email delivered via Resend (`src/lib/email.ts:sendContactSalesLeadEmail`) to hardcoded `sales@zikelsolutions.com`
- [x] Writes audit log entry: `entityType: 'contact_sales_lead'`, action `record_created`
- [x] Gated on `BILLING_WRITE` permission (Owner-only), consistent with locked role decisions

### Per-unit quantity sync (replaces metered usage scheduler)
- [x] New module: `src/modules/billing/subscription-quantity.ts`
- [x] `getTenantBedCount(tenantId)` — sums `Home.capacity` where `isActive=true`, floors at 1
- [x] `syncStripeSubscriptionQuantity(tenantId)` — idempotent push to Stripe subscription item, updates `bedCountSnapshot` + `lastUsageReportedAt`
- [x] No-op paths covered: no Subscription, no `stripeSubscriptionId`, snapshot unchanged
- [x] Errors swallowed + logged (Stripe outage must not break home mutations)
- [x] Wired into `homes.service.createHome` (always) and `homes.service.updateHome` (only when `capacity` or `isActive` changes)
- [x] No scheduler needed — per-unit quantity is updated reactively on home mutations

### Tests
- [x] `tests/billing.routes.test.ts` — plans endpoint asserts new fields + `cta`, checkout passes bed-count `quantity`, contact-sales accepts/audits leads (existing file extended)
- [x] `tests/billing.subscription-quantity.test.ts` — new file, 8 tests covering bed-count helper + Stripe sync edge cases (no-op paths, snapshot dedup, error swallowing)
- [x] `tests/billing.capacity-enforcement.test.ts` — new file, 10 tests covering home cap, seat cap, override-beats-plan, unlimited (Group), no-Subscription fallback
- [x] `tests/grandfather.test.ts` + `tests/admin-billing.routes.test.ts` updated for new plan codes
- [ ] **Manual:** Stripe sandbox end-to-end checkout — subscribe with Single Home + £7 price, add 2nd home, observe `subscription_items.update(quantity)` call in Stripe dashboard, verify invoice prorates
- [ ] **Manual:** trigger 402 paths from the FE — verify error messages render acceptably in the upgrade prompt

### FE handoff
- [ ] Updated feature-bullet hardcode list (see "FE hardcode skeleton" below)
- [ ] FE wires plan card CTAs based on `plan.cta` field
- [ ] FE renders bed-count input on Home create/edit screens
- [ ] FE renders "Contact sales" form on Group card, posts to `/billing/contact-sales`

## FE hardcode skeleton (interim, before BE ships `features` field)

```ts
const SINGLE_HOME_FEATURES = [
  '1 care home',
  'Up to 25 staff seats',
  '£7 per bed / month',
  '1,000 AI assistant calls per month (top-ups available)',
  'Safeguarding suite: risk alerts, chronology, patterns, RI dashboard',
  'Reflective practice prompts & registration packs',
  'Tamper-evident audit trail with security alerts',
  'Per-role and per-user AI access controls',
  'Two-factor authentication & secure document uploads',
  'Email support',
];

const MULTI_HOME_FEATURES = [
  'Up to 5 care homes',
  'Up to 75 staff seats',
  '£7 per bed / month',
  '5,000 AI assistant calls per month (top-ups available)',
  // ...same capability bullets as Single Home
  'Priority email support',
];

const GROUP_FEATURES = [
  'Unlimited care homes',
  'Unlimited staff seats',
  'Custom AI quota',
  // ...same capability bullets as Multi-Home
  'Dedicated onboarding & priority support',
  'Custom contract terms',
];
```

## Open questions / risks

- [ ] **Pricing-page legal copy.** "£7/bed/month" needs VAT clarification (inclusive vs exclusive). Stripe handles VAT via Tax Rates, but pricing page text should say "+VAT" or "ex VAT" explicitly.
- [ ] **Group tier minimum?** No minimum published, but sales may want internal guidance (e.g. "from £X/mo, custom from 6+ homes"). Currently no published floor.
- [ ] **Annual discount?** Per-bed metered billing doesn't lend itself to a "2 months free annual" discount the way flat-fee does. Decide: add annual commitment option later, or skip entirely?
- [ ] **Top-up packs after tier switch.** Top-ups are tenant-scoped, not Plan-scoped — a tenant who upgrades from Single Home → Multi-Home keeps their top-ups. Sanity-check this in tests.

## Sequencing

1. **First, ship the memberships-schema + CORS fix PR** (uncommitted on local right now). Unblocks FE, deploys in minutes via Render.
2. Cut `add-plan-tiers` branch off main after step 1 lands.
3. **Day 1** — Schema migrations + seed (delete old Plan rows, insert new) + `mapPlan` + `GET /billing/plans` response shape.
4. **Day 2** — Stripe metered Price config (manual + env vars) + `createSubscriptionCheckoutSession` rewrite for metered subs + usage-report scheduler.
5. **Day 3** — Enforcement guards (home/seat caps) + `POST /billing/contact-sales` + tests + manual Stripe sandbox verification.
6. PR review, merge, Render auto-deploy.

## References

- Industry research notes (in conversation history): 3-tier B2B SaaS converts ~1.4× vs 2-tier; per-bed is dominant lever in UK care-home SaaS; "Group" is care-native vocabulary; CareDocs benchmark ~£7/bed/mo.
- Related repo docs: `docs/role-and-membership-contract.md` (ADR pattern reference).
- Stripe metered billing: https://stripe.com/docs/products-prices/pricing-models#usage-based-pricing
