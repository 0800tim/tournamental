/**
 * Mock points-over-time series for a given member, used by the inline
 * sparkline component in `<Leaderboard>` and the larger
 * `<StageProgressChart>`.
 *
 * 6 weeks × 6 match-days/week = 36 datapoints by default, but the
 * `length` argument lets the caller ask for fewer (e.g. 7 for an
 * inline sparkline).
 */

import { pickInt, seededRng } from "./rng";

export interface PointsStamp {
  /** Day index from the tournament start (0-based). */
  readonly t: number;
  /** Cumulative points at that time. */
  readonly points: number;
}

/**
 * Generate a smoothly-rising cumulative-points series.
 *
 * Curve: starts low, climbs roughly linearly with the per-step delta
 * drawn from a positively-skewed band so the line *almost* always
 * climbs, with the occasional zero-delta day (no pick made).
 */
export function mockPointsHistory(seed: string, length = 36): PointsStamp[] {
  const rng = seededRng(`pts:${seed}`);
  const out: PointsStamp[] = [];
  let total = pickInt(rng, 0, 12);
  for (let t = 0; t < length; t++) {
    const noPickRoll = rng();
    let delta = 0;
    if (noPickRoll < 0.1) {
      delta = 0;
    } else if (noPickRoll < 0.85) {
      delta = pickInt(rng, 4, 11);
    } else {
      // Occasional big-payoff day (a long-shot that landed).
      delta = pickInt(rng, 14, 22);
    }
    total += delta;
    out.push({ t, points: total });
  }
  return out;
}

/**
 * "Pool average" series — for the stage-progress chart's lower line.
 * Derived from the same seed plus a damping factor so the average
 * always lags the headline member's score by a believable margin.
 */
export function mockPoolAverage(seed: string, length = 36): PointsStamp[] {
  const member = mockPointsHistory(seed, length);
  return member.map((p) => ({ t: p.t, points: Math.round(p.points * 0.72) }));
}
