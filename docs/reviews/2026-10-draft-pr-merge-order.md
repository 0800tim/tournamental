# Merge order for the seven draft PRs of 17 October 2026

> Read-only review of draft PRs #335 to #341, written on 2026-10-17 against `main` at e1e0eac9. Nothing here is merged, built or deployed; that is Tim's call. Source: `gh pr list`, `git diff --stat` per branch, and a `git merge-tree` simulation of every merge in the proposed order (object store only, no checkout).

## Summary

- All seven branches start from the same base (e1e0eac9) and each is one commit, except #335 which is now two.
- Only two PRs change code that runs in production: **#335** and **#336**, both in `apps/web`. The other five are tests or docs.
- The only file two PRs both touch is `apps/web/middleware.ts` (#335 and #336). The hunks are 130 lines apart and git merges them cleanly in either order. `.gitignore` is touched by #336 alone.
- Proposed order: **#335, #336, #340, #338, #337, #339, #341**. The simulation merges all seven in this order with no conflicts.
- One unit restart in total: `tournamental-web`, after #335 and #336 are both in (or after each, if they land on different days). No other unit is affected.

## Correction made while writing this

PR #335's description, session note and hivemind entry all describe a locale-prefix fix in `apps/web/middleware.ts`, but the branch as pushed on 17 October held only the tests. The fix had been left uncommitted in the PR's worktree, so five of the 83 tests would have failed in CI and the hub and archive hosts would still have been bypassable through `/fr/...` style URLs. The fix is now committed as a29e3592 on the same branch (`routePathOf()` plus the `rewriteTo` change in `withLocaleHint`). The file lists below reflect the branch after that commit.

## What each PR touches

| PR | Branch | Runtime code | Tests | Docs and notes |
| --- | --- | --- | --- | --- |
| #335 | `test/archive-middleware-host-modes` | `apps/web/middleware.ts` (locale-stripped routing) | `apps/web/__tests__/platform/` (3 files, 83 cases) | session note |
| #336 | `review/register-interest-security` | `apps/web/middleware.ts` (`ARCHIVE_BLOCKED_API`), `apps/web/app/api/v1/register-interest/route.ts`, `apps/web/lib/register-interest/store.ts`, `.gitignore` | `apps/web/__tests__/register-interest/` (5 files, 66 cases) | `docs/reviews/2026-10-register-interest.md`, session note |
| #337 | `docs/refresh-entrypoints` | none | none | `CLAUDE.md`, `README.md`, session note |
| #338 | `docs/host-modes-runbook` | none | none | `docs/runbooks/tournament-host-modes.md`, session note |
| #339 | `docs/branch-triage` | none | none | `docs/reviews/2026-10-branch-triage.md`, session note |
| #340 | `test/archive-standings-fixtures` | none | `apps/web/__tests__/archive/` (2 files, 25 cases) | session note |
| #341 | `docs/security-checklist-refresh` | none | none | `docs/33-security-hardening-checklist.md`, session note |

Every PR adds its own file under `sessions/`, all with different names, so that directory never conflicts.

### The one shared file: `apps/web/middleware.ts`

| PR | Hunks | Lines (on main) |
| --- | --- | --- |
| #335 | adds `HUB_HEADER`; adds `routePathOf()`; switches the archive block list, legal redirects, `/` rewrites, hub allow list and invite match from `path` to `routePath`; `withLocaleHint` honours an explicit rewrite target | 66, 172, 223 to 262, 342 |
| #336 | adds `ARCHIVE_BLOCKED_API`; extends the archive 403 condition with it | 93, 220 |

The #336 condition at line 220 and the #335 change at line 223 are three lines apart but do not overlap, and `git merge-tree` resolves both orders without a conflict marker. The merged result reads:

```ts
if (MUTATING_METHODS.has(req.method) || ARCHIVE_BLOCKED_API.some((re) => re.test(path))) {
  // 403 archived
}
const legalRedirect = LEGAL_REDIRECT_MAP[routePath];
```

That is correct as written: API paths never carry a locale prefix, so `path` and `routePath` are the same string there. A later tidy-up could use `routePath` for consistency; it is not needed for either PR.

### Cross-references between the docs PRs

These do not conflict, but the order decides whether links resolve on the day they merge.

- #337 (`README.md`, `CLAUDE.md`) links to `docs/runbooks/tournament-host-modes.md`, which #338 creates.
- #338 (runbook) tells the reader to run the tests from #335.
- #341 (checklist) links to `docs/reviews/2026-10-register-interest.md` (#336) and `docs/reviews/2026-10-branch-triage.md` (#339), and cites #335 and #336 as the fixes for two partial items.

## Proposed order and what to do after each

| Step | PR | Why here | After merge |
| --- | --- | --- | --- |
| 1 | #335 | Code fix with the most tests; everything else that touches the middleware builds on the locale-stripped path | Build `apps/web`, restart `tournamental-web`, run checks A and B |
| 2 | #336 | Second code change, same file, adjacent hunk; brings the `.gitignore` rule for the `.env.*.bak*` files | Build `apps/web`, restart `tournamental-web`, run checks A and C |
| 3 | #340 | Tests only, no runtime change | Nothing to restart. Run the archive test files on bigmac |
| 4 | #338 | Runbook; wanted before #337 so the README link lands on a real file | Nothing |
| 5 | #337 | Entry-point docs; links now resolve | Nothing |
| 6 | #339 | Standalone report | Nothing. Branch deletions it recommends are a separate decision |
| 7 | #341 | Links to #336 and #339 output | Nothing |

If #335 and #336 merge in the same sitting, do one build and one restart after #336 and run checks A, B and C together.

### Build and restart (steps 1 and 2 only)

Production runs from the main checkout, so this is the only time the main checkout changes. Per `docs/22-deployment-and-tunnels.md` and the runbook in #338:

```bash
cd /srv/projects/internal/tournamental
git pull --ff-only origin main            # main is already checked out; no branch switch
cd apps/web
systemd-run --user --scope -p MemoryMax=4G pnpm run build
systemctl --user restart tournamental-web
systemctl --user status tournamental-web --no-pager | head -5
```

One build at a time on the box. The unit is `next start -p 3300` from `apps/web`, so the restart picks up the new `.next` output. No other unit (`tournamental-game`, `-auth-sms`, `-admin`, `-odds-ingest`, `-tournament-bot`, `-tunnel`) reads anything these PRs change.

## Checks after the restart

All from the box over loopback with a `Host` header. Expected values are for today's state (hub mode on play, FWC 2026 archived).

### A. The runbook's host-mode lines (`docs/runbooks/tournament-host-modes.md`, sections 3 and 5)

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: play.tournamental.com' http://127.0.0.1:3300/
# 200   (hub rewrite is internal)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: play.tournamental.com' http://127.0.0.1:3300/leaderboard
# 302 https://fwc2026.tournamental.com/leaderboard
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: fwc2026.tournamental.com' http://127.0.0.1:3300/leaderboard
# 302 https://fwc2026.tournamental.com/
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Host: fwc2026.tournamental.com' http://127.0.0.1:3300/world-cup-2026
# 403
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: wc2026.tournamental.com' http://127.0.0.1:3300/
# 301 https://fwc2026.tournamental.com/
```

### B. After #335: locale prefixes obey the host rules

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: fwc2026.tournamental.com' http://127.0.0.1:3300/fr/leaderboard
# 302 https://fwc2026.tournamental.com/   (was 200 before the fix)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: play.tournamental.com' http://127.0.0.1:3300/es
# 200   (hub, served internally; was 302 to the archive before the fix)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: play.tournamental.com' http://127.0.0.1:3300/es/pools
# 302 https://fwc2026.tournamental.com/es/pools   (redirect keeps the locale)
```

### C. After #336: GET writers closed on the archive, body cap on the hub form

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: fwc2026.tournamental.com' \
  http://127.0.0.1:3300/api/v1/syndicates/anypool/join-requests/anyuser/approve
# 403   (before the fix the request reached the handler, which validated the signed token and could write)
head -c 9000 /dev/zero | tr '\0' 'a' > /tmp/big.json
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Host: play.tournamental.com' \
  -H 'Origin: https://play.tournamental.com' -H 'Content-Type: application/json' \
  --data-binary @/tmp/big.json http://127.0.0.1:3300/api/v1/register-interest
# 413
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Host: play.tournamental.com' \
  -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3300/api/v1/register-interest
# 403   (no Origin header: the CSRF guard still runs first)
```

Do not submit a real signup from the box unless it is Tim's own address; the route pushes to HighLevel.

## Tests to run before merging (bigmac, not this box)

Each PR's own tests passed in its worktree on 17 October, but the combined tree was never run. From a worktree on the merged result, `apps/web`, one process at a time:

```bash
node_modules/.bin/vitest run __tests__/platform            # #335, 83 cases
node_modules/.bin/vitest run __tests__/register-interest   # #336, 66 cases
node_modules/.bin/vitest run __tests__/archive             # #340, 25 cases
node_modules/.bin/eslint middleware.ts app/api/v1/register-interest lib/register-interest
```

Use the `vitest` binary directly: `pnpm exec` in a worktree tries to reinstall and aborts without a TTY. Expect the rest of the `apps/web` suite to show its 157 pre-existing failures (missing `NextIntlClientProvider` in component tests); that repair is a separate board item.

## Things to know

- The main checkout has three modified generated files and two untracked `.env.*.bak-sendgrid-2026-10-15` backups. `git pull --ff-only` is unaffected by them. Never `git add -A` there; after #336 the backups are ignored.
- `#335`'s worktree also holds an untracked throwaway `apps/web/apps/game/data/game.db` written by a test run. It is not in the PR and can be removed with the worktree.
- #339 recommends deleting 126 branches that are already on main. That is independent of this order and stays a separate decision.
- The hub form's open items (Turnstile, retention wording, double opt-in) are tracked in `docs/reviews/2026-10-register-interest.md`; none of them blocks the merges above.

---

# Update, 20 October 2026: all sixteen draft PRs, #335 to #350

> Same method as above, re-run on 2026-10-20 against `main` at e1e0eac9 (nothing has merged since the 17th): `git diff --name-only` per branch and a `git merge-tree` dry run of every merge in the order below, object store only. Nine PRs were opened after the first section was written. This section replaces the order in section "Proposed order and what to do after each" above; the checks and the build steps there still apply.

## What the nine new PRs touch

| PR | Branch | Runtime code | Tests | Docs and notes |
| --- | --- | --- | --- | --- |
| #342 | `docs/draft-pr-merge-order` | none | none | this file, session note |
| #343 | `feat/archive-r32-results` (stacked on #340) | `apps/web/lib/archive/final-standings.ts`, `app/archive/page.tsx` | `__tests__/archive/final-standings.test.ts` (extends #340's file) | session note |
| #344 | `fix/web-vitest-suite` | `apps/web/locales/en.json` (one key), `vitest.config.ts` | 30 test files rewritten, `__tests__/helpers/render.tsx` and `clock.ts` added, `autopick-cascade.test.tsx` deleted, `__tests__/REPAIR-NOTES-2026-10.md` | session note |
| #345 | `feat/web-security-headers` | `apps/web/next.config.mjs`, `lib/security/headers.mjs` | `__tests__/platform/security-headers.test.ts` | session note |
| #346 | `docs/registry-driven-chrome` | none | none | `docs/design/registry-driven-tournament-chrome.md` |
| #347 | `docs/dependabot-verification` | none | none | `docs/reviews/2026-10-dependabot-verification.md` |
| #348 | `fix/a11y-hub-archive-shell` | `app/hub/RegisterInterestForm.tsx`, `components/ui/CountdownBanner.tsx`, `components/shell/AppMenuDrawer.tsx`, `BottomNav.tsx`, `AppShell.tsx`, `app/archive/page.tsx`, `lib/archive/labels.ts`, `app/globals.css` | `__tests__/a11y/` (5 files, own intl wrapper) | `docs/reviews/2026-10-accessibility-hub-archive-shell.md` |
| #349 | `docs/dsar-runbook` | none | none | `docs/runbooks/dsar-access-and-erasure.md` |
| #350 | `docs/unlanded-branches` | none | none | `docs/reviews/2026-10-unlanded-branches.md` |

Every session note still has its own name, so `sessions/` never conflicts.

## Every overlap, confirmed with merge-tree

Only three files appear in more than one PR:

| File | PRs | Outcome |
| --- | --- | --- |
| `apps/web/middleware.ts` | #335, #336 | merges cleanly either way (section above) |
| `apps/web/__tests__/archive/final-standings.test.ts` | #340, #343 | not a clash: #343's branch contains #340's commit and edits the file on top |
| `apps/web/app/archive/page.tsx` | #343, #348 | **conflicts in either order** (resolution below) |

Points raised in the task brief, checked: #344 shares no file with #335 or #336 (the suite repair edits test files, two helpers, the config and one catalogue key; #335 and #336 add test files of their own) and merges cleanly after them; it is ordered after them only so the platform and register-interest test folders land on a green suite. #345 is the only PR that touches `next.config.mjs`, so it has no overlap at all. #348's `__tests__/a11y/` folder carries its own intl wrapper on purpose so it passes with or without #344.

### The one conflict: `app/archive/page.tsx`, #343 and #348

#343 moves the stage order and labels into `lib/archive/final-standings.ts` (`KNOCKOUT_STAGE_ORDER`, `KNOCKOUT_STAGE_LABEL`) and replaces the inline score expression with `knockoutScoreText`'s twin in the page. #348 adds `lib/archive/labels.ts` (`knockoutLinkLabel`, `knockoutScoreText`) and gives every "Match" link an accessible name. Both edit the import block and the knockout list. Merge #343 first; when #348 then conflicts, resolve by keeping both imports and both behaviours:

```ts
import {
  KNOCKOUT_STAGE_LABEL,
  KNOCKOUT_STAGE_ORDER,
  loadFinalStandings,
  loadKnockoutResults,
} from "@/lib/archive/final-standings";
import { knockoutLinkLabel, knockoutScoreText } from "@/lib/archive/labels";
```

and in the list: iterate `KNOCKOUT_STAGE_ORDER`, render `<h3>{KNOCKOUT_STAGE_LABEL[s] ?? s}</h3>`, the score as `{knockoutScoreText(k)}`, and the link with `aria-label={knockoutLinkLabel(KNOCKOUT_STAGE_LABEL[s] ?? s, teamName(k.winner), k)}`. Then run `__tests__/archive` and `__tests__/a11y/archive-labels.test.ts`. The reverse order conflicts the same way and is not easier.

## One order, one restart

| Step | PR | Kind | Build and restart? |
| --- | --- | --- | --- |
| 1 | #335 | code and tests | no, wait |
| 2 | #336 | code, tests, `.gitignore` | no, wait |
| 3 | #340 | tests | no |
| 4 | #343 | code and tests (includes #340) | no, wait |
| 5 | #344 | tests, config, one `en.json` key | no, wait |
| 6 | #345 | code (`next.config.mjs`) and tests | no, wait |
| 7 | #348 | code and tests; resolve the conflict above | **yes: build `apps/web`, restart `tournamental-web` once, run checks A, B, C and D** |
| 8 | #338 | docs (runbook) | no |
| 9 | #337 | docs (links to #338's file) | no |
| 10 | #339 | docs | no |
| 11 | #341 | docs (links to #336 and #339 output) | no |
| 12 | #342 | docs (this file) | no |
| 13 | #346 | docs (links to #338's runbook) | no |
| 14 | #347 | docs | no |
| 15 | #349 | docs (links to #336's helper) | no |
| 16 | #350 | docs (links to #339) | no |

The merge-tree run of these sixteen in this order reports exactly one conflict, step 7, resolved as above. Steps 1 to 7 are the only ones that change the running app; one build and one restart after step 7 covers all of them, and the docs steps need nothing. If the code steps land on different days, the build and restart after each day's last code merge is enough; the restart point never moves earlier than #336 because the register-interest fixes are the ones worth having live.

Build and restart are unchanged from the section above (`git pull --ff-only` on the main checkout, `systemd-run --user --scope -p MemoryMax=4G pnpm run build` in `apps/web`, `systemctl --user restart tournamental-web`). Add one check after the restart:

### D. After #345 and #348: headers and the embed exemption

```bash
curl -s -D - -o /dev/null -H 'Host: play.tournamental.com' http://127.0.0.1:3300/ | grep -i -E "x-frame|content-security|x-content-type|referrer|permissions"
# X-Frame-Options: DENY, Content-Security-Policy: frame-ancestors 'none', nosniff, Referrer-Policy, Permissions-Policy, and a Content-Security-Policy-Report-Only
curl -s -D - -o /dev/null -H 'Host: play.tournamental.com' 'http://127.0.0.1:3300/world-cup-2026?embed=1&pool=x' | grep -i -c "x-frame-options"
# 0   (the partner embed may be framed)
curl -s -H 'Host: fwc2026.tournamental.com' http://127.0.0.1:3300/ | grep -o 'Round of 32' | head -1
# Round of 32   (#343's block on the archive home)
```

## Tests to run on bigmac before merging (updated)

From a worktree on the merged result of steps 1 to 7, `apps/web`, one process at a time, `vitest` binary direct:

```bash
node_modules/.bin/vitest run __tests__/platform            # #335 and #345, 98 cases
node_modules/.bin/vitest run __tests__/register-interest   # #336, 66 cases
node_modules/.bin/vitest run __tests__/archive             # #340 and #343, 29 cases
node_modules/.bin/vitest run __tests__/a11y                # #348, 21 cases
node_modules/.bin/vitest run                               # #344: expect 0 failures, 2 skipped (OPEN product issues)
```

The full run was green on #344's branch alone; the combined tree has not been run anywhere yet. The accessibility tests may move from their own intl wrapper to `__tests__/helpers/render` once both are in; not required.

## Needs Tim: the digest

Everything the sixteen PR bodies, their review documents and the hivemind log left for Tim, in one place, grouped by what kind of answer it needs. Nothing here blocks the merges above except where it says so.

### Merges and the one deploy

1. Merge steps 1 to 7 in order, resolve the one conflict at step 7, build and restart `tournamental-web` once, run checks A to D. Then merge the nine docs PRs in any order (the table order keeps links resolving on the day).
2. Before that, a bigmac test run of the combined steps 1 to 7 (commands above). This box cannot run the full suite comfortably.
3. The register-interest weaknesses (#336) and the missing security headers (#345) stay live until that restart. Severity is low to medium, no money or credentials involved.

### Yes or no decisions

4. **Branch protection on `main`** with gitleaks and DCO as required checks (#341). Today nothing is enforced; the CI Node job fails on `main` itself since June because of two errors in `packages/bot-sdk/examples` (#350), so the first step is that fix, then the protection.
5. **Dependabot** (#347): merge #200 and #201 together, then #202, #204, #203; ask Dependabot to rebase #207 and merge it (three units restart); close #208; replace #209 with a one-line rename in `apps/vstamp`; decide Node 22 in CI before #206 or let Dependabot propose undici 7.x.
6. **Delete the 126 branches** the triage found already on `main` (#339), and `next15-dev` once its version table is copied into the Next 15 plan (#350). Keep `feat/commentary` as a reference until the renderer is back on the roadmap.
7. **Turnstile and a global rate brake** on the hub form before the prize draw is announced (RI-06, #336, #341). The global brake is code work that can go ahead; Turnstile is a third-party integration and is Tim's call.
8. **Double opt-in in HighLevel** before any marketing message, with only confirmed sign-ups counting for referral entries (RI-12, #336).
9. **Retention and privacy wording** for register-interest rows (RI-10, #336, #349), and the related gaps the DSAR runbook lists: no store for the 12-month fraud hashes the policy promises, no self-service deletion, OTP audit log never rotated, journald retention not pinned (root change), snapshot retention undefined.
10. **HSTS at the Cloudflare zone** (#345, #341): one setting covers every hostname; the app deliberately does not send it.
11. **Promote the CSP** from report-only after a week of watching devtools on the hub and the archive (#345); there is no report endpoint, so this is a manual watch.
12. **Registry-driven chrome** (#346): agree the seven new entry fields and the move of the registry into a workspace package before the five follow-up PRs start.
13. **`/hub` after the registry flip** (#338): leave it reachable in live mode or add a redirect; and what register-interest should return once nothing is `upcoming` (today 409).

### Product calls surfaced by tests

14. **"Lock" copy regressed after the Lock to Save rename** (#344, skipped test): the `BracketBuilder` fallback "Lock in your bracket" and two strings on `app/odds/page.tsx`; the pool "Lock entries by country" strings are a different feature and want a guard allow-list.
15. **The molecule consensus bracket stops at the round of 32** (#344, skipped test): `lib/molecule/odds-consensus.ts` never sets best thirds. A fix is in reach without Tim (pick the eight best thirds from the group orders it already computes) and is queued.
16. **Admin Customer 360 shows full phone and email with no audit of the view** (#341, #349). Masking with an audited reveal is code work that can go ahead.
17. **status.tournamental.com** does not resolve but is promised in the May engineering post (#341): stand one up or edit the post.

### Checks only Tim can run

18. **Cloudflare OTP edge rules and API token scopes** (#341): confirm in the dashboard that the five `infra/cloudflare/otp-protection.sh` rules are still applied and the tunnel and DNS tokens are zone-scoped.
19. **Browser pass with axe** on the hub, the archive and the drawer after #348 is built (#348): the audit was static.
20. **A test account walk of the DSAR runbook** before the first real request (#349).

### Housekeeping

21. The two hand-made `.env.*.bak-sendgrid-2026-10-15` files in the main checkout become ignored once #336 merges; until then never `git add -A` there.
22. PR #335's locale fix was committed on the 17th (a29e3592) after being found uncommitted; its body now matches its content.

---

# Update, 20 October, evening: the nine PRs opened today, #351 to #360

> Same method, re-run over all twenty-five open draft PRs after the day's work. `main` is still e1e0eac9. The order in the previous section stands; this adds where the new PRs slot in and the one new restart point.

## What the new PRs touch

| PR | Branch (base) | Runtime code | Restart |
| --- | --- | --- | --- |
| #351 | `fix/ci-bot-sdk-examples` (main) | `packages/bot-sdk/examples/*` typecheck only | none; CI only |
| #352 | `fix/admin-customer360-pii` (main) | `apps/admin` lib, two routes, component, three pages | **`tournamental-admin`** after a build of `apps/admin` |
| #353 | `fix/molecule-consensus-best-thirds` (on #344) | `apps/web/lib/molecule/odds-consensus.ts` | with the web restart |
| #354 | `fix/register-interest-global-brake` (on #336) | `apps/web` register-interest route, brake module, limiter, `.env.example` | with the web restart |
| #355 | `docs/draft-pr-code-review` (main) | none | none |
| #356 | `docs/retention-consent-paper` (main) | none | none |
| #357 | `feat/registry-chrome-fields` (on #344) | `apps/web` registry, shell context, layout, AppBar, drawer, nav links | with the web restart |
| #358 | `docs/incident-runbooks` (main) | none | none |
| #359 | `docs/rwc2027-engine-readiness` (main) | none | none |
| #360 | `fix/game-settle-bronze-final` (main) | `apps/game/src/schemas.ts` | **`tournamental-game`** (no build, tsx serves the source) |

Same-day fix commits also landed on #335, #336, #343, #345 and #348 for the code review's findings (status table in `docs/reviews/2026-10-draft-pr-code-review.md`); they change nothing about the order below.

## Order, with the new ones placed

Web code first, in the order that keeps each stacked branch after its base:

1. #335, then #336, then **#354** (on #336)
2. #340, then #343
3. #344, then **#353** (on #344)
4. #345
5. #348 (resolve the archive page conflict as documented above)
6. **#357** (on #344; its drawer edits sit in different hunks from #348's, the simulation after the resolved conflict shows no further clash)

   **Build `apps/web`, restart `tournamental-web` once, run checks A to D.**

7. **#360**: restart `tournamental-game` (no build).
8. **#352**: build `apps/admin`, restart `tournamental-admin`.
9. **#351** and **#361** (test files only, game and admin suites to green): nothing to restart; with #344 in, the next CI run on `main` should go green.
10. The docs PRs in any order: #338, #337, #339, #341, #342, #346, #347, #349, #350, #355, #356, #358, #359.

The merge-tree run over all twenty-five in this order reports the one conflict already documented (#348 on `apps/web/app/archive/page.tsx`) and nothing else.

## Tests to run on bigmac before merging (additions)

```bash
node_modules/.bin/vitest run lib/molecule/test/odds-consensus.test.ts        # #353, 9 cases
node_modules/.bin/vitest run __tests__/register-interest                     # #354 on top of #336, 74 cases
node_modules/.bin/vitest run __tests__/platform __tests__/shell-chrome.test.tsx __tests__/AppMenuDrawer.test.tsx   # #357, with #335 and #345
```

And in `apps/admin` for #352: `node_modules/.bin/vitest run __tests__/lib/pii.test.ts __tests__/lib/audit-context.test.ts __tests__/lib/reveal-routes.test.ts __tests__/components/RevealPii.test.tsx __tests__/pages/customer360Tabs.test.tsx` (one pre-existing failure in the last file, the delete dialog, fails on `main` too). In `apps/game` for #360: `node_modules/.bin/vitest run tests/schemas-match-result.test.ts` (the three failing cases in `tests/match-result.test.ts` fail on `main` too).

## Needs Tim, additions to the digest

23. Set `REGISTER_INTEREST_GLOBAL_PER_MINUTE` in `apps/web/.env.production` only if 60 a minute is wrong for launch week (#354).
24. The two spots that still show an unmasked email in the admin console: the users list column (it is a search key) and the user page header (#352).
25. The live-mode embed plan before the framing rule is enforced on play: in-frame links need `target="_top"` or to carry `?embed=1` (#345, review 345-1); the archive host is exempt now.
26. Retention and consent decisions 1 and 2 before the hub form is promoted (#356).
27. The R16 placement rule, the rugby scoring model, the live provider, and whether to commit the rugby-league fixture drafts (#359).
28. The kickoff-during-outage pool rule and whether to run a second tunnel (#358).
29. If the FWC 2026 bronze final is missing from `match_results`, re-post it once after #360 restarts the game service.
30. The three failing cases in `apps/game/tests/match-result.test.ts` and the delete-dialog case in the admin Customer 360 test failed on `main`; PR #361 fixes them (and nine more in the game suite) with test-only changes.

# Update, 22 October 2026: the fifteen draft PRs #366 to #380

> Different method from the sections above: instead of a `merge-tree` dry run, all fifteen branches were merged for real, in the order below, into a throwaway branch (`integration/2026-10-22-burn-chain`, pushed for reference, not for merging as it stands) in a separate worktree, and the engine, game and web suites and typechecks were run on the combined tree on this box, one at a time under `MemoryMax=3G`. `main` was 76e4db87 throughout (nothing has merged since #348). This section is the order for these fifteen; the two sections above stand for the older PRs, all of which have merged.

## What each PR touches

| PR | Branch (base) | Runtime code | Tests | Docs and data | Restart |
| --- | --- | --- | --- | --- | --- |
| #366 | `feat/engine-rugby-standings` (main) | `packages/bracket-engine/src/standings.ts`, `tournament.ts`; `apps/game/src/schemas.ts` (tries fields) | engine `standings-rugby.test.ts`, `standings.test.ts`; game `schemas-tries.test.ts` | engine README and CHANGELOG, `docs/design/rwc2027-engine-readiness.md`, `.gitignore` | web build, web and game |
| #367 | `docs/progress-2026-10-20` (main) | none | none | `docs/PROGRESS.md` | none |
| #368 | `feat/knockout-method-kicks` (main) | `apps/game/src/schemas.ts`, `types.ts`; `apps/web/lib/archive/labels.ts` | game `schemas-match-result.test.ts`; web `a11y/archive-labels.test.ts` | readiness doc | web build, web and game |
| #369 | `feat/rwc-2027-fixtures` (on #366) | `packages/bracket-engine/src/fixtures-loader.ts`, `cascade.ts`, `tournament.ts`, `index.ts`, `data/rwc-2027-fixtures.json`, generator script | engine `fixtures-rwc-2027.test.ts` | engine README and CHANGELOG, readiness doc | web build, web and game |
| #370 | `refactor/cascade-bridge-hoist` (main) | `packages/bracket-engine/src/bridge.ts`, `index.ts`, `tsup.config.ts`; `apps/web/lib/bracket/cascade-bridge.ts`; `apps/game/src/routes/bracket-cascade-summary.ts` | engine `bridge.test.ts` | engine CHANGELOG, IDEAS.md | web build, web and game |
| #371 | `feat/rwc-2027-flags` (main) | ten SVGs under `apps/web/public/flags/`, `apps/web/scripts/download-flags.mjs` | none | `data/rwc-2027/teams.json` (24 unions: code, name, flag emoji, Commons file, ranking), readiness doc | web build, web |
| #372 | `docs/security-checklist-2026-10-21` (main) | none | none | `docs/33-security-hardening-checklist.md` | none |
| #373 | `test/game-cascade-summary` (main) | none | game `bracket-cascade-summary.test.ts` | none | none |
| #374 | `feat/game-vendored-tournaments` (on #369) | `apps/game/src/kickoffs.ts`, `routes/bracket-by-guid.ts`, `leaderboard.ts`, `match.ts`, `types.ts` | game `vendored-tournaments.test.ts`, `match-result.test.ts` | IDEAS.md | game |
| #375 | `ci/stacked-pr-checks` (main) | none | none | `.github/workflows/ci.yml`, `pr-security.yml` | none |
| #376 | `feat/web-thirds-by-rules` (on #369) | `apps/web/lib/bracket/thirds.ts` (new), `real-standings.ts`, `lib/archive/results-bracket.ts`, `lib/molecule/odds-consensus.ts`, `lib/syndicate/persistence.ts`, `components/bracket/BracketBuilder.tsx`, `CascadeWarnings.tsx`, `ThirdsPicker.tsx`, `components/browser-swarm/cascade.ts` | six web test files | readiness doc | web build, web |
| #377 | `feat/game-summary-path-by-tournament` (on #374) | `apps/game/src/routes/bracket-cascade-summary.ts` | game `cascade-summary-rwc2027.test.ts` | IDEAS.md | game |
| #378 | `fix/web-share-path-by-tournament` (on #369) | `apps/web/lib/bracket/by-guid.ts` | web `share-by-guid/load-bracket-from-guid.test.ts` | none | web build, web |
| #379 | `chore/archive-sessions` (main) | `scripts/archive-sessions.sh` | none | `sessions/README.md`; 104 notes moved to `sessions/archive/2026/` | none |
| #380 | `fix/web-tests-no-stray-db` (main) | none (`apps/web/vitest.config.ts`) | none | none | none |

Restart column: the web app bundles the engine from source at build time and the game unit runs `tsx src/server.ts` against the workspace source, so an engine change needs a web build plus a restart of both `tournamental-web` and `tournamental-game`; a game-only change needs only the game restart, with no build.

## Every overlap, confirmed by merging

Files touched by more than one PR, session notes aside:

| File | PRs | Outcome |
| --- | --- | --- |
| `packages/bracket-engine/CHANGELOG.md` | #366, #369, #370 | **conflict** #370 then #366 (resolution below); #369 is stacked on #366 and edits on top |
| `packages/bracket-engine/src/index.ts` | #369, #370 | **conflict** #370 then #369 (resolution below) |
| `packages/bracket-engine/package.json` | #369, #370 | clean |
| `packages/bracket-engine/src/tournament.ts` | #366, #369 | stacked, not a clash |
| `packages/bracket-engine/README.md` | #366, #369 | stacked |
| `apps/game/src/schemas.ts` | #366, #368 | clean (tries fields and the kicks method are different hunks) |
| `apps/game/src/types.ts` | #368, #374 | clean |
| `apps/game/src/routes/bracket-cascade-summary.ts` | #370, #377 | clean (#370 replaces the bridge copy, #377 changes the path builder) |
| `docs/design/rwc2027-engine-readiness.md` | #366, #368, #369, #371, #376 | clean, each updates its own gap |
| `IDEAS.md` | #370, #374, #377 | clean, one line each |

The two conflicts are both with #370 and both are "keep both sides":

1. **`packages/bracket-engine/CHANGELOG.md`, #366 after #370.** Both add bullets under Unreleased. Keep #370's `bracketToCascadeInput` bullet, then #366's Added and Changed bullets.
2. **`packages/bracket-engine/src/index.ts`, #369 after #370.** #370 adds `export * from "./bridge.js";` next to the old one-name `loadFixtures2026` export line, which #369 widens to `loadFixtures`, `loadFixtures2026`, `loadFixturesRwc2027`, `VENDORED_TOURNAMENT_IDS` and the `VendoredTournamentId` type. Keep the bridge export and #369's export block; drop the old one-name line.

Merging #366 and #369 before #370 avoids both; then #370 conflicts the other way round on the same two files, with the same resolution.

#379 moves 104 session notes dated 12 August and earlier. No open PR touches any of them, so it merges cleanly in any position.

## Proposed order and what to do after each

| Step | PR | Why here | After merge |
| --- | --- | --- | --- |
| 1 | #375 | Until it lands, the stacked PRs (#369, #374, #376, #377, #378) get no CI at all | Nothing to restart |
| 2 | #379, #380, #367, #372, #373 | No runtime change; any order | Nothing |
| 3 | #366 | Engine standings; base of the rugby stack | Hold the restart until step 7 |
| 4 | #369 | Vendored RWC 2027 fixtures and the loader; retarget its PR to `main` after #366 merges (GitHub does this itself when the base branch is deleted on merge) | Hold |
| 5 | #370 | Resolve the two conflicts above | Hold |
| 6 | #368, #371 | Independent of the stack; any order | Hold |
| 7 | #374, #376, #378 | Each retargets to `main` once #369 is in; any order | Build `apps/web`, restart `tournamental-web` and `tournamental-game`, run the checks below |
| 8 | #377 | After #374 | Restart `tournamental-game` only, check D |

One build and one restart for the whole sitting is enough if steps 3 to 8 happen together: build after #377 and restart both units once.

### Build and restart

Same commands as "Build and restart" above for the web app, plus the game unit, which needs no build:

```bash
cd /srv/projects/internal/tournamental
git pull --ff-only origin main
cd apps/web && systemd-run --user --scope -p MemoryMax=4G pnpm run build && cd ../..
systemctl --user restart tournamental-web tournamental-game
systemctl --user status tournamental-web tournamental-game --no-pager | grep -E 'Active|Main PID'
```

`tournamental-auth-sms`, `-admin`, `-odds-ingest`, `-tournament-bot` and `-tunnel` read nothing these PRs change.

## Checks after the restart

Run check A from the first section (host-mode lines) as before, then:

**D. The share path is still five rounds for a 2026 bracket (#377, #378).** Take any public share link from the archive, `https://fwc2026.tournamental.com/s/<guid>`, expect 200, and the game service behind it:

```bash
curl -s http://localhost:3360/v1/bracket/by-guid/<guid> | python3 -c 'import json,sys; b=json.load(sys.stdin)["bracket"]; print([k["stage"] for k in b["knockout_path"]])'
# ['r32', 'r16', 'qf', 'sf', 'final']
```

**E. The archive's results bracket is unchanged (#376).** `https://fwc2026.tournamental.com/archive` expect 200 with the same eight best thirds as before the restart. The new ranking was checked against the real 2026 results before #376 was opened and the eight did not change.

**F. The result route accepts tries and the kicks method (#366, #368, #374).** Both are additive and optional; a result posted without them is stored as before. The archive host returns 403 to every mutating request, so there is nothing to post on fwc2026; the check is that `tournamental-game` starts and `curl -s http://localhost:3360/healthz` answers.

## Tests on the combined tree

All run on this box in the integration worktree, one at a time, under `MemoryMax=3G`, after the merges above:

| Package | Command (from the package directory) | Result |
| --- | --- | --- |
| `packages/bracket-engine` | `node_modules/.bin/vitest run --no-watch --maxWorkers=2` | 7 files, 130 tests pass; `tsc --noEmit` clean |
| `apps/game` | same | 35 files, 288 tests pass; `tsc --noEmit` clean |
| `apps/web` | same, about two minutes | 142 files, 1465 pass, 1 skip (the Lock copy guard, open since #344); `tsc --noEmit` clean |

`eslint` on the 20 web files the chain touches: one warning, a `useEffect` in `BracketBuilder.tsx` missing `tournament` from its dependency list, which predates every PR here (the effect is keyed on `tournament.id` on purpose).

## Needs Tim, additions to the digest

31. Merge steps 1 to 8 above; expect the two changelog and index conflicts if #370 goes before #366 and #369. One web build and one restart of `tournamental-web` and `tournamental-game` covers the lot.
32. **Round of 16 placement** (readiness gap 3): do the published RWC 2027 regulations fix the bracket by the qualifying pools' combination, or rank the four best thirds and slot them by rank? #369 vendors the fixtures with `best_third` slots; a combination table is a different build.
33. **`fifa_rank` to `world_rank`**: the engine reads `world_rank` first and falls back (#366), and the web helpers do the same (#376). The rename across web, mcp, odds-ingest and wc2026-data is a dozen files and is best done once steps 3 to 8 have merged.
34. **Flags for the rugby unions**: #371 ships ten SVGs and `data/rwc-2027/teams.json` with a flag emoji per union (IRE gets ☘️, no SVG). Still Tim's: the IRFU flag asset itself. Once #371 and #378 are both in, the share page can read rugby flag emoji from that file instead of showing a white flag; that is a small follow-up PR, not a decision.
35. **Rugby route family and share-page copy**: `data/rwc-2027/teams.json` now exists (#371), so what remains is the URL shape for the rugby pages and whether the share page should say "pool" rather than "group" for rugby.
36. **Live rugby results** (gap 7): Sportradar rugby union or ESPN's public scoreboard. A provider choice, and one is paid.
37. **Rugby scoring model** (gap 8): a product call, needed before picks open on 1 September 2027.
38. **Lock copy guard**: the last `it.skip` in the web suite waits on a decision about the remaining user-visible "Lock" strings.
39. **Session-note archive**: `scripts/archive-sessions.sh` (#379) is a monthly chore; run it again in late November.
