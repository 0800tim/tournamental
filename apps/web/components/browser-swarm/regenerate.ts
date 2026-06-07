/**
 * Deterministic bot regeneration for the /run/bots list + detail pages.
 *
 * The swarm only stores the cumulative cursor and a few sample rows in
 * IndexedDB. Every bot's actual bracket is recomputed on demand from
 * (master_seed, bot_index, strategy_name) via the same chalk-weighted
 * strategy the worker uses. ~3ms per bot, ~3s for a page of 1000.
 *
 * Returns both the chosen outcome AND the ranked alternatives so the
 * list can show gold/silver/bronze flags for the 2nd and 3rd most
 * likely outcomes per match.
 *
 * Tim 2026-06-07: the demo fixture builder has been swapped for the
 * real FIFA WC 2026 schedule loaded out of @tournamental/bracket-engine.
 * The MatchSpec set is now 104 matches (72 group + 32 knockout) and the
 * match_id convention matches `apps/game/src/kickoffs.ts` so the same
 * id can be used for client + server lockout. Knockout slot teams are
 * left as deterministic placeholders ("winner_grpA_1", "annex_third_B")
 * because the cascade isn't resolved at pre-tournament time; the chalk
 * decide() doesn't care what the team names are, only that they're
 * stable across renders.
 */

import { loadFixtures2026 } from "@tournamental/bracket-engine";
import type {
  GroupFixture,
  KnockoutFixture,
  SlotSource,
  Team,
  Tournament,
} from "@tournamental/bracket-engine";

import type { MatchOdds, MatchSpec, Outcome } from "./types";
import {
  buildDeviationTable,
  perturbedOutcome,
  type DeviationTable,
} from "./uniqueness";

/**
 * Stable master seed for the browser-swarm. All bot IDs and pick
 * decisions are deterministic functions of (MASTER_SEED, bot_index)
 * so the list + detail pages can regenerate any bot's bracket from
 * its index alone, without needing to store the picks themselves.
 *
 * Future per-user master seeds (one per signed-in account) will replace
 * this constant. For Phase 1 we use a global hardcoded value so any
 * device viewing the same bot_index sees the same bracket.
 */
export const MASTER_SEED = "tournamental-browser-v1";

/**
 * Cached fixture build. `loadFixtures2026()` is itself a JSON load so
 * the work is small, but the derived MatchSpec[] involves rank lookups
 * + odds derivation, and we want the /run/bots and /run/bots/[index]
 * pages to see the same object identity for the matches array (so
 * useMemo upstream stays cheap).
 */
let cachedMatches: MatchSpec[] | null = null;
let cachedTeamsById: Map<string, Team> | null = null;
let cachedTournament: Tournament | null = null;

/**
 * Convert a FIFA-rank-style number into a notional implied win
 * probability. Lower rank = stronger. The curve is intentionally soft:
 * a rank-1 side caps around ~0.55 and the rank-48 side floors around
 * ~0.12 so the chalk strategy still has signal but isn't so peaked
 * that every bot picks the same favourite.
 */
function rankToStrength(rank: number): number {
  const r = Math.max(1, rank);
  // 1 / (1 + ln(r)). r=1 → 1.0; r=10 → ~0.30; r=48 → ~0.21.
  return 1 / (1 + Math.log(r));
}

/**
 * Group-stage odds derivation: blend home strength vs away strength.
 * Draws sit between the two with a baseline weight so even a one-sided
 * match gives a draw ~20% implied probability (FIFA group-stage matches
 * draw at roughly that rate historically).
 */
function deriveGroupOdds(homeRank: number, awayRank: number): MatchOdds {
  const home = rankToStrength(homeRank);
  const away = rankToStrength(awayRank);
  const drawWeight = 0.25 + 0.15 * (1 - Math.abs(home - away));
  const total = home + away + drawWeight;
  return {
    home_win: home / total,
    draw: drawWeight / total,
    away_win: away / total,
  };
}

/**
 * Knockout odds derivation: similar to groups but with no draw column
 * (knockouts go straight to ET + pens in real life). Normalised across
 * just two outcomes.
 */
function deriveKnockoutOdds(homeRank: number, awayRank: number): MatchOdds {
  const home = rankToStrength(homeRank);
  const away = rankToStrength(awayRank);
  const total = home + away;
  return {
    home_win: home / total,
    draw: 0,
    away_win: away / total,
  };
}

/**
 * Average FIFA rank of all teams in `group`. Used as the rank stand-in
 * for "winner of group X" placeholder slots in knockout odds (we don't
 * know who'll win the group yet, so we treat the group's average rank
 * as the slot's strength signal). Position 1 (winner) gets a small
 * bonus; runners-up are slightly weaker.
 */
