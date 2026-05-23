# Role & Membership Contract — Decisions

**Date:** 2026-05-22
**Triggered by:** FE follow-up asking how the membership / role / permissions contract works in the presence of custom roles. Five decisions resolved here before responding to FE. One more (billing-write reservation) requires BE code change before the FE reply can go out.

This is an Architecture Decision Record. Don't change anything in this file without re-opening the discussion with the FE team.

---

## TL;DR — what the contract guarantees

The session/membership response carries three fields that matter:

| Field | Purpose | Stability |
|---|---|---|
| `tenantRole` | Legacy narrow enum: `tenant_admin \| sub_admin \| staff`. Custom roles collapse to `staff`. | Kept forever for back-compat. Never extend. |
| `roleName` | Canonical role name. Identifier AND user-facing display label. BE-owned for built-ins; verbatim for custom roles. | Stable; built-in names will not change without coordinated FE+BE migration. |
| `permissions` | `string[]` of permission codes (`<resource>:<action>`). Source of truth for capability gating. | Add codes additively; never silently retire one. |

**FE rules of thumb:**
- Display: always render `roleName`.
- Gate UI: always use `permissions.includes('<code>')`. Never compare `roleName` or `tenantRole` literals.
- Owner detection: `roleName === "Owner"` is the canonical Owner check. Exactly one Owner per tenant, by design. See Decision 4.

---

## Decision 1 — `tenantRole` legacy enum: keep forever as back-compat

**Question:** Should the narrow legacy enum (`tenant_admin | sub_admin | staff`) on `session.activeTenantRole` and `membership.tenantRole` be kept indefinitely, deprecated, or removed?

**Decision: (a) Keep forever as back-compat.**

The enum stays narrow forever. Custom roles continue to collapse to `staff` in this field. The mapping rule (`legacyTenantRoleFromName` in `src/modules/auth/auth.service.ts`):

```ts
function legacyTenantRoleFromName(roleName: string): TenantRole {
  if (roleName === 'Owner') return TenantRole.tenant_admin;
  if (roleName === 'Admin') return TenantRole.sub_admin;
  return TenantRole.staff;
}
```

**Rationale:** The enum is also a JWT claim (see `JwtPayload.tenantRole` in `src/types/index.ts`). Removing it later means rolling JWT claims, which is a bigger blast radius than the FE cleanup needs. Keeping it costs us nothing and lets the FE migrate at their own pace.

**Implication for new BE code:** Don't write new code that branches on `tenantRole`. Use `roleName` (identity) or `permissions` (capability).

---

## Decision 2 — `roleName` doubles as identifier and display label (no separate `displayName`)

**Question:** Should `roleName` be both the internal identifier and the user-facing label, or should we add a separate `displayName` field?

**Decision: (a) Keep `roleName` as both. No separate `displayName` field — for now.**

- Built-in role names ARE what users see.
- Custom role names are what the Owner typed at create time — also what users see.
- BE owns the display label; FE renders verbatim, no translation, no fallback table.

**Rationale:** Don't add a field until we know we'll use it. We can introduce `displayName` later additively (i.e. an additional field on the response, FE migrates by preferring it when present and falling back to `roleName`) without a breaking change.

**Re-open this if:** i18n requirement lands, or we want admins to rename built-in labels without changing the underlying identifier.

---

## Decision 3 — Built-in role wording: FINALISED

**Question:** Are the current built-in names (`Owner, Admin, Care Worker, Read-Only`) the right user-facing wording for the UK children's residential care domain?

**Decision (2026-05-22): rename two of the four.**

| Current | New | Why |
|---|---|---|
| Owner | **Owner** (unchanged) | SaaS-standard for top-tier account holder. Universal across platforms. "Responsible Individual" is statutory but per-home not per-tenant, so it doesn't fit the SaaS-tier model. |
| Admin | **Admin** (unchanged) | SaaS-standard. "Registered Manager" is the Ofsted-statutory per-home role; using it for the org-wide deputy would mislead. |
| Care Worker | **Residential Care Worker** | Matches GOV.UK Regulated Professions Register + Skills for Care canonical terminology. "Care Worker" alone is too generic (adult social care, domiciliary care, etc.); "Residential" locks it to the actual domain. |
| Read-Only | **Viewer** | Honest SaaS access-tier term. "Auditor"/"Inspector" are reserved for actual Ofsted; using them would mislead. "Viewer" is universally understood (GitHub, Slack, Notion all use it). |

**Sources reviewed:** GOV.UK Regulated Professions Register, Skills for Care role taxonomy, Children's Homes Regulations 2015.

