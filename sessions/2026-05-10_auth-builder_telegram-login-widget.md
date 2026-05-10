# 2026-05-10 — auth-builder — telegram-login-widget

**Status**: done — PR open

## Goal

Add the **Telegram Login Widget** as a second auth path next to the SMS-OTP
flow. End-state: a user can land on `/login` (marketing) or `/auth` (bracket
app), tap the Telegram button, and walk away with the same session JWT the
SMS-OTP path mints — without ever entering a phone number.

## Reading

- `apps/auth-sms/src/jwt.ts` — JWT shape we must match (HS256, sub/jti/phone).
- `apps/auth-sms/src/routes/verify-otp.ts` — pattern for issuing session +
  storage row.
- `apps/auth-sms/src/storage.ts` — user / session schema.
- `apps/identity/src/lib/providers/telegram.ts` — provider stub (already
  documents the verify-hash algorithm in comments).
- https://core.telegram.org/widgets/login-legacy — widget spec.

## Plan

1. New module `apps/auth-sms/src/telegram-login.ts`:
   - `verifyTelegramLogin(payload, botToken, now)` returning the cleaned
     payload or throwing.
   - `secret_key = SHA256(bot_token)`, then HMAC_SHA256 over the sorted
     `key=value` join (excluding `hash`). Constant-time compare.
   - Reject `auth_date` older than 24 h (864 00 s) or in the future > 60 s
     (clock skew tolerance).
2. Storage migration: make `user.phone` nullable, add `telegram_id` (UNIQUE),
   `telegram_username`, `display_name` already exists. Add
   `findOrCreateTelegramUser(...)` and `linkPhoneToUser(...)`.
3. New route `POST /v1/auth/telegram/callback` in `apps/auth-sms`:
   - Validate body with zod.
   - Verify hash + freshness.
   - Upsert user (link by `telegram_id`; if `phone_number` was shared, also
     link the phone).
   - Mint same session JWT as SMS-OTP. JWT `phone` claim is `""` for
     Telegram-only users (handled in verifySessionJwt by allowing empty).
4. Widget surfaces:
   - Marketing `/login.astro` — new page with the two paths side by side
     ("Phone or Telegram").
   - Bracket app `/auth/page.tsx` — add a Telegram button under the form
     that loads the widget via a small client component.
5. Tests in `apps/auth-sms/test/telegram-login.test.ts`:
   - Known-good signed payload roundtrip.
   - Expired (auth_date > 24 h old).
   - Tampered hash.
   - Wrong bot token.
   - Route happy path mints JWT, rejects bad hash with 401.

## Constraints

- Same user store + JWT issuer as SMS-OTP (no duplication).
- Bot username on the widget MUST match the bot whose token signs
  the JWT. We default to `VTournBot` and reuse `TELEGRAM_BOT_TOKEN`
  from `apps/tournament-bot`.
- Don't break the SMS-OTP flow.
- NZ English spelling.

## Decisions

- **JWT `phone` claim becomes optional.** SMS-OTP users still get their
  phone in the claim. Telegram-only users get `phone: ""`. The
  `verifySessionJwt` helper already coerces missing-phone to `""` but
  threw if empty — relaxed that check (still requires `sub` + `jti`).
- **`telegram_id` is its own column with a UNIQUE index.** A user row
  can have *either* a phone, a telegram_id, or both. The `user_phone`
  uniqueness constraint is preserved by allowing NULL phones (SQLite's
  `UNIQUE NOT NULL` becomes `UNIQUE` and SQLite treats multiple NULLs
  as distinct, which is what we want).
- **Phone link from Telegram** writes a row with phone set if the
  widget supplies `phone_number` (e.g. via Telegram's request-contact
  in a follow-up bot message). The widget itself does not return a
  phone today, so this is optional / forward-compat.

## Outcome

- `apps/auth-sms` ships `POST /v1/auth/telegram/callback`, the verifier
  module `src/telegram-login.ts`, and storage migration that makes
  `user.phone` nullable + adds `telegram_id` / `telegram_username`.
- 15 new tests in `test/telegram-login.test.ts`. Whole suite: 69 passed.
- Marketing `/login` page hosts the widget side-by-side with the
  phone-OTP path.
- Bracket app `/auth` page mounts the widget under a divider beneath
  the existing OTP form.

## Test plan

- `pnpm --filter @vtorn/auth-sms typecheck` — clean.
- `pnpm --filter @vtorn/auth-sms test` — 69 passing.
- `pnpm --filter @vtorn/web test` — 384 passing.
- Marketing `/login` builds (`apps/marketing` astro build).
- Smoke: server boots with `TELEGRAM_BOT_TOKEN` unset — endpoint
  returns 503 `not-configured`. With token set, signed payload is
  accepted and a JWT is minted.

## Pre-existing issues (not in scope)

`apps/web` `next build` fails on `/team/[code]` pages with a
`useContext` null error — reproduces against `origin/main` without
this branch's changes. Tests + dev server run fine.
