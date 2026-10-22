# 2026-05-09 — statsbomb-replay-builder — initial AR-FR producer build

**Status**: done

**PR**: pending push

## Goal

Ship `apps/statsbomb-replay/` end-to-end: a Python service that ingests StatsBomb open-data for the 2022 World Cup Final and emits a spec v0.1.1 stream over WebSocket / file / stdout, including penalty shoot-out events. Closes #3.

## Reading

- `CLAUDE.md` — agent ops protocol, AR-FR critical path.
- `CONTRIBUTING.md` — PR + commit conventions.
- `docs/02-spec.md` (via `packages/spec/src/index.ts`) — wire contract.
- `docs/11-historic-data-sources.md` — full design doc; coord helper, Hungarian assignment, penalty extension.
- `docs/05-mock-producer.md` — wire-protocol patterns (ws/file/sse/stdout shape).
- `AGENT-PROMPTS.md` § 1 + GH issue #3 — task body.
- StatsBomb open-data structure — competitions/matches/lineups/events/three-sixty.

## Plan

1. Resolve match: comp 43 / season 106 / 2022-12-18 → `match_id=3869685` (already verified).
2. Build the Python package layout under `apps/statsbomb-replay/` with `uv` + pyproject + lock.
3. Write `coords.py` (StatsBomb 120x80 → spec 105x68 pitch-centred metres) with team-orientation flip per period.
4. Write `loader.py` — read competitions, matches, lineups, events, three-sixty; resolve AR-FR.
5. Write `mapping.py` — convert lineups → MatchInit; events → spec EventMessages; emit penalty shoot-out events for period 5.
6. Write `state_synth.py` — interpolate state frames at 10Hz between freeze-frames using Hungarian assignment for non-actor IDs (use `scipy.optimize.linear_sum_assignment`).
7. Write `replay.py` CLI driver with `--match-id`, `--statsbomb-data`, `--time-scale`, `--out {ws,file,stdout}`, `--port`, `--path`.
8. Write `data/wc2022-final-players.csv` — hand-curated 22 starters + Wikidata Q-numbers + Commons image URLs (per doc 11).
9. Add `tests/` with at least one parsing-correctness pytest (fixed JSON in → expected spec message out).
10. Push branch, open PR with `Closes #3` and link to this note.

## Decisions

