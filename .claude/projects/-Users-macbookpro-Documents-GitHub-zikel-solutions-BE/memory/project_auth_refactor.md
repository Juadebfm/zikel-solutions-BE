---
name: Auth & Tenant Registration Refactor (March 2026)
description: Registration refactored from 2-step (account then org) to care-home-first model with 3 staff onboarding methods
type: project
---

Registration was refactored on 2026-03-19 from a generic SaaS 2-step model to a care-home-specific model:

**Flow 1: Care Home Registration** — `POST /auth/register` now creates user + tenant + membership (as tenant_admin) atomically. Requires `organizationName` field. Self-serve endpoint (`POST /tenants/self-serve`) was removed.

**Flow 2: Staff Onboarding (3 methods):**
- **Method A:** Admin provisions staff directly via `POST /tenants/:id/staff` — creates pre-provisioned account, sends activation OTP (7-day expiry, `staff_activation` purpose). Staff activates via `POST /auth/staff-activate`.
- **Method B:** Org invite link — admin generates via `POST /tenants/:id/invite-link`, staff self-registers via `POST /auth/join/:inviteCode` with `pending_approval` membership. Admin must approve.
- **Method C:** CSV bulk upload — planned for later, not yet implemented.

**Why:** Zikel is a care home management platform. The generic SaaS model had too many steps for care homes. Industry standard is admin-provisioned accounts with email activation.

**How to apply:** When working on auth/onboarding features, reference GUARDRAILS.md for the regression checklist. The `pending_approval` MembershipStatus was added for invite-link joins. The `TenantInviteLink` model stores reusable org invite codes.
