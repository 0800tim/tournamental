# @vtorn/game — Game service

Bracket-submission, match-settlement, and leaderboards backend for Tournamental.
Implements the game-side of [docs/12](../../docs/12-odds-and-predictions.md)
and consumes the canonical scoring engine from `@vtorn/bracket-engine`.

This service is the **write authority** between the bot/web clients and
the (eventual) snapshotter. For now it persists everything to SQLite via
better-sqlite3 — when traffic warrants we'll swap in the Redis ZSET +
flat-file pipeline from docs/12.

## Ports + tunnels

| Env  | Port  | URL                                       |
| ---- | ----- | ----------------------------------------- |
| dev  | 3360  | `https://vtorn-game.aiva.nz`              |
| prod | 3360  | `https://game.tournamental.com` (planned)       |

See [docs/22](../../docs/22-deployment-and-tunnels.md) for the full port
table and tunnel-add procedure.

## Endpoints

All routes return JSON. Caching policy follows the matrix in CLAUDE.md.

### `GET /healthz`

Liveness + DB probe.

```bash
curl -s http://localhost:3360/healthz
# { "ok": true, "db": "up" }
```

`Cache-Control: no-store`.

### `POST /v1/bracket/submit`

Submit a `Bracket` (per `@vtorn/bracket-engine`) for a `(user_id,
tournament_id)` pair. Returns a lock receipt. Re-submitting before the
tournament starts replaces the prior bracket and resets `score_total` to
0 — the next match-result POST recomputes it.

```bash
curl -s -X POST http://localhost:3360/v1/bracket/submit \
  -H 'content-type: application/json' \
  -d '{
    "tournament_id": "fifa-wc-2026",
    "user_id": "u_alpha",
    "bracket": {
      "bracketId": "bk_alpha",
      "matchPredictions": {
        "1": { "matchId": "1", "outcome": "home_win",
                "homeScore": 2, "awayScore": 1,
                "lockedAt": "2026-06-01T00:00:00Z" }
      },
      "groupTiebreakers": {},
      "knockoutPredictions": {},
      "version": 1
    }
  }'
```

Response (`201 Created` on first submit, `200 OK` on re-submit):

```json
{
  "bracket_id": "bk_alpha",
  "user_id": "u_alpha",
  "tournament_id": "fifa-wc-2026",
  "locked_at": "2026-05-10T12:34:56.789Z",
  "version": 1
}
```

`Cache-Control: private, no-store`.

### `GET /v1/bracket/me`

Fetch the user's locked bracket. The user is identified via `X-User-Id`
header (preferred) or `?user_id=` query param. `tournament_id` is
required.

```bash
curl -s 'http://localhost:3360/v1/bracket/me?tournament_id=fifa-wc-2026' \
  -H 'X-User-Id: u_alpha'
```

```json
{
  "bracket_id": "bk_alpha",
  "user_id": "u_alpha",
  "tournament_id": "fifa-wc-2026",
  "locked_at": "2026-05-10T12:34:56.789Z",
  "score_total": 0,
  "bracket": { "bracketId": "bk_alpha", "...": "..." }
}
```

Returns `404` if the user has no bracket for that tournament.
`Cache-Control: private, no-store`.

### `POST /v1/match/:match_id/result` (admin)

Records the actual outcome of a match and rescores every bracket that
predicted it. Requires `Authorization: Bearer $GAME_ADMIN_TOKEN`.

```bash
curl -s -X POST http://localhost:3360/v1/match/1/result \
  -H "Authorization: Bearer $GAME_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "tournament_id": "fifa-wc-2026",
    "outcome": "home_win",
    "homeScore": 2, "awayScore": 1,
    "stage": "group",
    "impliedAtLock": 0.42,
    "secondsSinceLock": 0,
    "windowSeconds": 2592000
  }'
```

Response:

