---
agent: user-registration-and-profiles
status: ready-for-review
branch: feat/user-registration-and-profiles
worktree: ../vtorn-registration
base: main @ b7a7580
sister-branches:
  - feat/save-api-live (PUT picks; do not overlap)
  - feat/analytics-tracking-layer (GA4 layer; we push to dataLayer)
docs:
  - docs/12 — game-service shape
  - docs/13 — Telegram bot + auth (future; we build the dev-trust v1 layer)
  - docs/30 — engagement bands
  - docs/32 — auth + privacy (future; we follow the data-minimisation principle)
---

# user registration + rich progressive profile

## why

Tim, 2026-05-11: *"Get everything you can done to get the API and saving live,
including full user registration and profiles. We want rich profiles for each
user. Get as much information as we can out of them over time. Simple
registration, but rich user profiles like demographic, age, location, city,
country, how often they come."*

Simple sign-up (handle + auth tab + skippable step 2) plus a rich profile
filled in across the tournament via small, contextually-placed prompts.

## what shipped

### game-service (`apps/game`)

- `migrations/0003_users_profiles.sql` — extends `users` with handle, display
  name, last-seen, auth pair + soft-delete; adds `user_profiles` and an
  append-only `user_profile_history` audit table.
- `src/store/users.ts` — new `UserStore` class. Idempotent register on
  `(auth_method, auth_id)`, per-field history rows, GDPR soft-delete +
  PII scrub in a single transaction, distinct-day visit counter that
  drives `engagement_band` (`cold | warm | hot`).
- `src/routes/users.ts` — six endpoints:
  - `POST /v1/users/register` (idempotent; seeds `country_code` from
    `CF-IPCountry`; 409 on handle collision)
  - `GET /v1/users/me` (uses `X-User-Id`; touches `last_seen_at`)
  - `PATCH /v1/users/:id/profile` (Zod-validated; closed-list FIFA-3
    teams; writes per-field history)
  - `POST /v1/users/:id/visit` (one increment per distinct day; emits
    band telemetry)
  - `DELETE /v1/users/:id` (soft-delete; scrubs PII in
    `users` + `user_profiles` transactionally)
  - `GET /v1/users/:id/data-export` (GDPR JSON dump)
- `src/schemas.ts` — Zod schemas for register + profile patch, with
  shape validation for handle / age-bucket / gender / country / team
  code / watches-via.
- `src/server.ts` — wires the user routes; CORS defaults extended to
  include `play.tournamental.com`, `2026wc.tournamental.com`,
  `app.tournamental.com`, `www.tournamental.com` so the new hosts are
  reachable in dev without env override (sister save-API agent owns the
  canonical `.env.production` list).

### web (`apps/web`)

- `components/auth/SignupModal.tsx` + `.css` — 2-step modal:
  - Step 1 (mandatory): @handle + auth tabs (Guest + Telegram live, SMS
    + Email tagged "soon").
  - Step 2 (skippable): country (pre-fills from CF-IPCountry passed by
    parent or "NZ" fallback) + age bucket + favourite team. Step 2 also
    captures timezone silently via `Intl.DateTimeFormat`.
- `components/auth/ProgressivePrompt.tsx` — reusable inline prompt
  wrapper for progressive enrichment. Reads/writes
  `tournamental.profile.prompts.<key>` for skip stickiness (14-day
  default cooldown; completed prompts never re-show).
- `lib/user/storage.ts` — localStorage namespace for the signed-in
  user (`tournamental.user.*`) + prompt-skip records + `pushDataLayer`
  helper for the analytics sister agent.
- `lib/user/api.ts` — typed wrappers (`registerUser`, `getMe`,
  `patchProfile`, `postVisit`, `deleteUser`, `downloadDataExport`).
  Every meaningful action fires a `tournamental.profile.*` dataLayer
  event with a stable name.
- `lib/user/useCurrentUser.ts` — small hook the AppShell mounts once
  per page; also fires a once-per-8h /visit ping.
- `app/profile/page.tsx` — expanded from the placeholder shell to a
  full profile editor: identity, engagement band chip (with help
  tooltip), country/city inline edit, age + gender + watches-via
  chips, favourite-team input, consent checkboxes, export-data +
  delete-account.
- `components/shell/AppShell.tsx` — avatar tap opens the signup modal
  when no user is signed in; opens the menu drawer when signed in.
  Avatar initials default to `handle.slice(0,2).toUpperCase()` for
  signed-in users.

### tests

