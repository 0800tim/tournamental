# Rebrand: VTourn -> Tournamental

- **Date:** 2026-05-12 (NZ time; UTC-ish on the box)
- **Branch:** `chore/rebrand-vtourn-to-tournamental`
- **Status:** complete; PR open
- **Refs:** orchestrator brief 2026-05-12

## Goal

Sweep every user-facing reference to "VTourn" / `vtourn.com`
(including all subdomains, social handles, brand-derived
identifiers like `VTournBot`, and asset folder names) over to
"Tournamental" / `tournamental.com` so Tim can start promoting
the new domain 30 days out from the WC 2026 kickoff (11 June 2026).

## Method (rough)

1. Created the worktree at
   `/home/clawdbot/clawdia/projects/vtorn-rebrand-tournamental` on
   `chore/rebrand-vtourn-to-tournamental` off `origin/main`.
2. Wrote a perl-based sweep at `/tmp/rebrand.sh` that:
   - Protects the `@vtorn/*` npm scope with a sentinel before the
     case-insensitive replacement passes.
   - Case-by-case replaces `VTOURN`, `VTourn`, `Vtourn`, `vtourn.com`,
     `@vtourn` (handle), `t.me/vtourn`, `x.com/vtourn`, lone
     `vtourn`, then restores the sentinel.
   - Excludes `sessions/` per the brief (historical content).
3. Second pass for compound brand identifiers
   (`VTournBot` -> `TournamentalBot`, `VTournOracle`, etc.)
4. Folder renames:
   - `apps/marketing/public/icons/vtorn/` -> `tournamental/`
   - `apps/native/android/app/src/main/java/com/vtourn/app/`
     -> `com/tournamental/app/` (fixed a latent bug — the
     `MainActivity.java` already declared
     `package com.tournamental.app` but lived under `com/vtourn/`,
     which would have failed the Gradle build)
5. File renames:
   - `VTourn Pitch.md` -> `Tournamental Pitch.md`
   - `docs/15-vtourn-brand-and-positioning.md` -> `15-tournamental-...`
   - `docs/36-vtourn-ux-spec.md` -> `36-tournamental-ux-spec.md`
   - `infra/scripts/cf-add-vtourn-hosts.sh` -> `cf-add-tournamental-hosts.sh`
   - same for the `-admin` variant
6. Rebased onto `origin/main` after the share-card branch merged
   (`feat(social-cards,web): viral bracket share PNGs + 6s
   animated MP4s + Lock->Save rename (#127)`). Took "theirs"
   for the 5 conflicting bracket files (no rebrand strings in
   them), then patched the single `vtourn.com` reference that
   came in via `packages/social-cards/test/bracket-share-card.test.ts`.

## Numbers

- 360 files changed in one commit
- 1,398 starting matches for `vtourn|VTourn|Vtourn|VTOURN`
- 35 matches remain in tree, all of them intentional internal
  identifiers (see "Kept unchanged" below). Zero user-facing
  "VTourn" / "vtourn.com" left.

## Verification

- `pnpm typecheck` — clean across all packages
- `pnpm -r test` — 593 tests passing in `apps/web`,
  plus the rest of the workspace clean
- `pnpm --filter @vtorn/marketing build` — 18 pages rendered, no errors
- `pnpm --filter @vtorn/web build` — Next prod build OK
- `git grep -nE "vtourn|VTourn|Vtourn|VTOURN" -- ':!sessions/'`
  returns 35 lines, all in the kept-unchanged categories below

## Kept unchanged (intentional)

These are all internal identifiers that would either:
- break in-flight users (localStorage keys, JWT keys),
- break the CRM contract with GHL (custom field names),
- break the npm workspace (the `@vtorn/*` scope is invasive),
- or are staging-infra owned by ops and rename during a separate
  maintenance window.

| What                                       | Why                                                  |
|--------------------------------------------|------------------------------------------------------|
| `@vtorn/*` npm scope (697 refs)            | Invasive; not public; renaming touches every package |
| `vtourn_jwt` localStorage key              | Logs out every existing logged-in user               |
| `vtourn:theme` localStorage key            | Resets every existing user's theme preference        |
| `vtourn_user_id` GHL custom field           | Breaks the live GHL CRM integration contract         |
| `vtourn_last_event_id` GHL custom field     | Same as above                                        |
| `onVtournTelegramAuth` window callback     | Internal JS identifier; not user-visible             |
| `vtorn.aiva.nz` + `vtorn-*` tunnels        | Staging infra; rename in a separate ops window       |
| `VTORN_WEB_URL` env var (Capacitor)        | Internal build env; matches `@vtorn/*` scope         |
| Historical blog post bodies                 | Per orchestrator brief                               |
| Session notes                               | Per orchestrator brief                               |
| Git remote URL                              | Auto-redirects after GitHub repo rename              |

## To do post-rebrand

These are out of scope for this PR; the orchestrator will pick
them up:

- **Rename PM2 process names** from `vtorn-*` to `tournamental-*`
  in a maintenance window so live processes don't drop.
- **Rename the local git remote URL** once Tim renames the GitHub
  repo `vtorn` -> `tournamental` (GitHub auto-redirects so this
  isn't urgent).
- **Rename the workspace path** from `vtorn` -> `tournamental`.
  This invalidates Claude agent IDs tied to the cwd, so it
  needs to be coordinated with a cold-restart.
- **Register social accounts** under `@tournamental` (Telegram,
  X, Instagram). Tim is lining these up.
- **Visual logo pass** — the SVG art in
  `apps/marketing/public/icons/tournamental/v-mark.svg` is the
  old "V" mark. Designer should refresh the wordmark + maybe the
  glyph to suit the new name. Out of scope for this PR.
- **Rename `@vtorn/*` npm scope** if and when Tim wants the
  monorepo's internal package names to match the brand. Pure
  hygiene; not user-facing.
- **Telegram bot username** still TBD —
  `apps/tournament-bot/README.md` lists the candidates
  (`@TournamentalBot`, `@Tournamental2026`, `@TournamentalHQBot`).

## Outcome

The whole rebrand is one squashable commit, all gates green,
zero user-facing leftovers. Tim can announce on the new
domain as soon as DNS settles.