```json
{
  "match_id": "1",
  "tournament_id": "fifa-wc-2026",
  "recorded_at": "2026-05-10T13:00:00.000Z",
  "rescored_brackets": 47
}
```

If `GAME_ADMIN_TOKEN` is unset, the route returns `503 admin_disabled`.
Bad token → `403 bad_token`. Missing header → `401 missing_bearer`.

### `GET /v1/leaderboard/:tournament_id`

Top-100 leaderboard for a tournament. Cached in-process for 30s by
default; the cache is invalidated whenever a match result is recorded.

```bash
curl -s http://localhost:3360/v1/leaderboard/fifa-wc-2026
```

```json
{
  "tournament_id": "fifa-wc-2026",
  "rows": [
    { "rank": 1, "user_id": "u_alpha", "score_total": 1842,
      "bracket_id": "bk_alpha" }
  ]
}
```

`Cache-Control: public, max-age=30, stale-while-revalidate=60`.
`X-Cache: HIT|MISS`.

### `GET /v1/leaderboard/:tournament_id/syndicate/:syndicate_id`

Top-100 within a syndicate. Same shape as the global leaderboard, scoped
to syndicate members only. Unknown syndicates return `200` with `rows: []`
rather than `404` — that's the snapshot pattern from docs/12.

```bash
curl -s http://localhost:3360/v1/leaderboard/fifa-wc-2026/syndicate/syn-alpha
```

### `POST /v1/syndicate/join` (admin)

Adds a `(user_id, syndicate_id)` membership row. The Telegram bot calls
this when a user joins via invite link. Idempotent.

```bash
curl -s -X POST http://localhost:3360/v1/syndicate/join \
  -H "Authorization: Bearer $GAME_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{ "user_id": "u_alpha", "syndicate_id": "syn-office" }'
```

## Storage

SQLite (better-sqlite3) at `apps/game/data/game.db`. Schema migrations
live in `apps/game/migrations/000N_*.sql` and run on startup; the
`_migrations` table tracks applied files so re-runs are idempotent.

Tables (see `migrations/0001_init.sql` for canonical DDL):

- `users(id, created_at)`
- `brackets(id, user_id, tournament_id, payload_json, locked_at, score_total)`
  with a unique constraint on `(user_id, tournament_id)`.
- `match_results(match_id, tournament_id, outcome, recorded_at)`.
- `syndicate_members(user_id, syndicate_id, joined_at)`.

## Scoring

Every match-result POST loads every recorded result for the tournament,
walks every bracket whose payload references the just-settled match, and
re-runs the per-match scoring functions from `@vtorn/bracket-engine` —
`scoreGroupMatchPrediction` for group fixtures, `scoreKnockoutMatchPrediction`
for R32+. The total is written back to `brackets.score_total`. The
leaderboard cache is then invalidated.

This is the simple O(N) recompute. Once we add the Redis ZSET layer
from docs/12 the recompute becomes a per-bracket diff push instead of a
full re-scan.

## Env vars

See `.env.example`. Only `GAME_ADMIN_TOKEN` has no sensible default —
admin routes are deliberately disabled until you set one.

## Local dev

```bash
# from repo root
pnpm install
pnpm --filter @vtorn/game dev
# → vtorn-game listening on http://0.0.0.0:3360
```

## Tests

```bash
pnpm --filter @vtorn/game test
```

Vitest runs single-fork (in-memory SQLite) so 30+ assertions run in
under a second.

## API reference

- Swagger UI (running service): [`/docs`](http://localhost:0/docs) — port from this service's bootstrap
- Static OpenAPI 3.0 spec (committed): [`docs/api/game.openapi.json`](../../docs/api/game.openapi.json)
- Index of every VTorn service API: [`docs/api/README.md`](../../docs/api/README.md)

To regenerate the static spec after a route change:

```bash
pnpm --filter @vtorn/game run dump-openapi
# or @tournamental/odds-ingest / @vtorn/wc2026-data-scripts
```
