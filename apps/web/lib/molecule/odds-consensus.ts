/**
 * Build a consensus / "global prediction" Bracket from a live odds
 * snapshot.
 *
 * The molecule's "Show global prediction" toggle uses this to overlay
 * what the world (Polymarket + The Odds API blended, falling back to
 * a deterministic world-rank mock when no live feed is connected) is
 * predicting for every match in the tournament.
 *
 * Source of truth on the wire: `/api/odds/snapshot`. That route's
 * mock tier already returns the same deterministic world-rank
 * probabilities the synchronous v1 of this helper hand-rolled, so the
 * snapshot fallback is honest about being a fallback while the live
 * service is offline.
 *
 * Mirrors the logic in `BracketBuilder.handleAutoPick` so the
 * molecule overlay and the bracket's auto-pick produce identical
 * outputs from identical inputs. If you change one, change the other.
 */

import {
  cascade,
  type Bracket,
  type GroupTiebreaker,
  type MatchPrediction,
  type StageId,
  type Tournament,
} from "@tournamental/bracket-engine";

import { bracketToCascadeInput } from "@/lib/bracket/cascade-bridge";
import type { MatchOdds } from "@/lib/odds/types";

const KO_PICK_STAGES: readonly StageId[] = [
  "r32",
  "r16",
  "qf",
  "sf",
  "tp",
  "f",
] as const;

/**
 * Given a tournament and a map of `matchNo → MatchOdds`, return a
 * fully-populated Bracket whose predictions are the
 * highest-probability outcome for every match. Group tiebreakers are
 * resolved by world rank (the snapshot doesn't carry winner summaries).
 */
export function buildOddsConsensusBracket(
  tournament: Tournament,
  oddsByMatch: ReadonlyMap<string, MatchOdds>,
): Bracket {
  const rankOf = (code: string): number =>
    tournament.teams.find((t) => t.id === code)?.fifa_rank ?? 99;
  const ts = new Date().toISOString();

  // ---------- Group fixtures ----------
  const matchPredictions: Record<string, MatchPrediction> = {};
  for (const f of tournament.group_fixtures) {
    const id = String(f.match_no);
    const odds = oddsByMatch.get(id);
    let outcome: MatchPrediction["outcome"];
    if (odds) {
      const h = odds.homeWin;
      const d = odds.draw ?? -1;
      const a = odds.awayWin;
      const max = Math.max(h, d, a);
      outcome = max === h ? "home_win" : max === d ? "draw" : "away_win";
    } else {
      const g = tournament.groups.find((x) => x.id === f.group_id);
      const home = g ? g.team_ids[f.home_idx] : undefined;
      const away = g ? g.team_ids[f.away_idx] : undefined;
      const hr = home ? rankOf(home) : 99;
      const ar = away ? rankOf(away) : 99;
      if (Math.abs(hr - ar) <= 3) outcome = "draw";
      else outcome = hr < ar ? "home_win" : "away_win";
    }
    matchPredictions[id] = { matchId: id, outcome, lockedAt: ts };
  }

  // ---------- Group tiebreakers (rank-based, matches auto-pick) ----------
  const groupTiebreakers: Record<string, GroupTiebreaker> = {};
  for (const g of tournament.groups) {
    if (g.team_ids.length !== 4) continue;
    const ranked = [...g.team_ids].sort(
      (a, b) => rankOf(a) - rankOf(b),
    ) as [string, string, string, string];
    groupTiebreakers[g.id] = {
      groupId: g.id,
      rankedTeams: ranked,
      setAt: ts,
    };
  }

  // ---------- Knockouts: stage-by-stage with re-cascade ----------
  let next: Bracket = {
    bracketId: "consensus-odds-v1",
    matchPredictions,
    groupTiebreakers,
    knockoutPredictions: {},
    version: 2,
  };

  // Anonymous user — only used by the cascade-bridge for tagging.
  const userLocalId = "consensus";

  for (const stage of KO_PICK_STAGES) {
    const legacy = bracketToCascadeInput(tournament, next, userLocalId);
    let round = cascade(tournament, legacy);
    for (let pass = 0; pass < 6; pass += 1) {
      const overlays = Object.values(next.knockoutPredictions)
        .map((p) => {
          const k = round.knockouts.find((x) => x.id === p.matchId);
          if (!k) return null;
          const team = p.outcome === "home_win" ? k.home.team : k.away.team;
          return team ? { match_id: p.matchId, winner: team } : null;
        })
        .filter((x): x is { match_id: string; winner: string } => x !== null);
      const before = round.knockouts.filter((k) => k.effective_winner).length;
      round = cascade(tournament, { ...legacy, knockouts: overlays });
      const after = round.knockouts.filter((k) => k.effective_winner).length;
      if (after === before) break;
    }
    const stageMatches = round.knockouts.filter((k) => k.stage === stage);
    for (const k of stageMatches) {
      if (!k.home.team || !k.away.team) continue;
      const o = oddsByMatch.get(k.id);
      let outcome: MatchPrediction["outcome"];
      if (o) {
        outcome = o.homeWin >= o.awayWin ? "home_win" : "away_win";
      } else {
        const hr = rankOf(k.home.team);
        const ar = rankOf(k.away.team);
        outcome = hr <= ar ? "home_win" : "away_win";
      }
      next = {
        ...next,
        knockoutPredictions: {
          ...next.knockoutPredictions,
          [k.id]: { matchId: k.id, outcome, lockedAt: ts },
        },
      };
    }
  }

  return next;
}

/**
 * Fetch the snapshot from `/api/odds/snapshot` and return a
 * `Map<matchNo, MatchOdds>`. Returns an empty map on failure — the
 * helper above tolerates that and falls through to world-rank
 * heuristics.
 */
export async function fetchOddsSnapshotMap(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Map<string, MatchOdds>> {
  try {
    const r = await fetchImpl("/api/odds/snapshot", {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!r.ok) return new Map();
    const j = (await r.json()) as { matches?: MatchOdds[] };
    if (!Array.isArray(j.matches)) return new Map();
    return new Map(j.matches.map((m) => [String(m.matchNo), m]));
  } catch {
    return new Map();
  }
}
