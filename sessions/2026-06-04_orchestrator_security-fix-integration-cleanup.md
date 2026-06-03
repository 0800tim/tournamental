---
agent: orchestrator
task: cross-service integration cleanup after parallel security-fix wave
status: complete
date: 2026-06-04
---

# Security-fix integration cleanup

Five small surgical patches to close the integration gaps left by the
parallel security-fix wave (commits 60d6e3f → b83e457). Each fix-agent
ran in isolation; this session ties their edges together.

## What changed

### 1. ProfilePage email field gated readOnly (Task 1)

`apps/web/components/auth/ProfilePage.tsx` — the email input is now
`readOnly` with a tooltip explaining "email changes coming soon", and
`diffDraft()` no longer emits `email` in the PATCH body. Background:
after commit `4873d03` the auth-sms PATCH `/v1/auth/me` silently strips
the `email` field (SEC-AUTH-09) and sets `X-Email-Verification-Required: 1`.
The existing `/v1/auth/email/request` + `/v1/auth/email/verify` flow
mints a *new* session for the verified address via
`findOrCreateEmailUser`, so wiring it into the profile editor as-is
would jump the user to a different user_id mid-edit. A proper
verify-and-merge endpoint is needed first; tracked in IDEAS.md.

### 2. verifyManageToken dual-secret (Task 2)

`apps/web/app/api/v1/syndicates/[slug]/manage-owner/route.ts` and the
three `invites/*` siblings now try `ADMIN_MANAGE_JWT_SECRET` first,
then fall back to `AUTH_JWT_SECRET`. Both must still validate
`issuer: "tournamental-manage", audience: "tournamental"` (already
enforced by commit `f5cf506` / SEC-WEB-02). Admin-impersonate tokens
issued by `apps/admin/.../impersonate/route.ts` (which signs with the
admin secret) are now recognised by the web routes without flipping
the manage-token signing identity for the user-issued OTP path. Added
`ADMIN_MANAGE_JWT_SECRET=CHANGE_ME` placeholder to
`apps/web/.env.example`.

### 3. Telegram widget `phone_number` (Task 3)

No client-side change required. Verified by grep across
`apps/web/components/auth/` and `apps/web/app/`: the only
`phone_number` reference is the CSV header alias in
`lib/invite/parse-csv.ts` (contact import, unrelated). The Telegram
Login Widget payload type (`TelegramLogin.tsx`, `signIn.ts`,
`api/auth/telegram-callback/route.ts`) doesn't include the field — the
widget's iframe owns the payload shape. Server-side, auth-sms accepts
+ silently drops the field per SEC-AUTH-07. Nothing to do.

### 4. vtorn-dev env additions (Task 4)

Added three new env vars to
`/home/clawdbot/clawdia/projects/vtorn-dev/apps/web/.env.local`:

- `APPROVAL_TOKEN_SECRET` (32-byte hex) — was missing; web pool
  approve/deny email-link flow had no signing key.
- `LEADERBOARD_HANDLE_SECRET` (32-byte hex) — was missing; read by
  apps/game leaderboard route.
- `ADMIN_MANAGE_JWT_SECRET` (32-byte hex) — was missing; now used by
  the dual-secret verify in Task 2.

Existing `AUTH_OTP_SECRET` (in auth-sms) + `AUTH_JWT_SECRET` (matched
across web/game/admin/auth-sms) confirmed 64 chars hex with no
CHANGE_ME placeholders.

**Important caveat:** the dev host only has one true `-dev` pm2
entry: `vtorn-web-dev`. `vtorn-auth-sms`, `vtorn-game-prod`, and
`vtorn-admin-prod` are shared dev+prod processes — the task spec said
"DO NOT touch any prod env files", so the new secrets were only
added to the dev web worktree. Service-level env (auth-sms, game,
admin) was left untouched. If those services need the new vars at
runtime, the prod env files (untouched here) and a controlled
production rollout are the right place.

### 5. Smoke verification (Task 5)

After `pm2 restart vtorn-web-dev`:

- `https://play-dev.tournamental.com/` → 200
- `https://play-dev.tournamental.com/profile` → 200
- `https://play-dev.tournamental.com/api/v1/profile/syndicates` → 401
  (expected — no session cookie on curl)
- `https://play-dev.tournamental.com/api/v1/syndicates/foo/manage-auth` → 403
  (expected — CSRF guard)
- `https://auth.tournamental.com/` → 200
- `https://auth.tournamental.com/v1/auth/me` → 401 (expected — no
  session cookie on curl)
- `https://game.tournamental.com/` → 200

No boot errors in pm2 logs.

## Commits

- `fix(web): gate Profile email field readOnly until verify-and-merge ships`
- `fix(web): verifyManageToken accepts admin-impersonate JWTs as well as user-OTP tokens`

## Why no Task-3 commit

Task 3 had no diff. The audit confirmed neither side of the Telegram
widget pipeline (client `TelegramLogin.tsx` / `signIn.ts` /
`api/auth/telegram-callback/route.ts`) ever sent `phone_number` from
our code. The widget owns its iframe payload; auth-sms already drops
the field on the server. Nothing to commit.

## Follow-ups parked in IDEAS.md

- Email change verify-and-merge endpoint (re-enables Profile email
  edits).
