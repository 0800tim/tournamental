# Registry-driven tournament chrome

> Design note, 2026-10-17. Describe only, no code. Goal: make "take Rugby World Cup 2027 live" a one-line change in `apps/web/lib/tournaments/registry.ts` by removing every place where the app chrome and the marketing site still spell out FWC 2026 or RWC 2027 by hand. Source: the hand-edit list in `docs/runbooks/tournament-host-modes.md` (PR #338), section 3, steps 3 and 4.

## Where we are

The registry already decides routing: `activeTournament()`, `upcomingTournament()`, `archivedTournaments()`, `tournamentBySlug()` and `archiveForHost()` drive `middleware.ts`, and the hub and archive pages read `name`, `shortName`, `startsUtc`, `endsUtc`, `hostCountry`, `winner` and `trademarkLine` from the entry. That is the pattern to copy. What does not read the registry yet is the chrome around those pages, and the marketing site, which cannot import from `apps/web` at all.

## One principle

Every surface asks the registry for "the tournament this request is about" and never names one itself. Which entry that is depends on the shell mode the middleware already stamps on the request:

| Shell mode | Entry | Today's helper |
| --- | --- | --- |
| live (play host, something active) | the active entry | `activeTournament()` |
| hub (play host, nothing active) | the upcoming entry, plus the archive list for links | `upcomingTournament()`, `archivedTournaments()` |
| archive (an archive hostname) | the entry for that host | `archiveForHost(host)` or `tournamentBySlug(slug)` |

The `ShellModeProvider` in `app/layout.tsx` is the natural carrier. Today it holds `mode`, `slug`, `name` and `endsUtc` for the archive case only. Extending it to carry a small summary of the current entry for all three modes (slug, code, name, shortName, routeBase, archiveHost, plus the upcoming entry's summary in hub mode) lets every client component below it stop guessing.

## New fields the registry needs

The entries carry dates, names and results. The chrome also needs:

- `code`: the short badge used in titles and OG images, `FWC2026` and `RWC2027`. Today it is typed by hand in the layout title, the AppBar and four OG routes.
- `routeBase`: the path family the tournament lives under, `/world-cup-2026` today. The dock, the desktop nav and the drawer all hard-code it; a rugby entry would need `/rwc-2027` or similar.
- `artDir`: the public folder for the hub and hero art, `/rwc2027/` today. The hub allow-list in the middleware names it; deriving it from the slug (`/${slug}/`) removes the constant.
- `aliasHosts`: the extra hostnames that 301 to the archive host (`wc2026`, `2026wc`). The middleware's `ARCHIVE_ALIAS_HOSTS` map becomes a fold over the entries.
- `marketingArchivePath`: the retro page on tournamental.com, `/archive/fwc-2026`.
- `openingVenue` and `openingCity`: for the footer's "kicks off in Perth on 1 October 2027" line.
- `registerHref`: where "register interest" sends people while the entry is upcoming, `https://play.tournamental.com/#register`. Could stay a convention (play origin plus `#register`) rather than a field.

Everything else the chrome shows (dates, host country, trademark line, winner) is already there.

## Each hand edit, and how it reads from the registry instead

### 1. AppBar sub-label (`components/shell/AppBar.tsx`)

Today: `archive ? "FWC 2026 archive" : hub ? "RWC 2027 next" : "FWC2026"`.

Instead: read the current entry from the shell context. Archive mode shows `${shortName} archive`, hub mode shows `${upcoming.shortName} next`, live mode shows `code`. The three strings become one template each and never name a tournament. The i18n keys stay; the interpolated value comes from the entry.

### 2. AppMenuDrawer labels (`components/shell/AppMenuDrawer.tsx`)

Today: `HUB_ARCHIVE_LINKS` hard-codes one "FWC 2026 archive" link to `https://fwc2026.tournamental.com/`; the hub section label says "Rugby World Cup 2027 ™"; the live and archive section label says "FIFA World Cup 2026 ™".

Instead: the archive links are `archivedTournaments()` mapped to `{ label: `${shortName} archive`, href: `https://${archiveHost}/` }`, newest first, so a second archive appears without a code change. The hub section label is `upcoming.name` (the name already carries the trademark symbol). The live and archive section label is `current.name` with the " · Archive" suffix kept for archive mode. Note the hub drawer's "What's next" and "Register interest" rows are not tournament-specific and stay as they are.

### 3. Layout title (`app/layout.tsx`)

Today: a static `metadata` export with `default: "Tournamental · FWC2026, Predict the matches that matter"` and `template: "%s · Tournamental · FWC2026"`.

Instead: a `generateMetadata()` that reads the same request headers the layout already reads to pick the shell mode, then builds the title from the entry: live uses `code`, hub uses `${upcoming.shortName} next` (or just "Tournamental"), archive uses `${shortName} archive`. The description and OG default image follow the same switch. This is the one change that moves a static export to a dynamic one; the layout is already dynamic because it reads headers, so there is no caching cost.

### 4. OG image routes (`app/api/og/`)

Today: `bracket-birdseye`, `bracket-poster` and `leaderboard` default the `tournament` query parameter to `"FWC2026"`; `syndicate` defaults to `"World Cup 2026"` and prefixes its badge with `FWC2026 ·`; `bracket-birdseye` draws "My World Cup 2026."; `bracket` defaults the name to "World Cup 2026".

Instead: one helper beside the registry, say `ogTournament(searchParams)`, that returns `{ code, name, shortName }` for the requested tournament or, when the parameter is absent, for the active entry, falling back to the newest archived entry (so an OG image for the archive keeps working after the flip). The four routes replace their defaults with that call, the badge becomes `${code} ·`, and the poster line becomes `My ${shortName}.` or a per-entry `ogTagline` if the copy needs to differ per sport. Because the output is cached by URL, the code should also be part of the image's cache key, which it already is once it appears in the query string.

### 5. Navigation hrefs (`components/shell/nav-links.tsx`, `BottomNav.tsx`, `DesktopNav.tsx`)

Not on the runbook list but the same problem: Play, Schedule, Molecule and the archive "Bracket" entries all link to `/world-cup-2026…`. Instead: build the link lists from `routeBase` (`${routeBase}`, `${routeBase}/calendar`, `${routeBase}/molecule`) using the current entry from the shell context. The `matchPrefix` values derive from the same base. For the archive host, `forArchive()` keeps trimming the list as it does now.

### 6. Middleware constants (`middleware.ts`)

Two constants name a tournament: `ARCHIVE_ALIAS_HOSTS` (`wc2026` and `2026wc` to `fwc2026.tournamental.com`) and the `/rwc2027/` entry in `HUB_ALLOWED_PREFIXES`. Instead: fold `aliasHosts` from every archived entry into the map at module load, and compute the hub's art prefix from `upcoming.slug`. The behaviour, and the host-mode tests in PR #335, do not change.

### 7. Marketing site (`apps/marketing`)

The Astro site cannot import `apps/web/lib/tournaments/registry.ts` because they are separate workspace packages and the file sits inside the Next app. Two ways to share it:

- **Move the registry into a workspace package**, for example `packages/tournaments`, exporting the entries and the pure helpers, with no React and no Next imports. `apps/web` re-exports it from the current path so nothing else moves; `apps/marketing` imports it at build time like any other dependency. This is the recommended route: one source of truth, no network at build.
- Or expose it as `GET /api/v1/tournaments` on play and have the marketing build fetch it the way `scripts/build-openapi-index.mjs` fetches the OpenAPI bundle, with the same `OPENAPI_SKIP_LIVE` style escape hatch. Simpler to wire but it couples a static build to a live service.

With the package in place:

- **`Hero.astro`**: `NEXT_KICKER` ("Coming next · 1 Oct to 13 Nov 2027"), the heading, the hero art path and the register link all come from `upcomingTournament()` (dates formatted from `startsUtc` and `endsUtc`, art from `artDir`). The "Looking for the last one?" link comes from the newest archived entry's `archiveHost`. When nothing is upcoming the card renders nothing rather than stale copy.
- **`Header.astro`**: `archiveLinks` is `archivedTournaments()` mapped to `{ href: `https://${archiveHost}`, label: shortName }` plus the fixed "All archives" row; `PLAY_CTA_LABEL` becomes `Register for ${upcoming.shortName}` and the href the register convention; while something is active the CTA reads `Play ${active.shortName}` and links to play.
- **`Footer.astro`**: `NEXT_EDITION_LABEL` is built from `upcoming.name`, `openingCity` and `startsUtc`; the quick links list is built from the entries (upcoming register link, each archived entry's `marketingArchivePath`); the trademark paragraph is the concatenation of every entry's `trademarkLine`, so the rugby line appears the day the entry exists.
- **`/archive/index.astro`**: the cards (code, winner, scoreline, dates, app link, retro link) come from `archivedTournaments()`. The retro page itself (`fwc-2026.astro`) stays hand-written; it is editorial.

## What the flip then looks like

1. Edit the registry: set the rugby entry to `"active"` (and, when the time comes, the finished one to `"archived"` with its `archiveHost`, results and stats).
2. Rebuild `apps/web` and restart `tournamental-web`; rebuild `apps/marketing` so the static site picks up the same entry.

Still manual, and rightly so: the tournament's own data (fixtures, teams, bracket engine, scoring), the route family's pages, DNS and tunnel ingress for a new archive host, and the editorial retro page.

## Order of work

1. Add the fields to `TournamentEntry` and fill them for both entries. No behaviour change.
2. Extend `ShellModeProvider` to carry the current and upcoming summaries; switch AppBar, AppMenuDrawer and the nav link lists to it. Covered by the existing component tests once PR #344's render helper is in.
3. `generateMetadata()` in the layout and the OG helper.
4. Middleware constants from the entries (the PR #335 tests must stay green unchanged).
5. The workspace package move, then the three marketing components and the archive index.

Each step is a small PR that leaves `main` working; none of them needs to wait for RWC 2027 content.
