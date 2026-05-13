/**
 * Deterministic mock odds generator.
 *
 * Inputs: home/away world rank + a stable per-match seed (the matchNo).
 * Output: W/D/L probabilities that sum to 1.0 and are stable across
 * page reloads but plausibly different per match.
 *
 * Why deterministic: the chip is on every group/knockout row; if the
 * numbers flickered every render the page would look broken. We want
 * the *same* fake odds for the same match every time, so a user can
 * hover, click away, hover again, and see the same percentages. The
 * real API replaces this once the odds-ingest service is live, with no
 * client code change.
 *
 * No third-party deps. Pure functions, easy to test.
 *
 * Algorithm:
 *   - rankDiff = awayRank - homeRank.
 *   - Stronger home (negative diff -> oh wait, lower rank number = better team)
 *     so a *positive* rankDiff (away rank > home rank, i.e. home is the
 *     better team) increases homeWin probability.
 *   - Base homeWin centred at 0.5, slope 0.012 / rank-pt, clamped.
 *   - drawP shrinks with the absolute rank gap (mismatched games draw
 *     less often).
 *   - Add a small per-match noise (deterministic from `matchNo`) of
 *     +/- 4pp on homeWin so adjacent matches look different.
 *   - Normalise so home + draw + away = 1.0.
 */

import type { MatchOdds, OddsSource } from "./types";

/**
 * Stable 32-bit hash of a string. Used as a seed for per-match noise.
 * Any FNV-1a-flavoured hash is fine; this one is small and well-known.
 */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Deterministic noise in [-1, 1] from a string seed. */
function noise(seed: string): number {
  // Two LCG-ish steps so the value isn't trivially correlated with the
  // string length.
  const h = hash32(seed);
  const v = ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
  return v * 2 - 1;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export interface MockOddsInput {
  readonly matchNo: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  /** world ranking, lower number is better. */
  readonly homeRank: number;
  readonly awayRank: number;
  /** When true, omit the draw row (knockout match). */
  readonly noDraw?: boolean;
  /** Override timestamp for tests. */
  readonly nowIso?: string;
  /** Override source for tests. */
  readonly source?: OddsSource;
}

export function mockMatchOdds(input: MockOddsInput): MatchOdds {
  const { matchNo, homeTeam, awayTeam, homeRank, awayRank, noDraw } = input;

  // Sanity: ranks are positive integers, but defend against bad input.
  const hr = Number.isFinite(homeRank) && homeRank > 0 ? homeRank : 50;
  const ar = Number.isFinite(awayRank) && awayRank > 0 ? awayRank : 50;
  // Positive diff = home team is better.
  const diff = ar - hr;

  // Slope: ~0.012 per rank point; capped so a #1-vs-#48 match still
  // leaves some plausible probability for the underdog.
  const slope = 0.012;
  // Per-match noise on home %, ±4 percentage points.
  const homeNoise = noise(`home:${matchNo}`) * 0.04;
  // Per-match noise on draw shrinkage, ±1pp (so adjacent matches don't
  // all draw the exact same %).
  const drawNoise = noise(`draw:${matchNo}`) * 0.01;

  let homeP = clamp(0.5 + diff * slope + homeNoise, 0.05, 0.85);

  if (noDraw) {
    // Knockout match: just W/L, but bias the lean a little because
    // knockouts have ET + pens (more likely to settle on form).
    const sharpened = clamp(0.5 + (homeP - 0.5) * 1.1, 0.1, 0.9);
    return {
      matchNo,
      homeTeam,
      awayTeam,
      homeWin: round3(sharpened),
      draw: null,
      awayWin: round3(1 - sharpened),
      source: input.source ?? "mock-fifa-rank",
      updatedAt: input.nowIso ?? new Date().toISOString(),
    };
  }

  // Group: drawP shrinks with rank mismatch.
  let drawP = clamp(0.27 - Math.abs(diff) * 0.005 + drawNoise, 0.10, 0.32);

  // Renormalise so home + draw + away = 1.
  let awayP = 1 - homeP - drawP;
  if (awayP < 0.05) {
    // Pull homeP down a bit so awayP has at least 5pp.
    const deficit = 0.05 - awayP;
    homeP = clamp(homeP - deficit, 0.05, 0.85);
    awayP = 1 - homeP - drawP;
  }
  if (awayP > 0.85) {
    homeP = clamp(homeP + (awayP - 0.85), 0.05, 0.85);
    awayP = 1 - homeP - drawP;
  }
  // Final renormalise to be exactly 1.
  const sum = homeP + drawP + awayP;
  homeP /= sum;
  drawP /= sum;
  awayP /= sum;

  return {
    matchNo,
    homeTeam,
    awayTeam,
    homeWin: round3(homeP),
    draw: round3(drawP),
    awayWin: round3(awayP),
    source: input.source ?? "mock-fifa-rank",
    updatedAt: input.nowIso ?? new Date().toISOString(),
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * Cheap fallback when we don't even have world ranks (e.g. the team
 * codes don't match the canonical teams.json). Returns a 50/25/25
 * baseline with a tiny per-match jitter so the chip still renders.
 */
export function mockOddsForUnknownTeams(matchNo: string, noDraw = false): MatchOdds {
  const j = noise(`unknown:${matchNo}`) * 0.03;
  if (noDraw) {
    const home = clamp(0.5 + j, 0.4, 0.6);
    return {
      matchNo,
      homeTeam: "",
      awayTeam: "",
      homeWin: round3(home),
      draw: null,
      awayWin: round3(1 - home),
      source: "mock-stub",
      updatedAt: new Date().toISOString(),
    };
  }
  const home = clamp(0.4 + j, 0.3, 0.5);
  const draw = 0.27;
  const away = 1 - home - draw;
  return {
    matchNo,
    homeTeam: "",
    awayTeam: "",
    homeWin: round3(home),
    draw: round3(draw),
    awayWin: round3(away),
    source: "mock-stub",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 14-day deterministic sparkline. Pure-function trend that drifts ±5pp
 * around the current point so the MarketTrend component renders
 * without an upstream history endpoint. Replaced by /history when live.
 */
export function mockOddsHistory(
  matchNo: string,
  current: MatchOdds,
  days = 14,
): { readonly points: ReadonlyArray<{ ts: string; homeWin: number; draw: number | null; awayWin: number }> } {
  const out: Array<{ ts: string; homeWin: number; draw: number | null; awayWin: number }> = [];
  const nowMs = Date.parse(current.updatedAt) || Date.now();
  for (let d = days - 1; d >= 0; d -= 1) {
    const t = nowMs - d * 86_400_000;
    const seed = `${matchNo}:${d}`;
    const drift = noise(seed) * 0.05;
    let h = clamp(current.homeWin + drift, 0.05, 0.85);
    let a = clamp(current.awayWin - drift * 0.8, 0.05, 0.85);
    let dr = current.draw === null ? null : clamp(1 - h - a, 0.05, 0.40);
    if (dr !== null) {
      const sum = h + dr + a;
      h /= sum;
      dr /= sum;
      a /= sum;
    } else {
      const sum = h + a;
      h /= sum;
      a /= sum;
    }
    out.push({
      ts: new Date(t).toISOString(),
      homeWin: round3(h),
      draw: dr === null ? null : round3(dr),
      awayWin: round3(a),
    });
  }
  return { points: out };
}
