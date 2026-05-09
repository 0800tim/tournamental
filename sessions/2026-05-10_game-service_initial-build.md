# 2026-05-10 — game-service builder — initial build

**Task**: bring up `apps/game/` per docs/12 — bracket submission, admin
match-result settlement with rescoring, and top-100 leaderboards (global +
syndicate-scoped). Port 3360.

**Refs**:
- [docs/12 — odds and predictions](../docs/12-odds-and-predictions.md)
- [docs/22 — deployment and tunnels](../docs/22-deployment-and-tunnels.md)
- `packages/bracket-engine/src/score.ts` (canonical scoring)

## Plan

1. Scaffold `apps/game/` with the same Fastify shape as `apps/api/` and
   `apps/odds-ingest/` (helmet, cors, rate-limit, sensible).
2. SQLite (better-sqlite3) for persistence; migrations in
   `apps/game/migrations/0001_init.sql`.
3. Zod schemas mirror the `Bracket` / `MatchPrediction` shapes from
   `@vtorn/bracket-engine` so the route handlers reject malformed
   payloads with a 400 + structured `issues` array.
4. Match-result POST is admin-only (`Authorization: Bearer
   $GAME_ADMIN_TOKEN`). Re-scoring is a transactional walk over every
   bracket in the tournament; tagged TODO to switch to the docs/12
   ZSET-snapshotter pipeline at production scale.
5. Leaderboards cached in-process for 30s (`X-Cache: HIT|MISS` header for
   debugging). Cache invalidates on every match-result POST.
6. 30+ vitest cases covering: health, submit happy/edge cases, bracket
   retrieve, admin auth (missing/wrong/disabled), result-rescore, two
   leaderboards, syndicate isolation, scoring engine math, cache TTL.

## Decisions

- **Re-submit semantics**: a second `POST /v1/bracket/submit` for the
  same `(user_id, tournament_id)` overwrites the prior payload and zeros
  `score_total`; the next match-result POST recomputes. Rationale: the
  bracket is locked at tournament kickoff; before that the user can edit
  freely.
- **Knockout-prediction matching**: the existing `MatchPrediction` shape
  uses `outcome ∈ {home_win, draw, away_win}` even for knockouts. The
  recomputer treats a knockout pick as correct when the user's outcome
  label matches the actual outcome label, then scores via
  `scoreKnockoutMatchPrediction`. When the bracket UI moves to
  team-level knockout picks (TeamId-based), we'll widen this here in
  one place. Out of scope per the prompt.
- **Syndicate write surface**: added `POST /v1/syndicate/join` under
  the same admin-bearer guard so tests + the bot can register
  memberships without a separate side-channel. Reads are public via
  `/v1/leaderboard/:tid/syndicate/:sid`.
- **Port collision in docs/22**: noted but untouched per the prompt;
  fixed independently on `origin/main` while this branch was in flight
  (commit `87ec4df` moved odds-ingest to 3341). Rebased onto that and
  resolved the resulting tabular merge conflict by interleaving
  game-service (3360) between odds-ingest (3341) and affiliate-router
  (3370).

## Outcome

- 31 vitest cases pass; lint not configured (per prompt; pnpm -r
  --if-present skips it).
- typecheck clean.
- README documents every endpoint + curl examples.
- `.env.example` documents every env var with a sensible default.
- docs/22 updated: adds the `vtorn-game.aiva.nz` row + `apps/game` port
  3360 entry. Did not touch the unrelated 3340 collision.

## Status

complete — ready for review.
