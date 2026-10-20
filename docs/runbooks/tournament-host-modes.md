---
title: Tournament host modes (live, hub, archive)
date: 2026-10-17
status: verified against the code at e1e0eac9 (main, 17 Oct 2026)
---

# Runbook: tournament host modes

One `apps/web` process (unit `tournamental-web`, port 3300) serves
three kinds of hostname. Which kind a request gets is decided by two
files and carried to the rest of the app by one header pair.

| Mode | Hostname today | What it is |
| --- | --- | --- |
| live | play.tournamental.com while a tournament is `active` | The full app: picks, pools, leaderboard, sign-in |
| hub | play.tournamental.com while no tournament is `active` | Rugby World Cup 2027 hero, register-interest, previous-tournament cards |
| archive | fwc2026.tournamental.com (aliases wc2026, 2026wc) | FIFA World Cup 2026 read-only: podium, percentages, final standings, results bracket |

Nothing else differs between the modes: same build, same process,
same database files. DNS and tunnel ingress for a hostname are in
[docs/22-deployment-and-tunnels.md](../22-deployment-and-tunnels.md)
and are not repeated here.

## 1. The three pieces

### 1.1 `apps/web/lib/tournaments/registry.ts` (the switch)

A plain array `TOURNAMENTS`, each entry with `id`, `slug`, `status`
(`active`, `upcoming` or `archived`), `archiveHost` for archived
entries, and display data (podium, percentage stats, trademark line).
It is imported by the edge middleware, so it must stay free of Node
and database imports.

Four helpers decide everything:

- `activeTournament()`: the first entry with status `active`, or null.
  **Null means play is the hub.**
- `upcomingTournament()`: the first `upcoming` entry. The hub page and
  the register-interest route use it; when it is null the form is not
  rendered and the route answers 409 `no_upcoming_tournament`.
- `archivedTournaments()`: every `archived` entry, in array order. The
  hub redirects unknown paths to the **last** one's `archiveHost`.
- `archiveForHost(host)`: the archived entry whose `archiveHost`
  equals the lower-cased host, or whose `<slug>.localhost` does.
  Aliases (`wc2026`, `2026wc`) are not in the registry; the middleware
  301s them first.

Today: `fifa-wc-2026` is `archived` on `fwc2026.tournamental.com`;
`rwc-2027` is `upcoming`; nothing is `active`.

### 1.2 `apps/web/middleware.ts` (the decision, per request)

The matcher runs on every path except `_next/static`, `_next/image`,
`favicon.ico`, `flags/`, `data/`, `audio/` and `assets/`. The checks
run in this order and the first match wins:

1. **CSRF guard** (all hosts): a POST, PATCH, PUT or DELETE to
   `/api/v1/**` without an `Origin` in the first-party allow-list gets
   403 `{"error":"bad_origin"}`. Three bearer-token routes are exempt.
2. **Deprecated host** `app.tournamental.com`: 301 to play, same path
   and query.
3. **Archive aliases** `wc2026.*` and `2026wc.*`: 301 to
   `https://fwc2026.tournamental.com` + path + query.
4. **Archive mode** when `archiveForHost(host)` matches:
   - any mutating method: 403 `{"error":"archived"}`;
   - `/terms`, `/privacy`, `/cookies`, `/legal`: 301 to the marketing
     site's `/legal/...`;
   - live-only paths: 302 to the archive home. The list is
     `ARCHIVE_BLOCKED_PREFIXES` (`/auth`, `/profile`, `/manage`,
     `/dashboard`, `/pools`, `/syndicates`, `/import`, `/run`,
     `/bots/keys`, `/world-cup-2026/landing`, `/predict`, `/i/`,
     `/leaderboard`, `/next-stage-r32`, `/hub`), matched on whole path
     segments, plus the pattern `/s/<id>/join`;
   - otherwise the request goes through with the request header
     `x-tnm-archive: <slug>`, and `/` is rewritten to `/archive`.
5. **Hub mode** when the host is a play host (`play.tournamental.com`
   or `play.localhost`) and `activeTournament()` is null:
   - legal paths: 301 to the marketing site;
   - `/`: rewritten to `/hub` with request header `x-tnm-hub: 1`;
   - `/i/<code>` (4 to 16 letters or digits): 302 to `/?ref=<code>`,
     lower-cased, so the register-interest form can read the referrer;
   - allowed paths pass through with the hub header:
     `/api/v1/register-interest`, `/api/healthz`, `/api/og/`, `/hub`,
     `/rwc2027/`, `/icons/`, `/fonts/`, `/manifest.webmanifest`,
     `/sw.js`, `/robots.txt`, `/sitemap.xml`, `/whitepaper/`, and any
     path ending in a file extension;
   - everything else: 302 to the latest archive host, same path and
     query, so old share links and pool pages keep resolving.
