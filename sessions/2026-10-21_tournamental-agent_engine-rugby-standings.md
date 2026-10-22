# 2026-10-21 · Rugby pool tables in the bracket engine

status: done
docs: docs/design/rwc2027-engine-readiness.md (gaps 1 and 2)

## Plan

Gaps 1 and 2 of the RWC 2027 engine readiness note: make the pool
points rule and the tiebreak chain data on the tournament, add try
counts to predictions, compute the rugby bonus points, and keep the
football output byte-for-byte the same. Pure functions with fixture
tests in `packages/bracket-engine`; the game service's strict pick and
result schemas accept the new optional fields so a rugby bracket can
reach the engine.

## Decisions

- Football stays the default when `sport` is absent, so every 2026
  fixture file and the 93 existing standings tests are untouched.
- The sort is one generic chain: points first, then each criterion on
  the block of teams still level, then the user's pick. FIFA's chain is
  expressed as `score_diff, score_for, h2h_table`, which reproduces the
  previous hard-coded order exactly.
- `h2h_winner` decides only between exactly two tied teams (World Rugby
  criterion a); three or more level teams move to points difference.
- Row fields keep the `goalsFor` / `goalDiff` names because a dozen UI
  and service files read them; rugby reads them as match points.
- Rugby league gets no preset: the IRL chain has not been checked, so a
  rugby league tournament must carry explicit `standings_rules` or the
  loader throws.

## Outcome

- `packages/bracket-engine`: 110 tests pass (17 new), tsc clean.
- `apps/game`: schema tests pass (3 new).
- Readiness note gaps 1 and 2 marked done; CHANGELOG and README updated.

## Needs Tim

- Confirm the RWC 2027 pool tiebreak chain against the published
  regulations (not found online on 2026-10-21); the preset carries the
  2023 chain. If it differs, set `standings_rules` in the RWC 2027 data.
- Gap 3 (R16 placement) still waits on the regulations.
