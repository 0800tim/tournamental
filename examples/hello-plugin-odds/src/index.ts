/**
 * @tournamental-plugin/example-hello-odds
 *
 * The smallest plausible oddsSource plugin. Given a `matchId`, derives a
 * deterministic triplet of implied probabilities for (home_win, draw,
 * away_win) from a cheap hash. No network. No state. No keys.
 *
 * Use as a copy-paste template, fork the directory, point
 * `fetchProbabilities` at a real feed, ship. The `plugin.json` is the
 * manifest the core picks up at boot; `default export` returns the
 * factory.
 *
 * Production odds sources live under `apps/odds-ingest/src/sources/`
 * and blend live Polymarket + Odds API data (docs/12, docs/29). This
 * example is intentionally dumber so it reads in 60 seconds.
 */

import type {
  OddsSample,
  OddsSourcePlugin,
  PluginContext,
} from "@tournamental/plugin-sdk";

const plugin: OddsSourcePlugin = {
  label: "Hello odds (deterministic-synthetic)",
  id: "hello-odds",

  async fetchProbabilities(matchId: string): Promise<OddsSample | null> {
    const [home, draw, away] = syntheticProbabilities(matchId);
    return {
      matchId,
      outcomes: { home_win: home, draw, away_win: away },
      fetchedAtMs: Date.now(),
      stalenessSeconds: 0,
      providerUrl: `https://example.invalid/odds/${matchId}`,
    };
  },
};

/**
 * Deterministic 3-way probabilities that sum to 1.0 ± 1e-9. Replace
 * with a real feed call when adapting this template.
 */
export function syntheticProbabilities(
  matchId: string,
): readonly [number, number, number] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < matchId.length; i++) {
    h ^= matchId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const a = ((h & 0xffff) / 0xffff) * 0.7 + 0.15;
  const b = (((h >>> 16) & 0xffff) / 0xffff) * 0.7 + 0.15;
  const sum = a + b + 0.5;
  return [a / sum, b / sum, 0.5 / sum] as const;
}

export default function factory(_ctx: PluginContext) {
  return { oddsSource: plugin };
}
