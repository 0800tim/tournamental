---
agent: stats-scraper-builder
status: complete
task: fill the _todo placeholders in apps/web/data/{team-form,head-to-head,team-stats}.json with a real scraper
docs: docs/50-stats-scraper.md, AGENT-PROMPTS.md
branch: feat/team-form-h2h-stats-scraper
---

# Stats scraper — session notes

## Plan

Three JSONs were left as `_todo` placeholders by previous agents:

1. `apps/web/data/team-form.json` — last-5 W/D/L per FIFA team (FormDots).
2. `apps/web/data/head-to-head.json` — historical H2H per pair (HeadToHeadPill, /match/[id]/preview).
3. `apps/web/data/team-stats.json` — season aggregates (Stats tab).

Approach: build a TS-side scraper alongside the existing
`apps/wc2026-data/src/players/wikidata-scraper.ts`, mirroring its
pattern (mock + real backend, env-gated, polite throttling, on-disk
file cache, deterministic mock fixtures for CI).

## Sources picked

| Source         | Used for                | Backend gate                        |
| -------------- | ----------------------- | ----------------------------------- |
| FBref          | Last-N team match logs  | `WC2026_DATA_BACKEND=real`          |
| Wikidata SPARQL | Historical H2H meetings | `WC2026_DATA_BACKEND=real`          |
| StatsBomb open | Curated historical fallback | always-on (local file)         |
| API-Football v3 | Season aggregates      | `WC2026_DATA_BACKEND=real` + `APIFOOTBALL_KEY` |
| Mock           | CI default + sparse fallback | always-on                      |

All four real sources are env-gated so CI runs entirely offline.

## Decisions

- **Schema compatibility kept**: existing readers
  (`apps/web/lib/team-form.ts`, `apps/web/lib/head-to-head.ts`,
  `apps/web/app/match/[id]/preview/_lib/match-data.ts`) reach into the
  `teams` / `pairs` sub-trees and ignore extra top-level keys, so the
  new `version` / `lastUpdated` / `source` fields don't break the web
  app. Verified via `pnpm --filter @vtorn/web typecheck`.

- **StatsBomb wins date conflicts**: `mergeH2HMeetings` drops any
  remote (Wikidata) row whose date matches a local (StatsBomb) row.
  Otherwise the AR-FR final showed up twice in the demo (statsbomb 3-3
  + a mock 1-2 stub on the same date).

- **Source-label honesty**: previous bug had the file labelling itself
  `fbref` even when the primary source was the mock. Fixed by counting
  provenance off the row-level `source` field rather than off "did the
  primary source return data". Now the H2H file label uses ≥10 %
  coverage as a threshold for naming a single source.

- **API-Football missing-key path**: the real backend silently falls
  back to mock when the env key is absent (rather than throwing). This
  matches the `WC2026_DATA_BACKEND=real` pattern from the player
  scraper — opt-in real-data, never break the runner on missing
  secrets.

- **FBref squad IDs hand-curated**: each of the 48 confirmed WC2026
  teams gets its FBref squad slug in `FBREF_SQUAD_IDS`. CUW (Curaçao)
  has no current FBref page, so its slot is empty and the runner
  always falls back to mock for that one team.

- **Cache path + TTL**: 24h per-key file cache at
  `apps/wc2026-data/data/stats-cache/<kind>/<key>.json`. Gitignored.
  `--force-refresh` invalidates per-call.

## Things that didn't co-operate

- **Wikidata's H2H query is recall-light**: international friendlies
  often aren't modelled as `Q16466010 (football match)` items, so the
  real backend will return empty for many pairs. That's expected; the
  StatsBomb local corpus + the existing curated stub fill those gaps.
  Documented in `docs/50-stats-scraper.md`.

- **API-Football team-id mapping**: the v3 endpoint requires a
  numeric API-Football team id per team. We don't have those yet, so
  the source falls through to the mock baseline for every team in the
  default config. Adding the per-code `apiTeamIds` is a follow-up.

## Verification

- `pnpm --filter @vtorn/wc2026-data-scripts test` — 147 tests pass
  (including 37 new stats-scraper cases + 9 CLI cases).
- `pnpm typecheck` (workspace-wide) — clean.
- Manual sample: `--kind=form --teams=ARG,FRA --force-refresh --dry-run`
  runs end-to-end without errors.
- End-to-end run produced:
  - 48 teams in `team-form.json` (~2.5k lines).
  - 1128 pairs in `head-to-head.json` (~36k lines), with the AR-FR
    2022 final showing the correct curated provenance + penalties.
  - 48 teams in `team-stats.json` (~530 lines), all curated baseline
    values preserved for ARG/FRA/BRA/ENG/GER/ESP.

## PR

[#TBD] feat(wc2026-data): stats scraper for team-form, H2H, season aggregates

## Refs

- `docs/50-stats-scraper.md`
- `apps/wc2026-data/src/stats/`
- `apps/wc2026-data/scripts/scrape-stats.ts`
- `apps/wc2026-data/tests/stats-scraper.test.ts`
- `apps/statsbomb-replay/data/historical-meetings.json`