function rankForGroupPosition(
  tournament: Tournament,
  groupId: string,
  position: number,
  teamsById: Map<string, Team>,
): number {
  const group = tournament.groups.find((g) => g.id === groupId);
  if (!group) return 32;
  const ranks = group.team_ids
    .map((id) => teamsById.get(id)?.fifa_rank ?? 32)
    .sort((a, b) => a - b);
  // position 1 = strongest assumption, position 2/3/4 = weaker.
  const idx = Math.min(ranks.length - 1, Math.max(0, position - 1));
  return ranks[idx]!;
}

/**
 * Slot label + rank stand-in for a knockout slot. We don't resolve the
 * cascade pre-tournament; the chalk strategy only needs deterministic
 * team strings and odds. Labels are stable across renders so the
 * /run/bots/[index] page can show the same matchup wording the user
 * saw in the list.
 */
function describeSlot(
  source: SlotSource,
  tournament: Tournament,
  teamsById: Map<string, Team>,
): { label: string; rank: number } {
  switch (source.kind) {
    case "group_position":
      return {
        label: `${source.position === 1 ? "winner" : `pos${source.position}`}_grp${source.group}`,
        rank: rankForGroupPosition(tournament, source.group, source.position, teamsById),
      };
    case "best_third":
      return {
        label: `best_third_${source.rank}`,
        rank: 36, // mid-table assumption; best thirds tend to be mid-tier sides
      };
    case "best_fourth":
      return {
        label: `best_fourth_${source.rank}`,
        rank: 50,
      };
    case "knockout_winner":
      return { label: `winner_${source.match_id}`, rank: 18 };
    case "knockout_loser":
      return { label: `loser_${source.match_id}`, rank: 22 };
    case "annex_c_third":
      return {
        label: `annex_third_vs_grp${source.group_winner}`,
        rank: 36,
      };
  }
}

/**
 * Build the full real-fixtures MatchSpec list (72 group + 32 knockout
 * = 104 matches) from the bracket-engine's bundled WC 2026 data.
 * Result is memoised so successive calls are O(1).
 */
export function buildDemoMatches(): MatchSpec[] {
  if (cachedMatches) return cachedMatches;

  const tournament = loadFixtures2026();
  cachedTournament = tournament;

  const teamsById = new Map<string, Team>();
  for (const t of tournament.teams) teamsById.set(t.id, t);
  cachedTeamsById = teamsById;

  const matches: MatchSpec[] = [];

  // ---- group fixtures (72) ----
  const groupsById = new Map<string, (typeof tournament.groups)[number]>();
  for (const g of tournament.groups) groupsById.set(g.id, g);

  for (const f of tournament.group_fixtures as readonly GroupFixture[]) {
    const group = groupsById.get(f.group_id);
    if (!group) continue;
    const homeId = group.team_ids[f.home_idx];
    const awayId = group.team_ids[f.away_idx];
    if (!homeId || !awayId) continue;
    const home = teamsById.get(homeId);
    const away = teamsById.get(awayId);
    const homeRank = home?.fifa_rank ?? 32;
    const awayRank = away?.fifa_rank ?? 32;
    matches.push({
      match_id: String(f.match_no),
      tournament_id: tournament.id,
      home_team: homeId,
      away_team: awayId,
      kickoff_utc: f.kickoff_utc,
      allows_draw: true,
      odds: deriveGroupOdds(homeRank, awayRank),
    });
  }

  // ---- knockout fixtures (32) ----
  for (const k of tournament.knockouts as readonly KnockoutFixture[]) {
    const home = describeSlot(k.home, tournament, teamsById);
    const away = describeSlot(k.away, tournament, teamsById);
    matches.push({
      match_id: k.id,
      tournament_id: tournament.id,
      home_team: home.label,
      away_team: away.label,
      kickoff_utc: k.kickoff_utc,
      allows_draw: false,
      odds: deriveKnockoutOdds(home.rank, away.rank),
    });
  }

  cachedMatches = matches;
  return matches;
}

/**
 * Direct accessor for the loaded tournament, useful for the detail
 * page when it needs team metadata (display names, fifa_rank, flag
 * emoji) beyond what MatchSpec carries. Triggers the same memoised
 * load if buildDemoMatches() hasn't run yet.
 */
export function loadTournament(): Tournament {
  if (cachedTournament) return cachedTournament;
  buildDemoMatches();
  return cachedTournament!;
}

