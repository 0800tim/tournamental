/**
 * Deterministic mock leaderboard generator.
 *
 * Real leaderboard data won't exist until kickoff (2026-06-11). Until
 * then, the marketing surfaces need to show *something* — but it must
 * be visibly draft. This module is the single source of truth for that
 * placeholder data. Swap `mockLeaderboardMembers` for a real fetch
 * (e.g. `fetchLeaderboard(syndicateSlug)`) when the API ships; the
 * `<Leaderboard>` component shape is intentionally identical to what
 * we expect from the real endpoint.
 *
 * Determinism contract:
 *   mockLeaderboardMembers("x", 50) === mockLeaderboardMembers("x", 50)
 *   for all renders, processes, and snapshot tests.
 */

import { MOCK_NAMES } from "./names";
import { pickInt, seededRng, shuffle } from "./rng";

export interface MockMember {
  /** Stable hash of name+country — usable as a React key. */
  readonly id: string;
  /** Display handle, always prefixed with "@". */
  readonly handle: string;
  /** ISO-3 country code. */
  readonly country: string;
  /** Emoji flag for inline rendering. */
  readonly flag: string;
  /** 1-indexed leaderboard rank. */
  readonly rank: number;
  /** Total points this round. */
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

  // Top rank gets a high anchor (~280); from rank 2 onwards we apply a
  // mild 1/√rank decay with a per-row jitter so the chart looks alive.
  const topPoints = 278 + pickInt(rng, -3, 5);
  const members: MockMember[] = pool.map((person, idx) => {
    const rank = idx + 1;
    let points: number;
    if (rank === 1) {
      points = topPoints;
    } else if (rank <= 3) {
      // Tight gaps at the very top — 5 to 15 pts behind the previous.
      const gap = pickInt(rng, 5, 15);
      points = topPoints - gap * (rank - 1);
    } else {
      // 1/√rank decay with jitter.
      const decay = Math.round((topPoints * 0.9) / Math.sqrt(rank));
      const jitter = pickInt(rng, -4, 6);
      points = Math.max(20, decay + jitter);
    }

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
 * Convenience helper for "what does row N look like?" — exposed so the
 * bracket builder's compact rail can show just the top 10 without
 * repeating the slice logic.
 */
export function mockTopN(syndicateSlug: string | null, n: number): MockMember[] {
  return mockLeaderboardMembers(syndicateSlug, n);
}