6. **Live mode** (play host with an active tournament): legal paths
   301 to the marketing site; everything else passes through.
7. **Any other host** (the marketing domain, localhost): passes
   through untouched.

All pass-through responses then go through `withLocaleHint`, which
handles `/<locale>/...` prefixes and the `vt_locale` cookie.

Known gap on main at the time of writing, fixed in PR #335: steps 4
and 5 matched on the raw path, so `/fr/leaderboard` escaped the block
list and `/es` on play fell through to the archive. After that PR the
decisions use the path with the locale prefix removed.

Known gap fixed in PR #336: two API routes write on GET (the signed
approve and deny links for pool join requests). Step 4 only looked at
the method, so they ran on the archive host. After that PR they get
the same 403.

### 1.3 `apps/web/lib/archive/server.ts` and `lib/archive/context.tsx` (carrying the mode)

Server side, `ARCHIVE_HEADER` (`x-tnm-archive`) and `HUB_HEADER`
(`x-tnm-hub`) name the request headers. `archiveSlug()`,
`isArchiveRequest()` and `isHubRequest()` read them through
`next/headers`. `membersPhrase(count, archive)` returns "Members"
without a number in archive mode.

The root layout (`app/layout.tsx`) reads both headers once per request
(the layout is `force-dynamic` so no mode is ever baked into static
HTML), looks the archive slug up in the registry, and mounts
`<ShellModeProvider>` with `{ mode, slug, name, endsUtc }`. It also
sets `data-archive="<slug>"` on `<html>` for CSS, and skips the magic
link consumer and profile completion gate in archive mode.

Client components read the context with `useShellMode()`,
`useArchive()` and `useHub()`. That is how the shell changes shape:

- `AppBar`: wordmark sub-label ("FWC 2026 archive", "RWC 2027 next",
  or the live label); no auth chip in archive or hub.
- `DesktopNav` and `AppMenuDrawer`: `forArchive()` in `nav-links` hides
  save, pools, syndicates, profile, API keys, bot arena and leaderboard
  links and relabels picks as "Bracket"; the drawer shows a short hub
  list plus an archive section in hub mode.
- `BottomNav`: `ARCHIVE_BOTTOM_NAV_TABS` (Home, Bracket, Results,
  Standings) in archive mode.
- `AppShell`: the "Archived" banner under the app bar and the footer
  note in archive mode; the desktop nav is hidden on the hub.
- Page-level components (bracket builder, leaderboard, picks grid,
  share pages, widget, arena stats) hide saves, joins, CTAs and raw
  counts when `useArchive()` is true.

## 2. Data each mode reads

- **Archive home** (`app/archive/page.tsx`): the registry entry for
  the slug (podium, percentage stats, trademark line),
  `lib/archive/final-standings.ts` (top ten by score from game.db for
  the tournament id, names from the syndicate membership and auth
  tables, shown as rank and percent correct only) and
  `lib/archive/results-bracket.ts` (official results from
  `match_results`). The team list and fixtures are currently the FIFA
  2026 files (`data/fifa-wc-2026/teams.json`, `loadFixtures2026`), so
  the page is FWC-specific until a second archive needs it.
- **Hub** (`app/hub/page.tsx`): `upcomingTournament()` for the hero,
  `archivedTournaments()` for the cards, `CF-IPCountry` to prefill the
  country, and the register-interest form, which posts to
  `/api/v1/register-interest` (SQLite table `register_interest` in
  game.db, mirrored to HighLevel with the tag `<slug>_interest`).
- **Live**: everything the app always read. Nothing in the registry
  feeds fixtures, teams or scoring; those come from the bracket engine
  data and the game service as before.

## 3. Playbook: taking Rugby World Cup 2027 live

The registry flip changes routing only. The app's own tournament
content (fixtures, teams, bracket engine data, the `/world-cup-2026`
route family, scoring in the game service) is separate work and must
be in place first.

1. In `registry.ts`, set the `rwc-2027` entry's `status` to `"active"`.
   From the next request `activeTournament()` is non-null, so step 5
   of the middleware never runs: play serves the live app, `/` is the
   app home, `/i/<code>` is handled by `app/i/[code]/page.tsx` as
   before, and nothing redirects to the archive.