**Implementation status: NOT YET SHIPPED — separate PR required.** Renaming touches multiple files plus existing seeded `Role.name` rows in the DB. Bundling with the Decision 5 PR was rejected to keep blast radius small.

Names live in `src/auth/permissions.ts:93`:
```ts
export const SYSTEM_ROLE_NAMES = ['Owner', 'Admin', 'Care Worker', 'Read-Only'] as const;
```

These strings appear in:
- `src/auth/permissions.ts` — `SYSTEM_ROLE_NAMES` constant + `SYSTEM_ROLE_PERMISSIONS` keys
- `src/auth/system-roles.ts` — seed routine
- `src/modules/auth/auth.service.ts` — `legacyTenantRoleFromName` (case-sensitive string compare on `"Owner"` and `"Admin"`)
- `src/modules/auth/invitations.service.ts` — `"CANNOT_INVITE_OWNER"` check (`role.name === 'Owner'`)
- `prisma/seed.ts` — demo data
- Tests under `tests/` — any string compare against these names

**Specific candidates to research:**

- **"Care Worker"** — domain-correct alternatives: "Residential Worker", "Residential Care Worker", "Children's Home Worker", "Carer", "Support Worker". Need to consult UK Ofsted regulator terminology and Children's Homes Regulations 2015.
- **"Read-Only"** — domain-correct alternatives: "Auditor", "Inspector", "Viewer", "Observer", "Read-Only Viewer". The role is intended for regulators/external auditors AND read-only stakeholders (e.g. local authority placement officers, IROs). "Auditor" may be too narrow; "Viewer" too generic; "Read-Only" is technically clear but cold.
- **"Admin"** — alternatives: "Manager", "Home Manager", "Registered Manager", "Tenant Admin". UK regulator-recognised role for a children's home is "Registered Manager" (the OFSTED-registered person in charge). But "Admin" here is broader than a single home's Registered Manager — it's the org-wide deputy to Owner. Probably stays "Admin" but worth checking.
- **"Owner"** — likely fine. The org founder / Responsible Individual. Some platforms use "Account Owner" for clarity.

**Pending action:** Julius to research UK domain terminology (Ofsted regs, sector job titles) before naming is finalised. Once names are picked, a coordinated rename PR touches all the locations listed above.

**Until research is complete:** keep the current four names in code. Do NOT tell the FE that the names are final.

---

## Decision 4 — Exactly one Owner per tenant, forever

**Question:** Is "one Owner per tenant" a permanent guarantee, or transitional?

**Decision: (a) Commit to one-Owner-per-tenant forever.**

Phrased back from Julius's note: "No.1 Owner per tenant; every other powerful member falls to Admin and trickles down."

**What the BE guarantees:**
- Registration (`POST /auth/register`) creates exactly one Owner — the registrant.
- No "promote to Owner" endpoint exists, and none will be added.
- Invitations refuse the Owner role (`403 CANNOT_INVITE_OWNER` — see `src/modules/auth/invitations.service.ts:89`).
- The Owner system role has `isAssignable: false` so it never appears in role-picker UIs.

**What the FE can rely on:**
- `roleName === "Owner"` matches exactly one user per tenant.
- `isOwner` is derived from that — no separate boolean field, none planned.

**Implication for support-engineer impersonation:** the impersonation grant signs the JWT as the Owner (see `signImpersonationJwt` in `src/modules/admin/impersonation.service.ts`). The impersonator field tracks the real actor in audit logs.

**This decision MAY need revisiting if:**
- We ship a "transfer ownership" feature (one-way handoff with the previous Owner falling back to Admin) — that still preserves single-Owner-at-a-time and is safe.
- We ship "co-owners" (multiple users with Owner role at the same time) — that breaks single-Owner and requires a coordinated FE migration. We are NOT planning this.

---

## Decision 5 — `billing:write` is structurally reserved for Owner

**Question:** Should `billing:write` be assignable to custom roles via the self-service role builder?

**Decision: NO. `billing:write` is Owner-only.**

Phrased back from Julius's note: "Billing writes must be to the Owner alone (i.e. if billing is payment and anything that relates to final decisions on finances). We might allow tenants to add someone else but it must be through support."

**What this means:**
- The self-service role builder (`POST /roles`, `PATCH /roles/:id`) must REJECT any request that includes `BILLING_WRITE` in the permissions array.
- Only the Owner system role carries `BILLING_WRITE` (already true today — see `SYSTEM_ROLE_PERMISSIONS.Owner` in `src/auth/permissions.ts`; Admin gets all-except-`BILLING_WRITE`).
- If a tenant wants someone other than the Owner to be able to manage billing, that must be done via support (manual escalation — no self-service path).

