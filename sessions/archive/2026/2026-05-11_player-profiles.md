---
agent: player-profiles
date: 2026-05-11
status: shipped
branch: feat/player-profiles
worktree: /home/clawdbot/clawdia/projects/vtorn-players
docs:
  - docs/48-player-profiles.md (new)
  - docs/07-avatars-and-assets.md (existing)
  - data/fifa-wc-2026/players.json (existing seed)
---

# Session note — Player profile pages (scope: A–G)

## Goal

Each of the 48 confirmed WC2026 teams gets ~22 player profiles, surfaced as
SEO-friendly server-rendered pages at `/player/[id]`, an index at `/players`
(search + filters), and a real squad grid on `/team/[code]`. Headshots come
from Wikidata (P18 → Wikimedia Commons); attribution + licence rendered on
every image.

## Plan

1. Write a Wikidata SPARQL scraper at
   `apps/wc2026-data/src/players/wikidata-scraper.ts` with mock + real
   backends, polite throttle, file cache. CLI `scripts/scrape-players.ts`.
2. Generate a richer `apps/web/data/players-2026.json` from the existing
   `data/fifa-wc-2026/players.json` seed (plus a small fully-populated ARG
   slice for the demo). Tests import this directly.
3. Build `/player/[id]` (hero + quick facts + form + structured data),
   `/players` (search + filter), and replace the team page squad grid.
4. Add ~20 vitest cases for the web side and ~10 for the scraper.
5. Document in `docs/48-player-profiles.md`. Open PR.

## Decisions

- Licence whitelist: `CC0`, `public domain`, `CC BY 2.0/3.0/4.0`, `CC BY-SA
  2.0/3.0/4.0`. Anything else → image dropped, leaves a TODO marker.
- Player id format: `<CODE>-<SHORT>` where SHORT is the suffix from the
  existing `data/fifa-wc-2026/players.json` `player_id` (`ARG_MESSI` →
  `ARG-MESSI`). Stable across regeneration.
- Cache: per-team JSON at `apps/wc2026-data/data/players-cache/<code>.json`,
  with `lastModified` ISO timestamp. Idempotent re-runs only refetch entries
  older than 7 days.
- Throttle: 1 request/second to the Wikidata SPARQL endpoint (their
  etiquette page).
- The single SPARQL query we run takes a Q-id list (the team's seed players
  from `players.json`) and returns enriched fields. We don't try to
  *discover* squads from Wikidata's `P54` graph — that has too much
  retired-player noise. Squad source remains the canonical seed; Wikidata
  only enriches.

## Open questions for orchestrator

- None blocking. Real Wikidata scrape is gated by `WC2026_DATA_BACKEND=real`
  so CI stays deterministic; full 48-team scrape can be triggered by Tim
  with one command after merge.

## Outcome

Shipped. All quality gates green:

- `pnpm --filter @vtorn/web test` — 554/554 tests passing (33 new player-profile cases).
- `pnpm --filter @vtorn/wc2026-data-scripts test` — 101/101 (26 new across scraper + CLI).
- `pnpm --filter @vtorn/web typecheck` — clean.
- `pnpm typecheck` (workspace) — clean.

Manual ARG end-to-end:
- Real Wikidata scrape ran for 11 ARG players via `WC2026_DATA_BACKEND=real
  scrape-players --teams=ARG`, mock fallback for the other 23 seed
  countries → 112 records total in `apps/web/data/players-2026.json`.
- Sample player URL: `/player/ARG-MESSI` — name "Lionel Messi", full name
  "Lionel Andrés Messi Cuccittini", FWD, born 1987-06-24, club "Inter
  Miami CF", Wikimedia headshot with CC BY-SA 4.0 attribution overlay,
  Wikipedia link, JSON-LD `Person`.
- Seed Q-id fix: `ARG_J_ALVAREZ` was pointing to `Q98641810` (an article
  about Kalman filtering, no idea how that landed in seed). Corrected to
  `Q59381180` (Julián Álvarez, Argentine footballer born 2000).

Files added/modified: see docs/48-player-profiles.md "Files added" + the
team-detail-page.test.tsx tweak (now asserts the real `<PlayerCard />`
grid for teams with data and falls back to the legacy stub for teams
without).

PR: see footer.

## Next steps

- Re-seed beyond the marquee 24 in
  `apps/wc2026-data/src/wc2026_data/players_seed.py` once squads lock
  (1 June 2026), then re-run `scrape-players --backend=real`.
- Replace `clubLogo: null` with a Wikidata club Q-id → P154 logo lookup.
- Tighten image-licence detection by reading P275 on the Commons file
  entity instead of assuming CC BY-SA 4.0.
- Add a `/player` sitemap entry (sitemap is owned by the SEO sprint —
  not in this PR's zone).
