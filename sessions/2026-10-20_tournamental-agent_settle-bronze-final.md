# 2026-10-20, settle the bronze final

**Source**: code review of PR #343 (PR #355), finding 343-2: `matchResultBodySchema` in `apps/game/src/schemas.ts` listed every stage but `tp`, so the results poller's third-place play-off settlement (`infra/scripts/results-poller.sh` sends the fixture's stage) was rejected as a validation error. Unconfirmed on live data; the schema gap is certain.
**Branch**: `fix/game-settle-bronze-final` (worktree, from main).

## Change

`tp` added to the stage enum; a schema test covering every stage, an unknown stage and the optional case. `tests/schemas-match-result.test.ts` plus the existing `tests/match-result.test.ts` pass under `systemd-run --user --scope -p MemoryMax=3G`; eslint clean.

## Needs Tim

Merge, then on the main checkout `systemctl --user restart tournamental-game` (tsx serves the source, no build). If the FWC 2026 bronze final is missing from `match_results` in game.db, re-post it once through the poller or by hand; the archive home will then list it under Third place.
