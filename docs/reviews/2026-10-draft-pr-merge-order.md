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
