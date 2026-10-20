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
