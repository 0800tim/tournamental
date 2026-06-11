/**
 * Server-side cascade + public share-page summariser.
 *
 * Tim's bug 2026-05-11: the public `/s/<guid>` landing page showed
 * "@Anonymous picked TBD to lift the trophy" for every bracket because
 * the persisted `Bracket` shape uses canonical knockout ids
 * (`r32_01`, `qf_01`, `final`) whose tokens don't embed ISO team codes.
 * The previous summariser relied on parsing `qf_ARG_NED`-style ids to
 * extract teams, so champion / podium / path always fell through to
 * null on real saved brackets.
 *
 * Fix: resolve the bracket against the canonical FIFA WC 2026 fixtures
 * by running the same multi-pass cascade the in-browser MoleculeScene
 * uses. Once cascaded, the `final` match's `effective_winner` is the
 * champion, the other side is the runner-up, and the `tp_01`
 * (third-place play-off) winner is the bronze medal. The champion's
 * path-to-gold walks the cascaded knockouts where the champion is a
 * combatant.
 *
 * Pure helpers, no I/O. The route imports `loadFixtures2026()` once at
 * module scope and re-uses it per request.
 */

import {
  cascade,
  computeGroupStandings,
  isGroupComplete,
  type Bracket,
  type BracketPrediction,
  type CascadedBracket,
  type CascadedKnockout,
  type MatchPrediction,
  type Tournament,
} from "@tournamental/bracket-engine";

/**
 * Path-to-gold row surfaced on the public share landing. Re-declared
 * here (rather than imported from `bracket-by-guid.ts`) so the file
 * has zero route-layer dependencies — keeps the unit tests trivial.
 */
export interface KnockoutPathEntry {
  /** Stage label as the web client expects ("r32", "r16", "qf", "sf",
   *  "final"). The 2026 FIFA WC has 48 teams + a Round-of-32 play-in,
   *  so r32 is surfaced alongside the four traditional rounds (Tim
   *  2026-05-25). */
  readonly stage: "r32" | "r16" | "qf" | "sf" | "final";
  /** Opponent team code. Null when the prior round hasn't been picked. */
  readonly opponent_code: string | null;
  readonly result: "win" | "loss" | "tbd";
}

/** Stages the share landing renders, in order. */
const PUBLIC_PATH_STAGES: ReadonlyArray<KnockoutPathEntry["stage"]> = [
  "r32",
  "r16",
  "qf",
  "sf",
  "final",
];

/**
 * Map the bracket-engine's knockout stage codes onto the public-share
 * stages. The engine uses r32/r16/qf/sf/tp/f; the share UI surfaces
 * five "round-of" stages (r32 added 2026-05-25 since the 2026 FIFA WC
 * uses a 48-team Round of 32 as its play-in).
 */
function publicStageFor(
  k: CascadedKnockout,
): KnockoutPathEntry["stage"] | null {
  switch (k.stage) {
    case "r32":
      return "r32";
    case "r16":
      return "r16";
    case "qf":
      return "qf";
    case "sf":
      return "sf";
    case "f":
      return "final";
    default:
      return null;
  }
}

/**
 * Convert a per-match `Bracket` into the `BracketPrediction` shape the
 * cascade engine consumes. Mirrors `apps/web/lib/bracket/cascade-bridge.ts`
 * but lives here so the game service can do it server-side without
 * pulling in a web-only dep. Future cleanup: hoist into
 * `@tournamental/bracket-engine` so both sides share one helper.
 */
function bracketToCascadeInput(
  tournament: Tournament,
  bracket: Bracket,
  userId: string,
): BracketPrediction {
  const groups = tournament.groups.map((g) => {
    const complete = isGroupComplete(g.id, tournament, bracket.matchPredictions);
    const tiebreaker = bracket.groupTiebreakers[g.id];
    const standings = computeGroupStandings(
      g.id,
      tournament,
      bracket.matchPredictions,
      tiebreaker,
    );
    // Only emit the order for fully-predicted groups; an incomplete
    // group's standings lean on tiebreaker fallbacks that mis-seed the
    // knockouts. Mirrors apps/web/lib/bracket/cascade-bridge.ts.
    return {
      group_id: g.id,
      order: complete ? standings.map((s) => s.teamCode) : [],
    };
  });

  // Use the user's saved best-third-placed picks, exactly like the web
  // cascade-bridge. Recomputing them from standings here diverged from
  // the web cascade and seeded the R32 differently, so a manipulated
  // bracket showed a different finalist on the share podium than in the
  // builder/molecule (Tim 2026-06-11). Empty when unset.
  const best_thirds = bracket.bestThirds ?? [];

  return {
    tournament_id: tournament.id,
    user_id: userId,
    groups,
    best_thirds,
    best_fourths: [],
    knockouts: [],
    locks: [],
    updated_at_utc: bracket.lockedAt ?? new Date().toISOString(),
  };
}

