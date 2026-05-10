# Stats Scraper — team form, head-to-head, season aggregates

> Owns three of the data files the web app consumes for /team/[code],
> /match/[id]/preview, the bracket H2H pill, and the FormDots component:
>
> - `apps/web/data/team-form.json` — last-N W/D/L per FIFA team.
> - `apps/web/data/head-to-head.json` — historical results per pair.
> - `apps/web/data/team-stats.json` — season-aggregate xG / poss / shots.
>
> Implementation lives in `apps/wc2026-data/src/stats/` and the CLI at
> `apps/wc2026-data/scripts/scrape-stats.ts`.

## Sources

| Source         | Coverage              | Confidence | Licence                                    | Network ? |
| -------------- | --------------------- | ---------- | ------------------------------------------ | --------- |
| **StatsBomb**  | Curated historical    | 1.0        | StatsBomb open-data partnership            | No (local file) |
| **FBref**      | Last-5 per team       | 0.9        | StatsBomb-partner; non-commercial OK       | Yes |
| **API-Football** | Season aggregates   | 0.85       | Paid API (free tier 100 req/day)           | Yes |
| **Wikidata**   | Historical match nodes | 0.8       | CC0                                        | Yes |
| **Mock**       | Deterministic fixture | 0.1        | n/a                                        | No |

The confidence weights surface in `SOURCE_WEIGHTS` (in
`src/stats/types.ts`) and are used by the aggregator to break ties when
two sources disagree.

### Rate-limit policy

| Source         | Throttle (default) | Notes                                                            |
| -------------- | ------------------ | ---------------------------------------------------------------- |
| FBref          | 1 req / 2 s        | Aggressive scraping triggers a 24h IP block. Honour Retry-After. |
| Wikidata SPARQL | 1 req / 1 s       | Endpoint enforces 60s/query timeout; queries are LIMIT 50.       |
| API-Football   | ~1 req / 1.1 s     | Free-tier ceiling is 30 req/min and 100 req/day.                 |

All real-backend requests carry a custom `User-Agent`:

```
Tournamental-WC2026-Scraper/0.1 (+https://vtorn.aiva.nz; ops@tournamental.com)
```

Override via `WC2026_USER_AGENT=…` if forking.

### Licensing notes

- **StatsBomb open-data** (used via the curated `apps/statsbomb-replay/data/historical-meetings.json`) is freely re-distributable for non-commercial use; we attribute back via `source: "statsbomb"` per row.
- **FBref** data is StatsBomb-partner. Non-commercial open-source use (this repo, Apache 2.0) is OK; commercial productisation needs a StatsBomb agreement first.
- **Wikidata** is CC0; redistribution is unrestricted but we link back via the source URL where available.
- **API-Football** is paid; the scraper silently skips it if `APIFOOTBALL_KEY` is not set in `.env`.

## Schemas

### `team-form.json`

```ts
interface TeamFormFile {
  version: 2;
  lastUpdated: string; // ISO
  source: "fbref" | "wikidata" | "statsbomb" | "mock" | "mixed";
  teams: Record<
    string, // FIFA 3-letter code
    Array<{
      date: string; // ISO YYYY-MM-DD
      opponent: string;
      home: boolean;
      goals_for: number;
      goals_against: number;
      result: "W" | "D" | "L";
      competition: string;
      source?: "fbref" | "mock";
    }>
  >;
}
```

The legacy stub used the same `teams` key + per-row shape; we add the
top-level `version` / `lastUpdated` / `source` fields. Existing readers
(`apps/web/lib/team-form.ts`, `apps/web/app/team/[code]/_lib/team-data.ts`)
read through to `teams` and ignore the extra keys.

### `head-to-head.json`

```ts
interface H2HFile {
  version: 2;
  lastUpdated: string;
  source: "wikidata" | "statsbomb" | "mock" | "mixed";
  pairs: Record<
    string, // alpha-sorted `${a}-${b}`, e.g. "ARG-FRA"
    Array<{
      date: string;
      homeCode: string;
      awayCode: string;
      homeScore: number;
      awayScore: number;
      competition: string;
      venue?: string;
      extraTime?: boolean;
      penalties?: string;
      source?: "wikidata" | "statsbomb" | "mock";
    }>
  >;
}
```

Up to 5 most-recent meetings per pair. StatsBomb rows take priority on
date collisions (see `mergeH2HMeetings`). The pair key is alphabetised
so `ARG-FRA === FRA-ARG`.

### `team-stats.json`

