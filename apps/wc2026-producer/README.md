# wc2026-producer

Tournamental 2026 FIFA World Cup match-stream producer scaffold.

## Status

Scaffold only. Two modes are wired (replay / live) but neither emits real
spec messages yet. Both depend on data that does not yet exist:

- **replay-mode** needs a richer historic-match catalogue keyed by
  `(team_a, team_b, date)`. Today only the 2022 AR-FR final stream exists
  (in `apps/statsbomb-replay/`), so any fixture falls back to that.
- **live-mode** needs a signed live data partner. The interface is in
  `src/live-mode.ts`; a concrete adapter replaces `UnconfiguredLiveAdapter`
  once a partner is selected. See that file for a partner shortlist.

The scaffold's only job today is to load `data/fifa-wc-2026/fixtures.json`
as the source of truth for what 2026 matches exist, and validate that the
producer can address them by `match_number`.

## Run

```bash
pnpm --filter wc2026-producer dev -- --list-fixtures
pnpm --filter wc2026-producer dev -- --mode replay --match-number 1
pnpm --filter wc2026-producer dev -- --mode live --match-number 1
```

## Test

```bash
pnpm --filter wc2026-producer test
```

## Plug-in points (when the data partner is signed)

1. Add a new file `src/adapters/<partner>.ts` implementing `LiveDataAdapter`.
2. Wire it into `src/index.ts` behind `--mode live --partner <id>`.
3. Update `src/live-mode.ts` to remove `UnconfiguredLiveAdapter` from the
   default-export path; keep the class for tests.
4. Add integration tests under `tests/adapters/<partner>.test.ts` with
   recorded fixtures (no live network in CI).