/**
 * Multi-pass cascade resolver. Each pass overlays the current
 * cascade's predicted winners onto the next pass's input, so deep
 * knockout slots (final, sf, qf...) stabilise once the upstream
 * brackets are determined. Mirrors the 6-pass loop in
 * `apps/web/components/molecule/MoleculeScene.resolveCascade` and
 * `apps/web/components/bracket/BracketBuilder.handleAutoPick`.
 */
export function resolveCascadeForSummary(
  tournament: Tournament,
  bracket: Bracket,
  userId: string = "share_landing",
): CascadedBracket {
  const legacy = bracketToCascadeInput(tournament, bracket, userId);
  let result = cascade(tournament, legacy);
  for (let pass = 0; pass < 6; pass += 1) {
    const knockouts = Object.values(bracket.knockoutPredictions)
      .map((p: MatchPrediction) => {
        const k = result.knockouts.find((x) => x.id === p.matchId);
        if (!k) return null;
        const team = p.outcome === "home_win" ? k.home.team : k.away.team;
        return team ? { match_id: p.matchId, winner: team } : null;
      })
      .filter((x): x is { match_id: string; winner: string } => x !== null);
    const before = result.knockouts.filter((k) => k.effective_winner).length;
    result = cascade(tournament, { ...legacy, knockouts });
    const after = result.knockouts.filter((k) => k.effective_winner).length;
    if (after === before) break;
  }
  return result;
}

export interface CascadeSummary {
  champion_code: string | null;
  runner_up_code: string | null;
  third_place_code: string | null;
  knockout_path: KnockoutPathEntry[];
}

/**
 * Build the public share-page summary from a cascaded bracket.
 *
 * Returns nulls when the cascade couldn't resolve the slot (the bracket
 * is incomplete or the tournament fixture set isn't the one the
 * bracket was saved against). The `summariseBracketLegacyIds` path
 * below picks up the slack for test fixtures whose matchIds embed ISO
 * codes directly.
 */
export function summariseFromCascade(
  cascaded: CascadedBracket,
): CascadeSummary {
  const final = cascaded.knockouts.find((k) => k.stage === "f") ?? null;
  const tp = cascaded.knockouts.find((k) => k.stage === "tp") ?? null;

  let champion_code: string | null = null;
  let runner_up_code: string | null = null;
  if (final && final.effective_winner) {
    champion_code = final.effective_winner;
    // The runner-up is whichever combatant isn't the winner.
    if (final.home.team && final.home.team !== champion_code) {
      runner_up_code = final.home.team;
    } else if (final.away.team && final.away.team !== champion_code) {
      runner_up_code = final.away.team;
    }
  }

  // Bronze: tp winner (third-place playoff). Fall back to nothing if
  // unresolved; some brackets skip the tp pick.
  const third_place_code = tp?.effective_winner ?? null;

  // Champion's path-to-gold: walk the cascaded knockouts in stage order
  // and find each round where the champion was a combatant. We surface
  // the opponent code, regardless of whether the champion's predicted
  // result was a win (which it should be, since they reached the final)
  // or a loss.
  const knockout_path: KnockoutPathEntry[] = PUBLIC_PATH_STAGES.map(
    (stage): KnockoutPathEntry => {
      if (!champion_code) {
        return { stage, opponent_code: null, result: "tbd" };
      }
      const match = cascaded.knockouts.find((k) => {
        if (publicStageFor(k) !== stage) return false;
        return k.home.team === champion_code || k.away.team === champion_code;
      });
      if (!match) {
        return { stage, opponent_code: null, result: "tbd" };
      }
      const opponent =
        match.home.team === champion_code ? match.away.team : match.home.team;
      if (!opponent) {
        return { stage, opponent_code: null, result: "tbd" };
      }
      const result: KnockoutPathEntry["result"] =
        match.effective_winner === champion_code ? "win" : "tbd";
      return { stage, opponent_code: opponent, result };
    },
  );

  return { champion_code, runner_up_code, third_place_code, knockout_path };
}
