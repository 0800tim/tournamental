---
name: scoring-rules
description: Compute Tournamental scoring for any bracket + result set, or implement a new scorer plugin.
license: Apache-2.0
---

# When to use this skill

You're working in the Tournamental repo and need to:

- Predict the score impact of a hypothetical result ("if BRA win in
  the QF, my score goes up by 38").
- Implement a new scorer plugin (alternative scoring formula for a
  custom syndicate).
- Debug why a leaderboard ranking looks off — most causes are
  scoring multipliers misapplied.
- Explain to a user how a specific point award was calculated.

# How to do it

## Read the canonical scoring rules first

The full rule-set lives at
[`docs/16-game-modes-and-scoring.md`](../../docs/16-game-modes-and-scoring.md).
Skim sections "Base points", "Stage multiplier", "Long-shot bonus",
and "Mode multipliers" before answering.

## Use `@tournamental/bracket-engine` for any real calculation

```ts
import { scoreBracket } from "@tournamental/bracket-engine";

const result = scoreBracket({
  bracket: { /* ScorerBracket from @tournamental/plugin-sdk */ },
  results: { actual: { /* matchId → outcome */ } },
});
console.log(result.total, result.perPrediction);
```

The function is pure, deterministic, no I/O. Safe to call from a
worker, an MCP tool, an Astro page, or a unit test.

## For a new scorer plugin

Fork [`examples/hello-plugin-scorer/`](../../examples/hello-plugin-scorer/).
It is the minimum viable plugin — 50 lines, one passing test.
Rename, change the `score()` function, ship.

The contract is documented at
[`packages/plugin-sdk/src/index.ts`](../../packages/plugin-sdk/src/index.ts)
under `ScorerPlugin`. Key constraints:

- Pure function. No DB, no fetch, no time.
- Returns `PointsBreakdown` with `total` and `perPrediction`.
- Declare which `modes` you handle in the manifest. The core
  routes brackets to scorers based on mode.

## For a hypothetical-result query

The MCP server exposes this as a public tool:

```bash
curl -sS https://mcp.tournamental.com/v1/tool/get_match_path \
  -H 'content-type: application/json' \
  -d '{"bracketGuid":"d64a707a-...","hypothesis":{"QF1":"BRA"}}'
```

Returns the score delta + which downstream picks become locked
to the new path.

# Acceptance checks

- `pnpm --filter @tournamental/bracket-engine test` is green
  before and after your change.
- If you added a scorer plugin, `pnpm --filter
  @tournamental-plugin/<your-plugin-name> test` is green with at
  least one fixture showing total + perPrediction.
- If the user asked a score-prediction question and you used the
  MCP tool, the answer is the literal number returned by the
  tool, not a paraphrase.

# Boundaries

- DO NOT modify `packages/spec/` — the scoring types are part of
  the cross-agent contract.
- DO NOT change the production scorer's coefficients without an
  orchestrator-approved spec-change PR. Custom coefficients belong
  in a plugin, not in `packages/bracket-engine/src/scoring.ts`.
