# wc2026-data

Scrape + canonical fixture builder for the **2026 FIFA World Cup**. Emits
the JSON files under `data/fifa-wc-2026/`.

## What it produces

| File              | Contents                                              |
|-------------------|-------------------------------------------------------|
| `fixtures.json`   | All 104 matches with stage, kickoff, venue, slots     |
| `teams.json`      | 48 team entries (40 confirmed + 8 placeholders)       |
| `players.json`    | Pre-tournament seed rosters (final squads ~late May 2026) |
| `host-cities.json`| 16 host cities + stadium / capacity / tz / coords     |
| `_meta.json`      | Sources used, scrape date, refresh policy, attribution|

All output JSON is **byte-deterministic**: re-running with the same
upstream snapshot produces identical bytes (sorted keys, 2-space indent,
trailing newline, UTF-8).

## Run

```bash
cd apps/wc2026-data
uv sync
uv run wc2026-scrape                       # full refresh
uv run wc2026-scrape --dry-run             # plan only
uv run wc2026-scrape --source-only fifa    # just the FIFA schedule pages
uv run wc2026-scrape -v                    # verbose
```

## Sources

| Source         | License           | Used for                          |
|----------------|-------------------|-----------------------------------|
| FIFA.com       | © FIFA (data only)| Match schedule, venue assignment  |
| Wikidata SPARQL| CC0               | Team metadata, manager, ranking   |
| Wikimedia      | CC-BY / CC-BY-SA  | Flag SVGs + player photo URLs     |

We bundle **no copyrighted FIFA imagery**. Flags and player photos are
sourced from Wikimedia Commons with per-asset attribution preserved in
`_meta.json` and `players.json`.

## Resilience

- All upstream fetches are wrapped in a `try/except` and fall back to a
  cached snapshot in `apps/wc2026-data/.cache/` if the live request fails.
- A failed source is recorded in `_meta.json` under
  `sources[].failed=true` so downstream consumers know the data may be
  stale.
- The canonical fixture builder is **fully offline** — it draws from
  hand-curated structures in `canonical_fixtures.py` reflecting the
  publicly-released FIFA schedule. Online sources only refresh the team
  metadata + player photo URLs.

## Test

```bash
uv run pytest -q
```

## API reference

- Swagger UI (running service): [`/docs`](http://localhost:0/docs) — port from this service's bootstrap
- Static OpenAPI 3.0 spec (committed): [`docs/api/wc2026-data.openapi.json`](../../docs/api/wc2026-data.openapi.json)
- Index of every VTorn service API: [`docs/api/README.md`](../../docs/api/README.md)

To regenerate the static spec after a route change:

```bash
pnpm --filter @vtorn/wc2026-data run dump-openapi
# or @vtourn/odds-ingest / @vtorn/wc2026-data-scripts
```
