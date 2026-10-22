# Verified-Pundit feature — initial build

- Agent: verified-pundit-builder
- Status: complete
- Branch: `feat/verified-pundit`
- Refs: docs/19 (open-source / contributor revshare), docs/16 (game modes / leaderboard)

## Plan (executed)

1. New game-service surface
   - `apps/game/migrations/0002_verified_pundit.sql` — `tournaments` (with `settled_at`) and `verified_pundit_records`.
   - `apps/game/src/store/db.ts` — store helpers for tournaments + pundit records.
   - `apps/game/src/pundit/compute.ts` — pure recompute (`recomputeVerifiedPundits`) + rollup helper. Writes `data/verified_pundit_v1.jsonl` audit lines on each settle.
   - `apps/game/src/routes/pundit.ts` — `GET /v1/users/:userId/pundit` (60s in-process cache, `public, max-age=60, stale-while-revalidate=120`) and admin `POST /v1/admin/tournaments/:id/settle`.
   - `apps/game/src/server.ts` — wires the new route, runs a quiet boot recompute (in-DB only, no JSONL).

2. Visual badge — shared, subtle
   - `apps/web/components/shared/PunditBadge.tsx` — gold tick with optional level chip. No animation. Hidden when `verified=false`.
   - `apps/web/lib/pundit.ts` — fail-open client fetch for `GET /v1/users/:userId/pundit`.
   - `apps/web/components/bracket/BracketBuilder.tsx` — header shows the badge when the local user is verified.
   - `apps/web/app/world-cup-2026/landing/_components/LeaderboardPreview.tsx` — preview rows render badges for the top two positions.

3. Social cards
   - `packages/social-cards/src/types.ts` — `CommonFooter` gains an optional `pundit` payload (canonical signal for future Drips revshare).
   - `packages/social-cards/src/cards/pundit-badge.ts` — shared satori bubble + level chip.
   - `packages/social-cards/src/layout.ts` — every card footer renders the badge when input includes `pundit`.
   - All seven card kinds pass `pundit` through to `cardFrame`.

4. Admin Customer-360
   - `apps/admin/components/PunditChip.tsx` — gold chip in the user header.
   - `apps/admin/lib/customer360.ts` — `fetchPunditStatus` + Customer-360 `pundit` field.
   - `apps/admin/app/(authed)/users/[id]/page.tsx` — chip next to the HumannessChip; Profile tab gets a "Verified Pundit" panel with levels + tournament pills.

## Tests

- `apps/game/tests/pundit.test.ts` — compute correctness (top-100, zero-score exclusion), multi-tournament `levels`, JSONL audit, endpoint shape, cache HIT/MISS, admin guard.
- `apps/web/__tests__/PunditBadge.test.tsx` — renders nothing for un-verified, exposes accessible tooltip + `data-pundit-levels`.
- `packages/social-cards/test/pundit-badge.test.ts` — OG and story footers contain the badge node + "Verified Pundit" marker.
- `apps/admin/__tests__/components/PunditChip.test.tsx` — chip visibility + level count.
- All existing tests still pass (game 61, admin 109, web 389, social-cards 80).

## Quality gates

- `pnpm typecheck` clean across @vtorn/game, @vtorn/web, @vtorn/admin, @vtorn/social-cards.
- `pnpm test --run` clean across all four projects.
- Game service boots and serves `/v1/users/:userId/pundit` with the documented headers.

## Future evolution (parked TODOs in PR body)

- Rolling 12-month qualifier window (lifetime today).
- Humanness-Score-weighted (docs/20) so bots can't earn the badge.
- Tournament-difficulty-weighted (entrant count + variance, see docs/30).
- Drips Network revenue-share hook for level >= N pundits (docs/19) — payouts intentionally not implemented in this PR.
- Snapshotter pattern from docs/12 for the per-tournament re-rank, replacing the current full-table scan when prod scale demands it.