```ts
interface TeamStatsFile {
  version: 2;
  lastUpdated: string;
  season: string; // e.g. "2025-26"
  source: "apifootball" | "fbref" | "mock" | "mixed";
  teams: Record<
    string,
    {
      xg_per_match: number;
      xga_per_match: number;
      possession_pct: number;
      shots_per_match: number;
      shots_on_target_per_match: number;
      pass_accuracy_pct: number;
      form_rating: number;
      matches_sampled?: number;
      source?: "apifootball" | "fbref" | "mock";
    }
  >;
}
```

The aggregator preserves any **curated baseline** values from the
existing JSON for teams the live source can't enrich (so the demo
team-stats numbers for ARG/FRA/BRA aren't regressed when API-Football
runs out of credits).

## Confidence-score model

Each source contributes a static weight `w ∈ [0, 1]` from
`SOURCE_WEIGHTS`. When multiple sources cover the same data point:

- Two sources agreeing: `confidence = max(w_a, w_b)` plus a +0.05 bump
  capped at 1.0 (currently used only inside the aggregator's reconcile
  step; not surfaced on disk yet).
- Two sources disagreeing: the higher-weight source wins.
- Single source: `confidence = w_source`.

The on-disk `source` field is a single label summarising the dominant
provenance for the file as a whole:

- `mixed` — both real sources contributed.
- The named source — if ≥10 % of the rows came from it.
- `mock` — otherwise (CI default).

This keeps the file label honest without forcing every row to carry a
quantitative score.

## Refresh runbook

Default: mock backend, runs offline, perfect for CI.

```bash
# Refresh everything (mock; safe in CI):
pnpm --filter @vtorn/wc2026-data-scripts scrape-stats -- --kind=all

# Refresh form only:
pnpm --filter @vtorn/wc2026-data-scripts scrape-stats -- --kind=form

# Refresh H2H for a specific subset of teams (~28 pairs for 8 teams):
pnpm --filter @vtorn/wc2026-data-scripts scrape-stats \
  -- --kind=h2h --teams=ARG,FRA,BRA,ENG,GER,ESP,POR,USA

# Force-skip the 24h cache (useful after pushing a fix):
pnpm --filter @vtorn/wc2026-data-scripts scrape-stats \
  -- --kind=all --force-refresh
```

Real backend (opt-in; rate-limit aware):

```bash
# Live FBref + Wikidata (no API-Football):
WC2026_DATA_BACKEND=real pnpm --filter @vtorn/wc2026-data-scripts \
  scrape-stats -- --kind=form

# Full real-data run (needs the API-Football key in .env):
WC2026_DATA_BACKEND=real APIFOOTBALL_KEY=… pnpm --filter \
  @vtorn/wc2026-data-scripts scrape-stats -- --kind=all
```

The cache lives at `apps/wc2026-data/data/stats-cache/<kind>/<key>.json`
with a 24-hour default TTL. It's gitignored.

## Mock vs real backend

Default behaviour (no env vars):

- FBref, Wikidata, API-Football: all skipped.
- Per-source mock: deterministic per `(team, code)` so tests + screenshots stay stable.
- StatsBomb local corpus: always read from
  `apps/statsbomb-replay/data/historical-meetings.json` if present.
- Output JSONs: populated, marked `source: mock` (or `mixed` when
  StatsBomb local entries land in H2H).

`WC2026_DATA_BACKEND=real` opts into FBref + Wikidata. API-Football
*also* needs `APIFOOTBALL_KEY` to be set — otherwise that source
silently falls back to the mock so the runner doesn't fail on missing
secrets in non-prod environments.

CI runs the mock backend exclusively. There's no hidden network call
during the test suite — every backend is constructed with a stubbed
`fetch` impl + counted-call assertions verify it.

## Adding a new source

1. Add a new module under `src/stats/sources/` exporting both a `Mock*`
   class and a real implementation, plus a `create*` factory.
2. Update the aggregator (`aggregateForm` / `aggregateH2H` /
   `aggregateStats`) to weave in the new source.
3. Add a confidence weight to `SOURCE_WEIGHTS` in `types.ts`.
4. Tests live in `tests/stats-scraper.test.ts`.
5. Document the source's licence + rate-limit policy in this doc.

## Refs

- Code: `apps/wc2026-data/src/stats/` + `apps/wc2026-data/scripts/scrape-stats.ts`.
- Tests: `apps/wc2026-data/tests/stats-scraper.test.ts` + `apps/wc2026-data/scripts/scrape-stats.test.ts` (~50 cases).
- Consumers:
  - `apps/web/lib/team-form.ts` (FormDots).
  - `apps/web/lib/head-to-head.ts` (HeadToHeadPill).
  - `apps/web/app/match/[id]/preview/_lib/match-data.ts` (Stats tab).
- Cache: `apps/wc2026-data/data/stats-cache/` (gitignored, 24h TTL).
- Local corpus: `apps/statsbomb-replay/data/historical-meetings.json`.
