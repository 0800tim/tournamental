/**
 * Replay mode — given a 2026 fixture, produce a spec-conformant stream
 * by replaying a previous-tournament-equivalent match.
 *
 * Today this is a placeholder: the AR-FR producer (apps/statsbomb-replay/)
 * is the only real source of historic streams we have. When more 2022
 * matches are converted, we can pick the most-recent meeting between the
 * two 2026 teams and replay it. For now this lifts whatever AR-FR stream
 * is available and tags it with the chosen 2026 fixture's metadata.
 */

import type { Fixture } from "./fixtures.js";

export interface ReplayMatch {
  fixture: Fixture;
  /** Source identifier of the historic stream we're using as a placeholder. */
  source_match_id: string;
  /** Pointer to where the producer can fetch the source stream. */
  source_stream_uri: string;
  /** True if this is a perfect "same teams" replay vs a synthetic mock. */
  exact_match: boolean;
}

/**
 * Pick the best historic stream to replay for this 2026 fixture.
 *
 * Strategy:
 *   1. Same two teams in the most recent prior tournament → exact_match=true.
 *   2. Same teams ever → exact_match=true.
 *   3. Geographic / stylistic stand-in → exact_match=false.
 *   4. Mock-producer stream → final fallback.
 *
 * Today only step 4 is wired (AR-FR final). Step 1-3 require a richer
 * historic match catalogue keyed by (team_a, team_b, date).
 */
export function pickReplaySource(fixture: Fixture): ReplayMatch {
  // TODO(post-data-partner): replace with real historic-match lookup.
  return {
    fixture,
    source_match_id: "wc2022-final-arg-fra",
    source_stream_uri: "ws://localhost:18889/stream",
    exact_match: false,
  };
}