/**
 * Look up the human display name + fifa_rank for a team code, if it's
 * a real team (not a placeholder slot label). Returns null for slot
 * labels like "winner_grpA" or "annex_third_vs_grpB".
 */
export function teamMeta(teamCode: string): Team | null {
  if (!cachedTeamsById) buildDemoMatches();
  return cachedTeamsById?.get(teamCode) ?? null;
}

/**
 * Full ranked list of competing teams ordered by FIFA rank, used by
 * the darling-team picker to give each bot a sentimental favourite
 * with mild long-tail weighting.
 */
let cachedRankedTeams: ReadonlyArray<{ team: string; rank: number }> | null = null;
export function rankedTeams(): ReadonlyArray<{ team: string; rank: number }> {
  if (cachedRankedTeams) return cachedRankedTeams;
  const t = loadTournament();
  cachedRankedTeams = t.teams
    .map((team) => ({ team: team.id, rank: team.fifa_rank }))
    .sort((a, b) => a.rank - b.rank);
  return cachedRankedTeams;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function seededFraction(seed: string, salt: string): number {
  const a = fnv1a(`${seed}::${salt}`);
  const b = fnv1a(`${salt}::${seed}`);
  const combined = (a ^ (b * 2654435761)) >>> 0;
  return combined / 0x1_0000_0000;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.75;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function pickImplied(match: MatchSpec, outcomes: Outcome[]): number[] {
  const odds: MatchOdds | undefined = match.odds;
  if (!odds) {
    const equal = 1 / outcomes.length;
    return outcomes.map(() => equal);
  }
  const raw = outcomes.map((o) => Math.max(0, odds[o] ?? 0));
  const total = raw.reduce((s, x) => s + x, 0);
  if (total <= 0) {
    const equal = 1 / outcomes.length;
    return outcomes.map(() => equal);
  }
  return raw.map((x) => x / total);
}

export interface RankedPick {
  /** The outcome the bot selected (gold). */
  readonly chosen: Outcome;
  /** Outcomes ranked by the bot's blended probability, descending.
   * For groups: 3 entries (gold/silver/bronze).
   * For knockouts: 2 entries (gold/silver). */
  readonly ranking: ReadonlyArray<{ outcome: Outcome; probability: number }>;
  /** The bot's blended probability for its CHOSEN outcome. Useful for
   * sorting bots by confidence. */
  readonly chosenProbability: number;
}

/**
 * Bot ID format: `bot_<base32_8>` derived from (master_seed, bot_index).
 */
export function botIdFromIndex(masterSeed: string, index: number): string {
  const hash = fnv1a(`${masterSeed}::bot::${index}`);
  // 8-char lowercase hex (32 bits is enough; collisions extremely unlikely
  // within a single user's swarm of even billions).
  return `bot_${hash.toString(16).padStart(8, "0")}`;
}

export function chalkScoreForBot(masterSeed: string, index: number): number {
  const seed = botIdFromIndex(masterSeed, index);
  const f = seededFraction(seed, "chalk_score");
  return 0.65 + f * 0.25;
}

/**
 * The "darling team" each bot sentimentally favours. The chalk-only
 * strategy collapses every confident bot onto the same chalk leader,
 * which is why Tim sees the same top-3 winners repeated. The darling
 * gives each bot a deterministic long-shot bias so the cup-winner
 * distribution fans out across the favourites and a few dark horses
 * instead of clustering on the rank-1 side.
 *
 * Weighting is 1 / sqrt(rank), so a rank-1 side has weight 1 and a
 * rank-48 side has weight ~0.14: top sides still dominate but the tail
 * gets meaningful representation.
 */
export function darlingTeamForBot(masterSeed: string, botIndex: number): string {
  const teams = rankedTeams();
  if (teams.length === 0) return "ARG";
  const weights = teams.map((t) => 1 / Math.sqrt(Math.max(1, t.rank)));
  const total = weights.reduce((s, x) => s + x, 0);
  const r = seededFraction(botIdFromIndex(masterSeed, botIndex), "darling") * total;
  let acc = 0;
  for (let i = 0; i < teams.length; i++) {
    acc += weights[i]!;
    if (r < acc) return teams[i]!.team;
  }
  return teams[teams.length - 1]!.team;
}

/**
 * Bonus the bot gives to its darling team when picking the winner.
 * Acts as an additive shift on the favourite-outcome side of the
 * probability blend before normalisation.
 */
const DARLING_BONUS = 0.18;

/**
 * Regenerate a bot's pick for a single match, with the ranking of
 * alternatives for gold/silver/bronze display.
 */
export function regenerateBotPick(
  masterSeed: string,
  botIndex: number,
  match: MatchSpec,
): RankedPick {
  const seed = botIdFromIndex(masterSeed, botIndex);
  const chalkScore = chalkScoreForBot(masterSeed, botIndex);
  const darling = darlingTeamForBot(masterSeed, botIndex);

  const outcomes: Outcome[] = match.allows_draw
    ? ["home_win", "draw", "away_win"]
    : ["home_win", "away_win"];

  const implied = pickImplied(match, outcomes);
  let favouriteIndex = 0;
  for (let i = 1; i < implied.length; i++) {
    if (implied[i]! > implied[favouriteIndex]!) favouriteIndex = i;
  }

  const chalk = clamp01(chalkScore);

  // Darling bias: if either side is the bot's darling team, nudge the
  // bot's blended probability toward that side. This is what breaks
  // the cluster-on-chalk-leader pattern.
  const darlingBonusHome = match.home_team === darling ? DARLING_BONUS : 0;
  const darlingBonusAway = match.away_team === darling ? DARLING_BONUS : 0;

  let total = 0;
  const blended: number[] = new Array(outcomes.length);
  for (let i = 0; i < outcomes.length; i++) {
    const spike = i === favouriteIndex ? 1 : 0;
    let v = (1 - chalk) * implied[i]! + chalk * spike;
    if (outcomes[i] === "home_win") v += darlingBonusHome;
    if (outcomes[i] === "away_win") v += darlingBonusAway;
    blended[i] = Math.max(0, v);
    total += blended[i]!;
  }
  if (total <= 0) total = 1;

  const normalised = blended.map((v) => v / total);

  const r = seededFraction(seed, match.match_id);
  let cumulative = 0;
  let chosenIdx = outcomes.length - 1;
  for (let i = 0; i < outcomes.length; i++) {
    cumulative += normalised[i]!;
    if (r < cumulative) {
      chosenIdx = i;
      break;
    }
  }

  // Sort outcomes by descending probability for ranking display.
  const ranking = outcomes
    .map((o, i) => ({ outcome: o, probability: normalised[i]! }))
    .sort((a, b) => b.probability - a.probability);

  return {
    chosen: outcomes[chosenIdx]!,
    ranking,
    chosenProbability: normalised[chosenIdx]!,
  };
}

/**
 * Regenerate a bot's full bracket across an arbitrary fixture list.
 * Cheap enough (~3ms) to call inline in a React render for a single
 * bot's detail page.
 */
export function regenerateBotBracket(
  masterSeed: string,
  botIndex: number,
  matches: readonly MatchSpec[],
): ReadonlyArray<{ match: MatchSpec; pick: RankedPick }> {
  return matches.map((match) => ({
    match,
    pick: regenerateBotPick(masterSeed, botIndex, match),
  }));
}

/**
 * Unique-by-construction variant of `regenerateBotBracket`. The picked
 * outcome for each match is derived from the swarm's index-based
 * perturbation table (`uniqueness.ts`) so two distinct bot indices are
 * guaranteed to produce structurally distinct 104-outcome brackets.
 * The gold/silver/bronze ranking still comes from the chalk-blended
 * probabilities so the display surface keeps the existing variety
 * signal.
 *
 * Use this in the worker + the detail page when the run is meant to be
 * federated; `regenerateBotBracket` (above) is kept for backwards
 * compatibility with the list page where the chalk-blended "chosen"
 * outcome is fine for the summary medal columns.
 */
export function regenerateBotBracketUnique(
  masterSeed: string,
  botIndex: number,
  matches: readonly MatchSpec[],
  /** Optional pre-built deviation table. The list page memoises the
   * table across rows; per-page callers can pass it in to avoid
   * rebuilding for every bot. Cheap to build (one pass over matches)
   * but cheaper still to share. */
  deviationTable?: DeviationTable,
): ReadonlyArray<{ match: MatchSpec; pick: RankedPick }> {
  const table = deviationTable ?? buildDeviationTable(matches);
  return matches.map((match, idx) => {
    const base = regenerateBotPick(masterSeed, botIndex, match);
    const unique = perturbedOutcome(table, botIndex, idx);
    if (unique === base.chosen) return { match, pick: base };
    // Override the chosen outcome but keep the ranking for display.
    const newProb = base.ranking.find((r) => r.outcome === unique)?.probability ?? 0;
    return {
      match,
      pick: {
        chosen: unique,
        ranking: base.ranking,
        chosenProbability: newProb,
      },
    };
  });
}