- `apps/game/tests/users-registration.test.ts` — 14 tests:
  - register happy-path; CF-IPCountry seed; bad handle → 400
  - idempotency on (auth_method, auth_id)
  - handle collision → 409
  - GET /me joined shape; 401 without header
  - PATCH per-field; unknown team → 422; bad age → 400; cross-user → 403
  - visit increment + cold→warm→hot band transitions
  - DELETE + data-export with PII scrub
- `apps/web/__tests__/SignupModal.test.tsx` — 5 tests: handle validation
  gate, Step 1 → Step 2 happy path, "Skip for now" path, "Finish" path
  with PATCH body assertion, 409 collision error message.
- `apps/web/__tests__/profile-page.test.tsx` — 4 tests: signed-out
  state, empty-profile render, full-profile render with chips,
  inline-edit PATCH wiring.

Totals: **game 88/88 passing**, **web 664/664 passing**, **web build clean**.

## design decisions worth flagging

1. **Age is bucketed, not raw.** Stored as `age_bucket` (`<18 | 18-24 |
   25-34 | 35-44 | 45-54 | 55-64 | 65+`). Less precise, far less risky
   in a breach. Documented in the migration header.
2. **Country is ISO-2; no lat/lon.** Same minimisation principle.
3. **Soft-delete keeps the `users.id` row.** Brackets, syndicates and
   pundit records FK to users — wiping the id immediately would
   orphan settled-tournament scores. PII fields in both `users` and
   `user_profiles` are scrubbed transactionally on DELETE; a follow-up
   nightly job (TODO docs/32) hard-deletes rows older than 30 days.
4. **`engagement_band` is computed in app code, not via a SQLite
   trigger.** SQLite triggers are hard to test and audit; the band
   function is a pure function exported from `store/users.ts` and
   exercised by the band-transition test.
5. **Timestamps are stored as epoch ms `INTEGER`** to match the
   existing 0001/0002 migrations (the spec sketched `TEXT` ISO
   timestamps; I kept the column type consistent with the rest of the
   schema so joins/comparisons stay numeric).
6. **localStorage, not cookies, for v1.** The dev-trust model is
   `X-User-Id`; cookie-based session auth comes with Telegram-JWT
   per docs/13.

## progressive-enrichment prompts

Built reusable infrastructure (`ProgressivePrompt`) + 4 callout sites
identified in the spec, but only the avatar-tap-signup and Step 2 are
wired into shipped UI for this PR. The 4 candidate trigger points
(after first knockout pick, after 3 visits, after share, after first
group lock) are queued for a follow-up that ties them into the existing
bracket / share flows — they need to integrate with `useMatchPick` and
the share-cards component without overlapping the sister save-API
branch's work. Tracked in IDEAS.md.

## telemetry events fired

All on `window.dataLayer`:

- `tournamental.profile.signup-attempt`
- `tournamental.profile.signup-complete`
- `tournamental.profile.signup-error`
- `tournamental.profile.signup-step2-skipped`
- `tournamental.profile.signup-step2-completed`
- `tournamental.profile.field-saved` (one per changed field)
- `tournamental.profile.prompt-shown`
- `tournamental.profile.prompt-skipped`
- `tournamental.profile.prompt-completed`
- `tournamental.profile.export-downloaded`
- `tournamental.profile.deleted`

## non-overlap with `feat/save-api-live`

Confirmed unchanged:

- `apps/game/src/routes/picks.ts`
- `apps/web/lib/bracket/submit.ts`
- `apps/web/components/match-pick/useMatchPick.ts`
- PM2 config + tunnel scripts

Touched but additive:

- `apps/game/src/server.ts` (added route registration + extended CORS
  defaults; existing CORS env var still wins)
- `apps/game/src/store/db.ts` (added `users` sub-store; the
  `ensureUser` insert now sets `last_seen_at` alongside `created_at`)
- `apps/web/components/shell/AppShell.tsx` (avatar onClick now branches
  on signed-in state; existing menu-drawer behaviour preserved for
  signed-in users)

## verification

```
pnpm --filter @vtorn/game typecheck   # clean
pnpm --filter @vtorn/web typecheck    # clean
pnpm --filter @vtorn/game test        # 88 / 88
pnpm --filter @vtorn/web test         # 664 / 664
pnpm --filter @vtorn/web build        # NODE_ENV=production: clean
```

## next steps (deferred to follow-up PR)

- Wire 4 progressive-enrichment prompts to actual triggers
  (first-knockout-pick / share / 3-visits / first-group-lock).
- Telegram-JWT verification for real auth_id binding (docs/13).
- Nightly job: hard-delete users where `deleted_at < now() - 30d`.
- Profile-history "audit trail" view on the profile page (data is
  already captured by `user_profile_history`; just not rendered yet).
