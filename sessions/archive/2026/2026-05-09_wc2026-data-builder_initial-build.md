# 2026-05-09 — wc2026-data-builder — initial build

**Status**: done

**PR**: pending push

## Goal

Ship the canonical 2026 FIFA World Cup dataset (`data/fifa-wc-2026/`),
the scrape script (`apps/wc2026-data/`), and the live-stream producer
scaffold (`apps/wc2026-producer/`) so the bracket-engine and live-replay
producer have a real dataset to consume the moment the tournament starts
on 11 June 2026.

## Reading

- `CLAUDE.md` — agent ops protocol, branch naming, commit signing.
- `CONTRIBUTING.md` — Conventional Commits + DCO sign-off.
- `packages/spec/src/index.ts` — wire contract for the producer scaffold.
- `apps/statsbomb-replay/` — pattern reference for `uv` Python project layout.
- `data/wc2022-final-players.csv` — schema reference for `players.json`.

## Plan

1. Create `data/fifa-wc-2026/` with `fixtures.json`, `teams.json`,
   `players.json`, `host-cities.json`, `_meta.json` plus JSON Schemas.
2. Build `apps/wc2026-data/` Python project (`uv`) with:
   - `canonical_fixtures.py` — offline, deterministic 104-match builder
     reflecting FIFA's published 2026 schedule.
   - `sources.py` — Wikidata SPARQL, FIFA HTML, Wikimedia adapters with
     polite-sleep, on-disk cache, graceful fallback.
   - `scrape.py` — CLI with `--dry-run`, `--source-only`, byte-deterministic JSON emit.
3. Build `apps/wc2026-producer/` TS scaffold:
   - `fixtures.ts` — loads `data/fifa-wc-2026/fixtures.json`.
   - `replay-mode.ts` — given a fixture, picks the closest historic match
     stream (today: AR-FR final fallback only).
   - `live-mode.ts` — `LiveDataAdapter` interface + `UnconfiguredLiveAdapter`
     stub with partner shortlist in comments.
4. Tests: ≥ 15 (target). Achieved 59 Python tests + 6 TS tests = 65.
5. CI workflow `.github/workflows/wc2026-data-refresh.yml` — weekly cron,
   manual dispatch, opens PR with diff via `peter-evans/create-pull-request`.

## Decisions

- **Canonical fixture data is hand-curated, not scraped**. FIFA's 2026
  schedule was released in February 2024 and is stable. Encoding it as
  Python data structures gives:
  - **Determinism**: same input → byte-identical JSON.
  - **Resilience**: works offline, in CI, without FIFA's site being up.
  - **Reviewability**: a human can diff the source if FIFA changes a venue.
  The scrape script *also* fetches FIFA + Wikidata for refreshes (manager
  changes, withdrawals, kit colours), but the 104-match grid is local.
- **Team list = 40 confirmed + 8 placeholders** (`UPO1-4`, `IPO1-2`,
  plus `WAL` and `ITA` flagged provisional). UEFA play-offs and FIFA
  intercontinental play-offs run March 2026; the script will refresh
  team codes once draws complete.
- **Players.json is a pre-tournament seed**, not final squads. The 26-man
  rosters are due ~late May 2026 per FIFA's deadline. Each player has
  `pre_tournament: true` so consumers know to refresh.
- **Producer is a scaffold**: live-mode is intentionally a throwing stub.
  The point is to lock the `LiveDataAdapter` interface so a future
  partner integration is hours, not days.
- **Wikimedia for imagery, never FIFA**: copyright-safe per the brief.
  Each player photo URL preserves the contributor + licence in
  `attribution`.
- **Determinism via JSON write helper**: sorted keys, 2-space indent,
  trailing newline, UTF-8. Tested explicitly — two runs produce
  byte-identical `fixtures.json`.

## Coverage

- ✅ `data/fifa-wc-2026/fixtures.json` — all 104 matches (72 group + 32 KO).
- ✅ `data/fifa-wc-2026/teams.json` — 48 entries (40 confirmed, 8 placeholders).
- ✅ `data/fifa-wc-2026/players.json` — 120 starter players across 28 nations.
- ✅ `data/fifa-wc-2026/host-cities.json` — 16 cities, all three host countries.
- ✅ `data/fifa-wc-2026/_meta.json` — sources, attribution, refresh policy.
- ✅ `data/fifa-wc-2026/schema/*.schema.json` — JSON Schema for all five files.
- ✅ `apps/wc2026-data/` scrape script with `--dry-run`, `--source-only`,
  caching, graceful fallback.
- ✅ `apps/wc2026-producer/` TS scaffold with replay-mode + live-mode stub.
- ✅ 65 tests (59 Python + 6 TS).
- ✅ Weekly refresh workflow.

## Deferred

- **Final squads**: announced ~late May 2026 by each FA. Run
  `wc2026-scrape` again after that date to refresh `players.json`.
- **Play-off team codes**: UEFA + FIFA intercontinental play-offs in
  March 2026. Replace `UPO1-4` and `IPO1-2` placeholders post-March.
- **Final FIFA venue map**: knockout-stage venue assignments are
  encoded from FIFA's Feb-2024 release; FIFA may move single matches
  for broadcast reasons. The weekly cron catches changes.
- **Real player photo URLs**: the seed has Wikidata Q-numbers but
  `image_url=null`. A second-pass enrichment step (Wikidata → Commons
  image lookup) is planned but not in this PR.
- **Bracket-engine integration**: the `feat/bracket-prediction-engine`
  branch the brief referenced doesn't yet exist on `origin`. The data
  shape is documented in `data/fifa-wc-2026/schema/`, ready when that
  branch lands.

## Open questions

- **Live data partner**: see `apps/wc2026-producer/src/live-mode.ts`
  comments for the shortlist (Sportradar > Stats Perform / OPTA > FIFA
  direct > Wyscout). Recommend Sportradar for v0.1: most mature feed,
  cleanest mapping to `@vtorn/spec`. Final pick depends on cost +
  contractual exclusivity discussions.
- **Stadium tournament names**: FIFA bans corporate stadium names during
  the tournament (e.g. "Mercedes-Benz Stadium" → "Atlanta Stadium"). I
  included both fields. Confirm with marketing which we display in the
  HUD.
- **Match-number authority**: FIFA's published match numbers (1-104)
  are what we use. Some third parties number knockouts differently
  (e.g. starting QFs at 1). Confirm spec aligns before bracket-engine
  consumes it.

## Next

- Push branch + open PR.
- Loop in the bracket-engine builder once their worktree lands.
- After UEFA + IPO playoffs finish (late March 2026), the cron will
  pick up the new team codes automatically.
