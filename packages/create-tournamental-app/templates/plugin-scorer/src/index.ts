/**
 * __PKG_NAME__
 *
 * Scaffolded scorer plugin. Edit the score() function below to
 * implement your scoring rules, then re-run `pnpm test`.
 *
 * See:
 *   - examples/hello-plugin-scorer (the reference this was scaffolded from)
 *   - docs/16-game-modes-and-scoring.md (production scoring rules)
 *   - packages/plugin-sdk/src/index.ts (the ScorerPlugin contract)
 */

import type {
  PluginContext,
  PointsBreakdown,
  ScoreFn,
  ScorerPlugin,
} from "@tournamental/plugin-sdk";

const POINTS_PER_CORRECT = 10;

const score: ScoreFn = (bracket, results, _opts) => {
  let total = 0;
  const perPrediction: Record<
    string,
    { points: number; base: number; multipliers: Record<string, number> }
  > = {};

  for (const pred of bracket.predictions) {
    const actual = results.actual[pred.matchId];
    const correct = actual !== undefined && actual === pred.outcome;
    const points = correct ? POINTS_PER_CORRECT : 0;
    total += points;
    perPrediction[pred.matchId] = { points, base: points, multipliers: {} };
  }

  const breakdown: PointsBreakdown = { total, perPrediction };
  return breakdown;
};

const plugin: ScorerPlugin = {
  label: "__PKG_DISPLAY__",
  modes: ["bracket"],
  score,
};

export default function factory(_ctx: PluginContext) {
  return { scorer: plugin };
}
