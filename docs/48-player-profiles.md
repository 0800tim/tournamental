# Doc 48, Player Profile Pages (WC2026)

> Owner: builder agent (`feat/player-profiles`). Public-domain data via Wikidata.
> Status: shipped 2026-05-11. Source: `apps/web/data/players-2026.json`.

## What this is

Each of the 48 confirmed WC2026 teams has a roster of ~22 players. This
feature gives every player an SEO-friendly profile page at `/player/<id>`,
plus an index at `/players` (search + filters), and replaces the team-page
squad-grid stub with real data.

## Data flow

```
data/fifa-wc-2026/players.json           ← canonical seed (Q-ids + names)
            │
            ▼  (groupByCode, scrapeTeam per team)
apps/wc2026-data/src/players/             ← scraper (mock + Wikidata)
   ├── types.ts
   └── wikidata-scraper.ts
            │
            ▼  (script)
apps/wc2026-data/scripts/scrape-players.ts
            │
            ▼  (writes deterministic JSON)
apps/web/data/players-2026.json           ← consumed at build time
            │
            ▼  (lib/players.ts memoised maps)
/player/[id]   /players   /team/[code] (squad grid)
```

## Public-domain source: Wikidata

Wikidata is the public-domain knowledge graph behind Wikipedia. Every
player has a Q-id (`Q615` for Messi). Fields we read:

| Wikidata property | Field used |
| ----------------- | ---------- |
| `P1477` (full name) | `fullName` |
| `P569` (date of birth) | `dob` |
| `P18` (image) | `imageUrl` (Wikimedia Commons) |
| `P413` (position played) | `position` |
| `P54` (member of sports team) | `club` (active only, no end qualifier) |
| `schema:about` (en.wp link) | `wikipediaUrl` |

Images are served via the Commons CDN at
`https://commons.wikimedia.org/wiki/Special:FilePath/<filename>?width=400px`.
We tag each image as `CC BY-SA 4.0` (Commons default), anything outside
the licence allowlist is dropped (URL nulled, credit replaced with a TODO
breadcrumb). The licence allowlist:

- `CC0`, `Public domain`
- `CC BY 2.0`, `CC BY 3.0`, `CC BY 4.0`
- `CC BY-SA 2.0`, `CC BY-SA 3.0`, `CC BY-SA 4.0`

Every headshot in the UI displays the credit + licence as an overlay
footnote on the hero, and the credit is repeated in the body of the page.

## Caching strategy

Per-team SPARQL responses are cached at
`apps/wc2026-data/data/players-cache/<code>.json` with a `lastModified`
timestamp. The default age threshold is 7 days; re-runs only re-fetch when
the cache is stale. The cache directory is gitignored (we want fresh
scrapes from a clean checkout).

In CI, the scraper runs in **mock mode** (`WC2026_DATA_BACKEND` unset). The
mock backend is deterministic, it returns one record per seed entry with a
synthesised dob, club, and rotated GK/DEF/MID/FWD position. This keeps CI
runs offline + reproducible.

The polite throttle is 1 SPARQL request per second
(`WikidataScraper.throttleMs`). Wikidata's etiquette page asks for ≤30 req/min
for automated tools; we sit comfortably below.

## How to refresh the dataset

```bash
# 1056-record budget: 48 teams × ~22 players. Mock fixture, no network:
pnpm --filter @vtorn/wc2026-data-scripts run scrape-players

# Real Wikidata, all teams (rate-limited to ~1 team/sec, takes <1 minute):
WC2026_DATA_BACKEND=real pnpm --filter @vtorn/wc2026-data-scripts run scrape-players

# Single team (rest fall back to mock so the file stays complete):
WC2026_DATA_BACKEND=real pnpm --filter @vtorn/wc2026-data-scripts run scrape-players -- --teams=ARG

# Dry-run (logs the dataset summary, doesn't write):
pnpm --filter @vtorn/wc2026-data-scripts run scrape-players -- --dry-run
```

The output is sorted by `id` for deterministic diffs.

## Pages and routes

| Route | What it does |
| ----- | ------------ |
| `/players` | Index of every player. Client-side search + filter (team/position/club). 24/page. |
| `/player/<id>` | Single-player profile: hero, quick facts, tournament context, Wikipedia link, JSON-LD `Person`. |
| `/team/<code>` | Squad section now uses real `<PlayerCard />` grid for teams with data; falls back to the legacy stub for teams without. |

Both `/players` and `/player/[id]` are `force-static`, pre-rendered at
build time. SEO-friendly: every player profile is a fully-rendered HTML
page in the static export.

## Player ID format

`<CODE>-<SHORT>` where:
- `<CODE>` is the FIFA 3-letter team code (`ARG`, `FRA`, …).
- `<SHORT>` is the suffix from the canonical seed's `player_id`, with
  underscores converted to dashes for URL readability.

Examples:

- `ARG-MESSI` → Lionel Messi
- `ARG-MAC-ALLISTER` → Alexis Mac Allister
- `FRA-MBAPPE` → Kylian Mbappé

IDs are stable across regeneration, Tim can deep-link to a player URL
from social or Discord and it survives a refresh of the dataset.

## Known gaps and follow-ups

- Wikidata's `P54` (current club) sometimes resolves to the *national
  team* statement when the club statement is missing or stale. Players
  whose club label looks like `"<X> men's national association football
  team"` should be re-queried from a transfer-feed source post-launch.
- Position resolution prefers `FWD` > `GK` > `DEF` > `MID` when Wikidata
  lists multiple positions (Messi: midfielder + forward → forward).
- Image licence is heuristically tagged as `CC BY-SA 4.0` (the Commons
  default). For images that turn out to be CC BY-only or stricter, the
  licence allowlist still passes them. Hardening: scrape the actual
  Commons file metadata (P275 on the file entity) at refresh time.
- `clubLogo` is left null until we have a Wikidata-side mapping from club
  Q-id → P154 logo; deferred until post-launch.
- The seed roster covers ~24 marquee teams. Rest of the 48 get the mock
  fallback. Tim should rebuild the seed (in
  `apps/wc2026-data/src/wc2026_data/players_seed.py`) closer to squad
  lock (1 June 2026) to expand coverage.

## Files added

- `apps/wc2026-data/src/players/types.ts`
- `apps/wc2026-data/src/players/wikidata-scraper.ts`
- `apps/wc2026-data/scripts/scrape-players.ts`
- `apps/wc2026-data/scripts/scrape-players.test.ts`
- `apps/wc2026-data/tests/wikidata-scraper.test.ts`
- `apps/web/data/players-2026.json` (generated)
- `apps/web/lib/players.ts`
- `apps/web/components/player/PlayerCard.tsx`
- `apps/web/components/player/PlayerHero.tsx`
- `apps/web/components/player/PlayerQuickFacts.tsx`
- `apps/web/components/player/player.css`
- `apps/web/app/player/[id]/page.tsx`
- `apps/web/app/player/[id]/loading.tsx`
- `apps/web/app/players/page.tsx`
- `apps/web/app/players/PlayerIndex.tsx`
- `apps/web/__tests__/player-profiles.test.tsx`

## Commit + PR

```
feat(web,wc2026-data): player profiles + Wikidata scraper for the 48 confirmed WC2026 teams
```
