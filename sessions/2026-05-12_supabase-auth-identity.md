---
agent: supabase-auth-identity
branch: feat/supabase-auth-identity
worktree: ../vtorn-supabase
status: in-progress
docs:
  - docs/13-telegram-bot-and-auth.md
  - docs/20-identity-humanness-bots.md
  - docs/32-auth-and-privacy.md
  - docs/52-supabase-setup.md
---

# 2026-05-12 — Supabase Auth + identity + friend discovery v1

## Why this exists

Tim's call (2026-05-11): the user-identity layer moves to **Supabase Auth + Supabase
Postgres**. The hand-rolled `apps/auth-sms` SQLite-based OTP path (doc 32) and the
in-progress sister-agent `feat/user-registration-and-profiles` custom-auth path
become legacy / get replaced.

Game-service picks + leaderboards stay on SQLite (per doc 12) — only **identity**
moves. The two databases are loosely coupled via a single canonical `user_id`
(Supabase UUID, present in the JWT's `sub` claim).

Friend discovery v1 ships with three paths:

1. **Telegram contacts** — the bot queries shared-group membership after sign-in
   and matches `telegram_id` against `user_profiles`.
2. **WhatsApp invite links** — every bracket share card carries
   `play.tournamental.com/i/<code>`; the claim flow attributes a friendship.
3. **Phone-number hash matching** — `whatsapp_phone_hash` (SHA-256 with a server
   salt) is exchanged client→server for opted-in users only.

Explicitly **not** in scope: email contact discovery, Facebook friend graph
(`user_friends` was removed from FB OAuth v2 in 2014), Google/Apple/X providers
(week 2/3 follow-up PR).

## Plan

1. Supabase migration `supabase/migrations/0001_user_identity.sql`:
   - `user_profiles`, `user_profile_history`, `friendships`, `invite_codes`
   - RLS policies for each
   - extra `phone_match_consent` column on `user_profiles` (called out in the spec
     and worth keeping explicit rather than overloading `marketing_consent`)
2. Web client wiring (`apps/web`):
   - `@supabase/supabase-js` + `@supabase/ssr` deps
   - `lib/auth/supabase.ts` — browser + server clients
   - `lib/auth/useUser.ts` — React hook subscribing to auth state changes
   - `lib/auth/signIn.ts` — three sign-in helpers
   - `lib/auth/phone-hash.ts` — deterministic SHA-256 hashing for contact match
   - `lib/auth/guest.ts` — fallback when env vars are missing
3. UI:
   - `components/auth/SignupModal.tsx` — three-tab modal (Email / Telegram / WhatsApp)
   - `app/profile/page.tsx` — replace placeholder with editable profile
   - `app/i/[code]/page.tsx` — invite-code claim route
4. Game service:
   - JWT validation via Supabase JWKS in `apps/game/src/routes/auth.ts`
   - Keep `X-User-Id` fallback behind `GAME_DEV_AUTH=1`
5. Friend discovery:
   - `apps/web/app/api/friends/discover/phone-match/route.ts`
   - `apps/web/app/api/friends/discover/telegram/route.ts` (server-side; the bot
     calls this once the user signs in)
6. Docs:
   - `docs/52-supabase-setup.md` — full dashboard walkthrough for Tim
   - Patch `docs/32-auth-and-privacy.md` to flag the SMS path as legacy
   - Patch `docs/26-setup-checklist.md` Phase 1 — swap to Supabase row + point at 52
7. Tests:
   - SignupModal happy-path for each of the three tabs
   - useUser hook subscription
   - phone-match hash determinism
   - invite-code claim flow
   - profile-page render
   - RLS smoke test

## Supersession of the sister agent

The sister agent on `feat/user-registration-and-profiles` is building custom-auth
SQLite registration. Tim will close their PR without merging. Salvage their UI
component shapes if useful, but do not import their auth backend.

## Dashboard-clicks preview (for doc 52)

1. Supabase → New Project (region: Sydney AU; password to vault)
2. Database → Migrations → paste `0001_user_identity.sql`
3. Authentication → Providers → enable Email (default SMTP for v1)
4. Authentication → Phone → custom SMS provider hook pointing at
   `https://play.tournamental.com/api/auth/sms-hook` (HMAC-signed by Supabase)
5. Authentication → Settings → URL Configuration: site URL `https://play.tournamental.com`
6. Project Settings → API: copy URL, anon key, service-role key → paste into env
7. SQL Editor → run any seed (none required for v1)
8. Smoke test: sign up with email, click magic link, verify `user_profiles` row

## Deferred to follow-up PR

- Google OAuth provider
- Apple Sign-in
- X (Twitter) OAuth
- Telegram Login Widget native widget integration (this PR ships the OIDC
  contract + redirect endpoint; Tim wires the widget in the dashboard)
- WhatsApp click-to-OTP via Aiva SMS hook (this PR ships the SMS-hook endpoint;
  Tim configures the dashboard to point at it)

## Quality gates

- `pnpm --filter @vtorn/web typecheck` clean
- `pnpm --filter @vtorn/web test` baseline + 6 new tests
- `pnpm --filter @vtorn/web build` clean
- Graceful guest-mode fallback when `NEXT_PUBLIC_SUPABASE_URL` is unset

## Next steps

- Land the migration + web wiring + docs
- Push, open PR; Tim reviews + executes the dashboard walkthrough
- Follow-up PR after dashboard live: turn on Telegram + WhatsApp providers,
  attach session JWT to game-service requests, retire `apps/auth-sms`
