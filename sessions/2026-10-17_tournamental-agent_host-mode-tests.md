---
status: done
agent: tournamental-agent
date: 2026-10-17
task: Vitest coverage for the host-mode routing shipped in PR #333
refs: apps/web/middleware.ts, apps/web/lib/tournaments/registry.ts, docs/22-deployment-and-tunnels.md
---

# Host-mode routing tests (archive, hub, live)

## Plan

- Hivemind burn board item: PR #333 shipped the FWC 2026 archive and
  the RWC 2027 hub with no tests. Cover middleware host modes (archive
  aliases, 403 on mutating methods, blocked prefixes, the
  `/s/<guid>/join` pattern, the `x-tnm-archive` header) and
  `archiveForHost` in the registry.
- Work in a separate worktree (production units run from the main
  checkout), never switch branches or install there.

## What was done

- `apps/web/__tests__/platform/registry.test.ts`: status helpers,
  `archiveForHost` (canonical host, case, `.localhost`, aliases return
  null, upcoming never archived), the percentages-only rule on public
  stats, podium data, header name parity with `lib/archive/server.ts`.
- `apps/web/__tests__/platform/middleware-host-modes.test.ts`: alias
  301s with path and query kept, 403 `archived` JSON on POST, PATCH,
  PUT and DELETE, CSRF `bad_origin` ordering, `/` rewrite to
  `/archive` with the request header, every blocked prefix and the
  segment boundary cases (`/poolsy`, `/leaderboards` stay open), the
  join pattern, legal redirects, locale cookie behaviour, hub mode
  (`/hub` rewrite, invite links 4 to 16 alphanumerics lower-cased,
  allow list, fallback 302 to the latest archive, register-interest
  POST and the Origin guard), dev and marketing hosts untouched.
- `apps/web/__tests__/platform/middleware-live-mode.test.ts`: registry
  mocked with RWC 2027 active, play serves the app again, archive host
  stays read-only.
- 83 tests, all passing. 5 of them fail against the pre-fix
  middleware, which is the point of the one code change below.

## Bug found and fixed

Locale-prefixed URLs bypassed the host-mode rules because the prefix
was only stripped inside `withLocaleHint`, after every decision had
been made on the raw path. Verified live before the fix:

- `fwc2026.tournamental.com/es` rendered the live sales home page.
- `fwc2026.tournamental.com/fr/leaderboard` served the leaderboard,
  which the block list is meant to hide on the archive.
- `play.tournamental.com/es` bounced to the archive instead of the hub.

Fix in `middleware.ts`: `routePathOf()` strips a supported locale
prefix once; the archive block list, legal map, hub allow list, invite
match and the `/` rewrites use that path. Redirect targets keep the
original path so the locale survives. `withLocaleHint` now honours an
explicit `rewriteTo` (`/archive`, `/hub`) under a prefix.

## Verification

- `vitest run __tests__/platform`: 83 passed.
- `eslint middleware.ts __tests__/platform`: clean.
- Full `vitest run` for apps/web: 1139 passed, 157 failed in 36 files, all pre-existing on main (missing next-intl provider in component tests, async components rendered as children, a few stale copy assertions). Re-ran four of the failing files with the middleware change stashed: identical failures. Worth its own burn-board item.
- Not run: `tsc --noEmit` (over ten minutes on this app); vitest
  transforms the files and the change touches no types.

## Not deployed

The production unit runs from the main checkout. The fix goes live
with the next build and restart after the PR is merged, which is
Tim's call.

## Next steps

- Remaining tournamental burn-board items: register-interest security
  review, CLAUDE.md and README refresh, branch triage, a11y audit,
  final-standings unit tests.