**FE consequence:** `permissions.includes("billing:write")` IS a valid Owner-equivalent check once this is enforced. Until then, FE must use `roleName === "Owner"` as the only Owner check.

### BE implementation status: SHIPPED

PR opened against `main` on 2026-05-22 (see PR description for exact number). All four implementation tasks resolved:

1. **`billing:write` rejected on custom-role create/update.** In `src/modules/roles/roles.service.ts`, new `assertBillingWriteReservation(roleName, permissions)` helper called from both `createRole` and `updateRole`. Returns `403 PERMISSION_RESERVED`. Enforces both directions of the rule:
   - Non-Owner role with `billing:write` in permissions → reject.
   - Owner role being updated without `billing:write` in the new permissions → reject (defends against stripping).
   - Combined invariant: `billing:write ∈ permissions  IFF  roleName === "Owner"`.

2. **Audit query for existing data:** included in the PR body. Expected count: zero. SQL:
   ```sql
   SELECT id, "tenantId", name, permissions
   FROM "Role"
   WHERE NOT "isSystemRole" AND 'billing:write' = ANY(permissions);
   ```
   Run before merge or immediately after to confirm no live tenant has a custom role with billing:write.

3. **Permission catalog docstring updated** in `src/auth/permissions.ts` — `BILLING_WRITE` now carries an inline comment explaining the reservation and pointing at the enforcement.

4. **Tests** in `tests/roles.billing-reservation.service.test.ts` — 7 cases covering: create with billing:write rejected, create without billing:write allowed, update adding billing:write to non-Owner rejected, update stripping billing:write from Owner rejected, update preserving billing:write on Owner allowed, update of non-Owner without billing:write allowed, update without touching permissions allowed (no false positive when only renaming/toggling isActive).

**Status:** `permissions.includes("billing:write")` is NOW a valid Owner-equivalent check from the FE. The FE reply (when sent) can use it.

---

## Decision 6 — FE permission mapping for specific UI gates: hand them the catalog, let them pick

**Question:** Should the BE tell the FE which specific permission code gates each UI surface (e.g. sidebar nav filtering, invite management)?

**Decision: (a) Send the FE the full permission catalog and let them choose.**

It's not the BE's place to dictate which UI surface maps to which permission — the FE owns that mapping, and the BE only owns whether the permission exists and what it semantically means.

**FE-facing reference:** `src/auth/permissions.ts` is the canonical catalog. 37 codes today, all `<resource>:<action>` shape. Each entry has a one-line description comment.

**For the FE reply:** point them at the file. Don't recommend specific permissions for specific FE files.

---

## Outstanding work before the FE reply can go out

1. ~~Decision 3 (Julius): research and finalise UK domain-correct names.~~ **DONE 2026-05-22** — names finalised above. Rename PR is a separate, follow-up workstream (FE-coordinated since labels are user-facing).
2. ~~Decision 5 (BE): ship the `billing:write` reservation.~~ **DONE 2026-05-22** — PR opened against `main`. Until merged, FE reply still uses `roleName === "Owner"` as the Owner check; after merge, `permissions.includes("billing:write")` becomes a valid alternative.

**Remaining gating item:** Decision 5 PR being **merged** (not just opened). Once it's on `main`, the FE reply can confidently advertise `billing:write` as an Owner-equivalent check. Until then, the FE reply uses `roleName === "Owner"` only.

**Separate follow-up workstream:** the Decision 3 rename PR (touches `SYSTEM_ROLE_NAMES`, `prisma/seed.ts` demo data, a Prisma data migration to update existing seeded `Role.name` rows, and FE labels that reference the old names). Schedule when FE has bandwidth for the coordinated swap.

---

## Source-of-truth file references

For future me re-checking the contract holds:

| Contract surface | File |
|---|---|
| Permission catalog | `src/auth/permissions.ts` |
| System role seed | `src/auth/system-roles.ts` |
| Membership response shape | `AuthSessionMembership` in `src/modules/auth/auth.service.ts` |
| Session response shape | `AuthSessionContext` in `src/modules/auth/auth.service.ts` |
| Legacy enum mapping | `legacyTenantRoleFromName` in `src/modules/auth/auth.service.ts` |
| JWT claim shape | `TenantJwtPayload` in `src/types/index.ts` |
| Owner-not-assignable enforcement | `src/modules/auth/invitations.service.ts` (`CANNOT_INVITE_OWNER`) |
| Role create/update entry points (Decision 5 enforcement lives here) | `src/modules/roles/roles.service.ts` |
