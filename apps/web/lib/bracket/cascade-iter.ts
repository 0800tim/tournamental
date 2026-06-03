/**
 * Iteratively cascade a user's per-match `Bracket` through the engine
 * so every knockout stage resolves, not just the first one (R32).
 *
 * Why this is its own helper:
 *
 *   `bracketToCascadeInput` deliberately emits `knockouts: []` (see
 *   the comment in cascade-bridge.ts). The cascade-engine's `winner`
 *   field for a knockout takes a TEAM code, but the user's outcome
 *   prediction is encoded as `home_win` / `away_win` against a slot
 *   whose team-id is itself produced by the cascade. So the consumer
 *   has to:
 *
 *     1. cascade once with no knockouts to resolve R32 home/away
 *        teams from group standings;
 *     2. overlay the user's R32 winner picks (now we know which team
 *        each `home_win` / `away_win` resolves to);
 *     3. re-cascade, which lets R16 slots resolve from R32 winners,
 *        and on the next pass QF, then SF, then F;
 *     4. stop when a pass adds no new resolved winners.
 *
 * The pattern was already in `enrich-members.ts.resolveChampionFromBracket`
 * (server-only). `ReadOnlyBracket` (client-only) needs the same logic
 * to render anything past R32, so this module is the shared
 * implementation, no DB or filesystem deps, safe on both edges.
 *
 * Tim 2026-06-04, after `/s/0800tim` showed R32 fully populated but
 * R16 / QF / SF / F all reading "TBD" on a fully-picked bracket.
 */

import {
  cascade,
  type Bracket,
  type BracketPrediction,
  type CascadedKnockout,
  type CascadedBracket,
  type Tournament,
} from "@tournamental/bracket-engine";

import { bracketToCascadeInput } from "./cascade-bridge";

/** Cap on iterations. FIFA 2026 has 5 KO rounds (R32, R16, QF, SF, F+TP),
 * so each round consumes one pass. 6 leaves a comfortable margin and
 * caps any pathological input. */
const MAX_PASSES = 6;

/**
 * Run the cascade iteratively until every knockout the user picked
 * has resolved (or the cap is hit). Returns the final cascaded
 * tournament, suitable for reading `knockouts[].home`, `away`,
 * `effective_winner`, etc.
 *
 * Safe on a partially-predicted bracket: knockouts whose feeder
 * matches the user hasn't picked yet stay null, and the loop exits
 * once no further winners can be derived.
 */
export function cascadeWithUserPicks(
  tournament: Tournament,
  bracket: Bracket,
  userId: string,
): CascadedBracket {
  const input: BracketPrediction = bracketToCascadeInput(
    tournament,
    bracket,
    userId,
  );
  let cascaded = cascade(tournament, input);
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const overlays: Array<{ match_id: string; winner: string }> = [];
    for (const p of Object.values(bracket.knockoutPredictions ?? {})) {
      const k = cascaded.knockouts.find(
        (x: CascadedKnockout) => x.id === p.matchId,
      );
      if (!k) continue;
      const team =
        p.outcome === "home_win"
          ? k.home.team
          : p.outcome === "away_win"
            ? k.away.team
            : null;
      if (team) overlays.push({ match_id: p.matchId, winner: team });
    }
    const before = cascaded.knockouts.filter(
      (k: CascadedKnockout) => k.effective_winner,
    ).length;
    const next = cascade(tournament, { ...input, knockouts: overlays });
    const after = next.knockouts.filter(
      (k: CascadedKnockout) => k.effective_winner,
    ).length;
    cascaded = next;
    if (after === before) break;
  }
  return cascaded;
}
