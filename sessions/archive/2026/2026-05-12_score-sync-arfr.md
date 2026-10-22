# 2026-05-12 — Score-sync fix for AR-FR 2022 replay

Status: complete. PR: fix/match-score-sync-arg-fra-2022.

## What broke

Tim's pre-launch screenshot showed the scoreboard reading **0-0 at clock
86:39** on `https://app.tournamental.com/match/fifa-wc-2022-final-arg-fra-2022-12-18`.
By that point in the AR-FR final the score should be **2-2** (Mbappé
81' equaliser). The match-stats panel showed 1 shot, 0 fouls France, 1
yellow each — far too sparse for 86' of natural play, which was the
tell that the user had **scrubbed forward** rather than watched at 1×.

## Root cause

`packages/spec-client/src/manifest.ts` — on a user-initiated timeline
seek, the manifest driver reset its event cursor to the first event
at-or-after the new playhead. Any events with `t` strictly less than
the new playhead but greater than the old playhead were **skipped
entirely** — never re-emitted to the store. `event.score_change` lives
in that gap when the scrub jumps past goals, so the scoreboard stayed
on the pre-scrub score.

Secondary: `packages/spec-client/src/store.ts` — `EVENT_RING_SIZE`
was 64. The AR-FR manifest has ~1400 events; by stoppage time goal
events were evicted and the Scorers panel ran empty.

PR #132 (centred scoreboard polish) did not touch either file — the
bug pre-dates #132 but is more visible because the centred scoreboard
is the dominant HUD element.

## The fix

1. **Driver** (`packages/spec-client/src/manifest.ts`): the
   `subscribeSeek` callback now re-emits `match.init`, resets the event
   cursor to 0, drains every event with `t <= playhead`, then emits a
   state frame at the new playhead. Direction-agnostic — works for
   forward AND backward scrubs.

2. **Store** (`packages/spec-client/src/store.ts`):
   `applyMessage(match.init)` is now a **full reset** (preserves only
   `status`). This is what makes "re-emit init then re-drain events"
   idempotent. Side-benefit: WS reconnects that re-send init now reset
   stale state instead of accumulating it.

3. **Ring buffer**: `EVENT_RING_SIZE` 64 → 4096. Covers a full AR-FR
   match plus extra-time and pens with headroom. `computeMatchStats`
   is O(events) so the cost is irrelevant on a one-match buffer.

## Tests

Five new vitest cases in
`apps/web/__tests__/manifest-driver.test.ts`:

- Scoreboard reads 2-2 after a forward scrub to 86:39 (the exact
  screenshot repro).
- Scoreboard tracks every AR-FR ground-truth scoreline across a sweep
  of forward scrubs: 1-0 @ 25', 2-0 @ 37', 2-1 @ 81', 2-2 @ 82', 3-2
  @ 109', 3-3 @ 119'.
- Scoreboard returns to 0-0 after a backward scrub to t=0.
- Shootout score follows the playhead forward + backward (4-2 at end,
  0-0 active=false after seeking back to mid-regulation).
- Scorers panel retains early goals after a full-match scrub (ring
  buffer never evicts them).

All 15 manifest-driver tests pass; `apps/web` suite green at 765/765.
`tsc --noEmit` clean on both `apps/web` and `packages/spec-client`.
Producer side untouched — `apps/statsbomb-replay` pytest still 10/10.

## What I didn't touch

- Cosmetic HUD changes from PR #132. Visuals identical, just the
  underlying data is now correct.
- StatsBomb event mapping in `apps/statsbomb-replay/src/statsbomb_replay/`.
  The NDJSON manifest already contains all 6 `event.goal` +
  `event.score_change` pairs at the right timestamps — the producer
  was always correct.
- The synthetic AR-FR fixture in `packages/spec-client/src/synthetic.ts`.
- 2026 WC matches.

## Next steps

- Merge after CI passes — launch is tomorrow.
- Consider future: a similar fix may be needed for WS mode if
  reconnects are common (the new `match.init` reset behaviour means a
  WS source could leverage the same re-emit-init pattern for
  resync-after-disconnect, but that's not on the critical path).
