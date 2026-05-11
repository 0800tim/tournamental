/**
 * @tournamental-plugin/example-hello-scorer
 *
 * The smallest plausible scorer plugin. Awards a flat 10 points for
 * every correctly predicted match outcome (home_win / draw / away_win).
 *
 * Use as a copy-paste template, fork the directory, rename, change the
 * scoring function, ship. The `plugin.json` is the manifest the core
 * picks up at boot; `default export` returns the factory.
 *
 * See `docs/16-game-modes-and-scoring.md` for the production scoring
 * rules. This example is intentionally dumber so it reads in 60
 * seconds.
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
    perPrediction[pred.matchId] = {
      points,
      base: points,
      multipliers: {},
    };
  }

  const breakdown: PointsBreakdown = { total, perPrediction };
  return breakdown;
};

const plugin: ScorerPlugin = {
  label: "Hello scorer (10pt-per-correct)",
  modes: ["bracket"],
  score,
};

export default function factory(_ctx: PluginContext) {
  return { scorer: plugin };
}
