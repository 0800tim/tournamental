# hello-plugin-scorer

The thinnest possible scorer plugin: awards 10 points for every correct
match outcome, 0 otherwise. ~50 lines of TypeScript. Use as a
copy-paste template.

## What it shows

- Minimum viable [`plugin.json`](plugin.json) manifest.
- The `ScorerPlugin` interface from
  [`@tournamental/plugin-sdk`](../../packages/plugin-sdk).
- A `default export` factory pattern the core's plugin loader expects.
- A real vitest test that runs the scorer against fixture data — proves
  your plugin works before you ship it.

## Run the test

```bash
pnpm install                                            # at repo root
pnpm --filter @tournamental-plugin/example-hello-scorer test
# Expect: 1 test passing.
```

## Hacking on it

Things you might do next:

- **Confidence multiplier.** `ScorerPrediction` carries a 1–5
  confidence. Multiply the base by that.
- **Long-shot bonus.** `marketImpliedAtLock` is the odds the market
  gave the outcome at lock time. Award `(1 - p) * 50` for correct
  picks where `p < 0.25`.
- **Stage weighting.** Predictions at the final are worth more than
  group stage. The production scorer at
  [`packages/bracket-engine/src/scoring.ts`](../../packages/bracket-engine/src/scoring.ts)
  does this; copy the weight table.
- **Penalty for missed picks.** Currently silent on missed matches.
  Could deduct 5.

Each is a 10-line change to `score()`. Ship one as a PR; the reviewer
agent has a scorer-plugin checklist.

## Submitting

The PR template asks: which extension point, what game-mode(s),
what's the fixture under test, and your Drips list (if you opt-in to
the contributor revenue split). See
[`docs/19-open-source-and-contributor-revenue.md`](../../docs/19-open-source-and-contributor-revenue.md).

## License

Apache 2.0.
