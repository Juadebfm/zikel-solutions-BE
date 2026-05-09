# Smoke tests — the 5 things that matter

If all 5 pass, you're shippable. Most are browser actions; only #3 needs the terminal.

---

## Setup (one-time, 60 seconds)

1. Server is running on `http://localhost:3000` ✓ (you already have this)
2. Create a platform admin so you can test the `/admin/*` side:
   ```bash
   npx tsx prisma/seed-platform-admin.ts
   ```
   You should see: `email: admin@zikelsolutions.com` / `password: PlatformAdmin123!`
3. Register a tenant Owner — use your frontend's signup page, OR run:
   ```bash
   curl -X POST http://localhost:3000/api/v1/auth/register \
     -H 'content-type: application/json' \
     -d '{
       "country": "UK",
       "firstName": "Owner",
       "lastName": "Test",
       "email": "owner@smoketest.local",
       "password": "TestPass123!#",
       "confirmPassword": "TestPass123!#",
       "acceptTerms": true,
       "organizationName": "Smoke Test Care"
     }'
   ```
   Then verify the email — check your server terminal for the 6-digit OTP, then:
   ```bash
   curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
     -H 'content-type: application/json' \
     -d '{"email":"owner@smoketest.local","code":"<paste-6-digit-otp>"}'
   ```

You now have two accounts: tenant Owner + platform admin. On to the tests.

---

## Test 1 — Login & logout work for both audiences

**What you do:**
- Open your frontend, login as the tenant Owner. Click around. Logout. Log back in.
- Open your platform admin frontend (or hit `/admin/auth/login` via Postman) with `admin@zikelsolutions.com` / `PlatformAdmin123!`.

**Pass:** Both logins succeed. Both logouts return you to a logged-out state. Re-login works.

**Fail:** Any 500 error, infinite spinner, or unexpected 403.

---

## Test 2 — Cross-audience JWTs are rejected

The important one for Phase 1: a tenant token must NOT work on `/admin/*`, and vice versa.

**What you do:** Logged in as the tenant Owner, find your access token (browser DevTools → Network tab → any request → look at the `Authorization: Bearer ...` header, copy the token after `Bearer `). Then in your terminal:

```bash
TOKEN="<paste-tenant-token-here>"
curl -i http://localhost:3000/admin/auth/me \
  -H "authorization: Bearer $TOKEN"
```

**Pass:** First line says `HTTP/1.1 403`, body contains `"code":"TENANT_TOKEN_REJECTED"`.

**Fail:** Anything other than 403 + that exact code.

---

## Test 3 — Refresh-token theft tripwire (terminal only)

This is the security-critical one. If someone steals a refresh token and replays it after the legitimate user already rotated it, the entire session must die.

**What you do:** Paste this whole block into your terminal:

```bash
# Login
LOGIN=$(curl -sX POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"owner@smoketest.local","password":"TestPass123!#"}')
OLD=$(echo "$LOGIN" | jq -r '.data.tokens.refreshToken')

# Use it once (rotates the refresh token)
echo "--- First refresh (should succeed):"
curl -sX POST http://localhost:3000/api/v1/auth/refresh \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$OLD\"}" | jq '.success'

# Replay the OLD token — should trip the alarm
echo "--- Replay old token (should FAIL with REFRESH_TOKEN_REUSED):"
curl -sX POST http://localhost:3000/api/v1/auth/refresh \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$OLD\"}" | jq '.error.code'
```

**Pass:** First refresh prints `true`. Second prints `"REFRESH_TOKEN_REUSED"`.

**Fail:** Second refresh prints `true` (means the tripwire isn't working — that's a real bug).

---

## Test 4 — TOTP MFA flow (browser)

**What you do:** Logged in as the tenant Owner, go to your account/security settings. Enroll TOTP:
1. Click "Set up MFA". A QR code appears.
2. Scan it with Google Authenticator (or 1Password / Authy).
3. Enter the current 6-digit code from the app to confirm.
4. Logout. Log back in.
5. After password, you should see a "Enter 6-digit code" screen.
6. Enter the current code from your authenticator → you're in.

**Pass:** Step 5 shows the MFA prompt (not the dashboard). Step 6 succeeds.

**Fail:** Step 5 goes straight to the dashboard (means MFA gate isn't firing), or step 6 rejects valid codes.

> If your FE doesn't have MFA UI yet, paste this in your terminal once logged in (replace `$TENANT_TOKEN` with your tenant access token):
> ```bash
> curl -sX POST http://localhost:3000/api/v1/auth/mfa/totp/setup \
>   -H "authorization: Bearer $TENANT_TOKEN" | jq -r '.data.qrCodeDataUri' \
>   | sed 's/^data:image\/png;base64,//' | base64 -d > /tmp/mfa.png && open /tmp/mfa.png
> ```
> Then scan the QR. To confirm, send the code:
> ```bash
> curl -sX POST http://localhost:3000/api/v1/auth/mfa/totp/verify-setup \
>   -H "authorization: Bearer $TENANT_TOKEN" \
>   -H 'content-type: application/json' \
>   -d '{"code":"<6-digit-from-app>"}'
> ```

---

## Test 5 — Permission deny works

**What you do:** This needs a second user. Two ways:

**Option A — via your frontend:**
1. As Owner, go to "Roles", create a new role called "Reports Reader" with permissions: `reports:read`, `homes:read`, `young_people:read` (no employees:write).
2. Invite a new user (`reader@smoketest.local`) with that role.
3. Accept the invite, login as them.
4. Navigate to "Employees" — try to create one.

**Option B — via terminal (if FE doesn't have role-builder UI yet):** ping me back, I'll give you the exact 4 curl commands.

**Pass:** The reader sees the homes/young-people lists fine, but cannot create an employee — the FE either hides the button or surfaces a 403 `PERMISSION_DENIED` error.

**Fail:** They can create an employee.

---

## When you're done

Reply with which tests passed and which (if any) failed. Anything that fails is a real code bug I'll fix; anything that passes flips the corresponding `- [ ]` in `changes.md` to `- [x]`.

**Skipping Phase 5 (impersonation) is fine for first launch** — only test it if your support team will use it Day 1.