- **Framework / stack**: stdlib + `websockets` + `numpy` + `scipy` + `pydantic` (light validation only). No heavyweight football lib — `statsbombpy` is overkill for one match and adds httpx dep.
- **Coord-system flip**: applied at parse time. StatsBomb always orients in the attacking direction of the team in possession. Spec is fixed: team[0] (Argentina, home) defends -x, team[1] (France, away) defends +x. So when possessing team is Argentina, attacking direction = +x → no flip; when possessing team is France, attacking direction = -x → flip x and y around centre. *Why parse time*: avoids re-flipping during state-frame interpolation.
- **Player ID identity**: spec player IDs are `P_<statsbomb_id>` (e.g. `P_5503` for Messi). Stable per match, traceable to source.
- **Team IDs**: `ARG` (home, team[0]) and `FRA` (away, team[1]) — short, readable in HUD.
- **State frames**: emit at 10Hz from event-anchor positions. Between events <2s apart, lerp linearly. For event windows >5s, hold-position (no extrapolation). Ball follows pass/shot geometry.
- **Identity inference for non-actor freeze-frame entries**: use Hungarian assignment with cost = Euclidean distance to previous-frame positions. Initial seed comes from formation slots in Starting XI.
- **Penalty shoot-out**: period 5 events (Shot type=Penalty + GK Shot Faced/Penalty Saved) → `event.penalty_attempt`. Open shootout at first period-5 Half Start; close after the 9th attempt with Argentina winner.
- **Player photos**: per doc 11 we ship a `data/wc2022-final-players.csv` with curated Wikimedia Commons URLs. The avatar agent will also produce one but for the AR-FR demo this producer needs its own (orchestrator note: avatar agent hasn't shipped yet).
- **Pace**: at `--time-scale=10`, 150 minutes (regulation + ET + pens) plays in 15 wall-min, matches acceptance criterion.

## Open questions

- Whether `competition_stage` / `competition_round` should appear in MatchInit. Currently passing through `competition: "FIFA World Cup 2022 — Final"`.
- Should we emit `event.kickoff` for each restart from kickoff (post-goal, half-start)? Yes for the canonical first kickoff at t=0 plus each Half Start; mock-producer behaviour is "kickoff after each goal" but StatsBomb does not annotate this explicitly. Defer richer kickoff events to Phase 2.

## Outcome

What landed:

- `apps/statsbomb-replay/pyproject.toml` + `uv.lock` — uv-managed deps (numpy, scipy, websockets, pydantic; pytest/ruff/mypy in dev group).
- `src/statsbomb_replay/coords.py` — StatsBomb 120x80 → spec 105x68 metres mapper, with possession-orientation flip and an absolute (match-orientation) variant for 360 frames.
- `src/statsbomb_replay/loader.py` — JSON loader with raw.githubusercontent.com fallback so first-run users don't need a 2GB clone; the four needed files (~12 MB) are cached locally.
- `src/statsbomb_replay/photos.py` — CSV → `{sb_player_id: PlayerPhoto}` with Wikidata Q-numbers + Wikimedia Commons thumbnail URLs.
- `data/wc2022-final-players.csv` — hand-curated 22 starters (11 ARG + 11 FRA) per doc 11.
- `src/statsbomb_replay/mapping.py` — pure SB-event-dict → spec-message mapper. Covers Pass, Shot (+ Goal child), Foul Committed, Goal Keeper (saves), Substitution, Half Start/End, and period-5 Shot → `event.penalty_attempt`.
- `src/statsbomb_replay/state_synth.py` — anchor builder + 10Hz interpolator. Uses Hungarian assignment (`scipy.optimize.linear_sum_assignment`) on each anonymous 360 freeze-frame against the previous resolved frame, with formation-slot seeding at t=0. Shot freeze-frames (which include player IDs) provide the high-fidelity anchors.
- `src/statsbomb_replay/emitter.py` — top-level stream builder. Adds the bracketing the per-event mapper can't see in isolation: kickoff at t=0 + after each goal, `event.score_change` after every goal, `event.penalty_shootout_start`/`_end`, terminating `event.match_end`.
- `src/statsbomb_replay/replay.py` — CLI with `--match-id`, `--statsbomb-data`, `--time-scale`, `--out {ws,file,stdout}`, `--port`, `--path`, plus `--dry-run` and `--no-fetch`. WebSocket server paces by `t / time_scale`.
- `tests/test_mapping.py` — 11 parsing-correctness tests (timestamp parsing, ID conventions, coord flips, Pass/Shot/Goal/Penalty mapping, monotonic timing, period-5 offset, photo CSV).
- `tests/test_emitter_integration.py` — full-match integration test against the real AR-FR data when `STATSBOMB_DATA` is set.
- `IDEAS.md` — 6 producer-scoped follow-ups parked.

What's left / deferred:

- Multi-match support (hardcoded ARG/FRA team identity); parked in IDEAS.md.
- Bezier-arc ball trajectories on shots; current ball position is anchored frame-by-frame which is fine for HUD but linear for trajectories. Parked.
- StatsBomb `Tackle` / `Duel` event mapping to `event.tackle`; not on AR-FR critical path. Parked.
- `event.out_of_bounds` synthesis from restart sequences; deferred.
- mypy is configured but not strict; tightening can come later.

Tests: 10 passed (unit), 1 passed (integration with real AR-FR data, 38–48s). Ruff clean.

CLI smoke (real data): 75,657 messages built (1409 events, 74,247 state frames). Goal timestamps verified within seconds of the canonical timeline:

- 22'24 Messi pen → t=1,344,115 ms
- 35'22 Di María → t=2,122,648 ms
- 79'24 Mbappé pen → t=4,764,976 ms
- 80'59 Mbappé OP → t=4,859,027 ms
- 107'58 Messi → t=6,478,080 ms
- 117'05 Mbappé pen → t=7,025,190 ms

`event.score_change` carries 3-3 at t≈7,025,191 ms (= 117'05). `event.penalty_shootout_end` carries `winner=ARG, score={home:4, away:2}` at t≈7,558,883 ms (= 125'58). At `--time-scale=10` that's 12.6 wall-minutes — comfortably under the 15-min acceptance budget.

Decision worth noting: an earlier draft of the timing logic added `PERIOD_BASE_MS[5] = 7,200,000` on top of the StatsBomb `minute` field, but `minute` already cumulates from match start across all periods (the first penalty event has `minute=120, second=0`), so the base offset double-counted. Fixed by trusting `minute` directly across all periods — see commit history.

## Refs

- docs/11-historic-data-sources.md
- packages/spec/src/index.ts (SPEC_VERSION 0.1.1)
- Issue #3
