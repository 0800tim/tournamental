/**
 * Deterministic mock leaderboard generator.
 *
 * Real leaderboard data won't exist until kickoff (2026-06-11). Until
 * then, the marketing surfaces need to show *something*, but it must
 * be visibly draft. This module is the single source of truth for that
 * placeholder data. Swap `mockLeaderboardMembers` for a real fetch
 * (e.g. `fetchLeaderboard(syndicateSlug)`) when the API ships; the
 * `<Leaderboard>` component shape is intentionally identical to what
 * we expect from the real endpoint.
 *
 * Scoring model (Tim 2026-06-04): the live game scores 1 point per
 * correctly predicted match outcome — no odds-based multipliers, no
 * partial credit. Demo leaderboards now reflect that contract: a row's
 * `points` is the number of correct picks (0..matchesPlayed), and the
 * UI renders it as "X/Y" so visitors don't think we're using a
 * different system before launch. The mock pretends the tournament is
 * roughly halfway through, see {@link DEMO_MATCHES_PLAYED}.
 *
 * Determinism contract:
 *   mockLeaderboardMembers("x", 50) === mockLeaderboardMembers("x", 50)
 *   for all renders, processes, and snapshot tests.
 */

import { MOCK_NAMES } from "./names";
import { pickInt, seededRng, shuffle } from "./rng";

/**
 * Match-progress the demo pretends we're at. FIFA WC 2026 runs 104
 * matches over the tournament; 54 puts us roughly midway through (end
 * of round of 32, start of round of 16). Picked deliberately so the
 * top row reads "48/54" rather than "281 pts", which used to mislead
 * visitors into thinking we score by odds.
 */
export const DEMO_MATCHES_PLAYED = 54;

export interface MockMember {
  /** Stable hash of name+country, usable as a React key. */
  readonly id: string;
  /** Display handle, always prefixed with "@". */
  readonly handle: string;
  /** ISO-3 country code. */
  readonly country: string;
  /** Emoji flag for inline rendering. */
  readonly flag: string;
  /** 1-indexed leaderboard rank. */
  readonly rank: number;
  /** Correct picks so far (0..matchesPlayed). Rendered as "X/Y" in
   *  the UI alongside a per-leaderboard matchesPlayed denominator. */
  readonly points: number;
  /** Position change vs the previous round (positive = climbed). */
  readonly movement: number;
  /** Optional badge surfaced as a chip on the row. */
  readonly badge?: "pundit" | "creator" | "syndicate-owner";
  /** Days the member has placed a pick in a row. */
  readonly streakDays?: number;
}

function memberId(handle: string, country: string): string {
  // Deterministic, short, unique enough for keys.
  return `${handle.replace(/^@/, "")}-${country}`.toLowerCase();
}

/**
 * Generate `count` mock members for the given syndicate slug (or `null`
 * for the global leaderboard). The points curve is a 1/√rank decay
 * with the top ~5 ranks compressed into tight gaps (5–15 pt) so the
 * top of the leaderboard reads as competitive.
 *
 * @param syndicateSlug stable seed; same slug → same leaderboard.
 * @param count         number of rows to generate, capped at MOCK_NAMES.length.
 */
export function mockLeaderboardMembers(
  syndicateSlug: string | null,
  count: number,
): MockMember[] {
  const seed = syndicateSlug ?? "global-leaderboard";
  const rng = seededRng(seed);
  const cap = Math.min(count, MOCK_NAMES.length);

  const pool = shuffle(MOCK_NAMES, rng).slice(0, cap);

  // Binary-pick scoring: top entrant is at roughly 85-91% accuracy
  // (5-8 misses out of DEMO_MATCHES_PLAYED), and each subsequent rank
  // either ties or drops 1-2 correct picks. The 30%-ish chance of a
  // zero drop produces realistic clusters of ties near the top — the
  // pattern Tim asked for ("48/54, 48/54, 47/54 …").
  const matchesPlayed = DEMO_MATCHES_PLAYED;
  const topCorrect = matchesPlayed - pickInt(rng, 5, 8);
  // Floor a tail entrant at ~30% accuracy so the gap from top to tail
  // is plausible without the chart turning into a row of zeros.
  const floorCorrect = Math.max(1, Math.round(matchesPlayed * 0.3));
  let running = topCorrect;
  const members: MockMember[] = pool.map((person, idx) => {
    const rank = idx + 1;
    if (rank > 1) {
      // Drop distribution: 30% tie, 55% -1, 15% -2. Tightens ranks at
      // the top, accelerates the decay further down where the running
      // counter is already near the floor.
      const roll = rng();
      const drop = roll < 0.3 ? 0 : roll < 0.85 ? 1 : 2;
      running = Math.max(floorCorrect, running - drop);
    }
    const points = running;

    // Movement: mostly +/-3, occasional bigger jump, zero ~20% of rows.
    const mRoll = rng();
    let movement = 0;
    if (mRoll < 0.2) movement = 0;
    else if (mRoll < 0.6) movement = pickInt(rng, -3, 3);
    else movement = pickInt(rng, -7, 8);

    let badge: MockMember["badge"];
    // Sprinkle pundits/creators/owners across the top half so the badge
    // column is visibly populated without being noisy.
    if (rank === 1) badge = "syndicate-owner";
    else if (rank % 9 === 2) badge = "pundit";
    else if (rank % 7 === 3) badge = "creator";

    return {
      id: memberId(person.handle, person.country),
      handle: person.handle,
      country: person.country,
      flag: person.flag,
      rank,
      points,
      movement,
      badge,
      streakDays: pickInt(rng, 1, 14),
    };
  });

  return members;
}

/**
 * Convenience helper for "what does row N look like?", exposed so the
 * bracket builder's compact rail can show just the top 10 without
 * repeating the slice logic.
 */
export function mockTopN(syndicateSlug: string | null, n: number): MockMember[] {
  return mockLeaderboardMembers(syndicateSlug, n);
}