2. Decide what happens to register-interest. With no `upcoming` entry
   the route returns 409 and the hub page renders without the hero.
   Either leave `/hub` as a dead end (it is still reachable by URL in
   live mode) or add a redirect for `/hub` in the live branch.
3. Update the labels that are still hard-coded to FWC 2026 in
   `apps/web`: the `AppBar` sub-label fallback and the `AppMenuDrawer`
   section label, the `metadata` title template in `app/layout.tsx`,
   the `FWC2026` defaults in the OG routes under `app/api/og/`
   (bracket-birdseye, bracket-poster, leaderboard, syndicate), and the
   `HUB_ALLOWED_PREFIXES` static folder `/rwc2027/` if the hub art
   moves.
4. Update the marketing site (`apps/marketing`, static Astro): the
   "Coming next" card in `Hero.astro`, the header CTA in
   `Header.astro`, the next-tournament line in `Footer.astro`, and the
   archive pages. Rebuild with
   `OPENAPI_SKIP_LIVE=1 systemd-run --user --scope -p MemoryMax=3G pnpm run build`
   from `apps/marketing`; nginx serves `dist` directly.
5. Build `apps/web` in a worktree, merge, then on the main checkout
   pull, build under `systemd-run --user --scope -p MemoryMax=4G`, and
   `systemctl --user restart tournamental-web`. Deploys are Tim's call.
6. Verify from the box (loopback, with the Host header):

```bash
# live: no rewrite, no hub header, 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: play.tournamental.com' http://127.0.0.1:3300/
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: play.tournamental.com' http://127.0.0.1:3300/leaderboard
# archive unchanged: 302 home on a blocked path, 403 on a write
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: fwc2026.tournamental.com' http://127.0.0.1:3300/leaderboard
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Host: fwc2026.tournamental.com' http://127.0.0.1:3300/world-cup-2026
```

Expected today (hub mode) for the first two lines: `200` for `/` (the
rewrite is internal) and `302 https://fwc2026.tournamental.com/leaderboard`.
After the flip the second line becomes `200` with no redirect.

## 4. Playbook: archiving a finished tournament

When RWC 2027 is over and the next one is announced:

1. In `registry.ts`, set the finished entry to `"archived"`, give it
   an `archiveHost` (for example `rwc2027.tournamental.com`), the
   podium, `finalScoreline` and percentage-only `stats`. Add the next
   tournament as `upcoming`. With nothing `active`, play becomes the
   hub again automatically.
2. Add DNS and tunnel ingress for the new archive host per docs/22.
   Until the ingress exists the hostname does not reach the process.
3. Add alias hosts, if any, to `ARCHIVE_ALIAS_HOSTS` in the middleware.
4. Generalise what is still FWC-specific: the archive page's team and
   fixture imports, the final-standings query if the schema differs,
   the hard-coded "FWC 2026 archive" link in `AppMenuDrawer`
   `HUB_ARCHIVE_LINKS`, the bottom-nav tab targets, and the marketing
   site's archive pages and menu.
5. The hub's fallback redirect goes to the **last** archived entry, so
   keep the array in chronological order.

## 5. Checks before you call it done

- Run the host-mode tests: `node_modules/.bin/vitest run __tests__/platform`
  from `apps/web` in a worktree (PR #335; 83 cases covering every
  branch above). Add a case for any new host or prefix.
- Curl the four lines in section 3 and the alias:
  `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Host: wc2026.tournamental.com' http://127.0.0.1:3300/`
  should print `301 https://fwc2026.tournamental.com/`.
- Load `/`, `/world-cup-2026` and `/s/<any pool>` on the archive host
  in a browser and confirm no sign-in, save or join control is shown
  and no raw player count appears.
- On the hub, submit the form with your own address only and confirm
  the row in `register_interest` and the HighLevel contact.

## 6. Things that are easy to get wrong

- The archive 403 covers the Next process only. Bracket saves that go
  straight to the game service (port 3360) are refused there after
  kickoff, not by this middleware.
- `activeTournament()` is evaluated per request at the edge; there is
  no cache to clear. A registry change still needs a build and a
  restart because the file is compiled into the middleware bundle.
- Keep the registry free of Node imports. One `node:` import breaks
  the edge build of the middleware.
- `play.localhost` and `<slug>.localhost` give you the hub and archive
  modes in local development without touching DNS.
- The rate limiter on register-interest is in memory per process; a
  restart resets it.
