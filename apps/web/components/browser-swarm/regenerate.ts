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
 */

import type { MatchOdds, MatchSpec, Outcome } from "./types";

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

export function buildDemoMatches(): MatchSpec[] {
  const teams = [
    "argentina",
    "france",
    "brazil",
    "england",
    "germany",
    "spain",
    "portugal",
    "netherlands",
    "uruguay",
    "croatia",
    "morocco",
    "japan",
  ];
  const matches: MatchSpec[] = [];
  let count = 0;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      count++;
      matches.push({
        match_id: `wc26-demo-${count.toString().padStart(3, "0")}`,
        tournament_id: "fifa-wc-2026",
        home_team: teams[i]!,
        away_team: teams[j]!,
        kickoff_utc: new Date(Date.now() + count * 3_600_000).toISOString(),
        allows_draw: count <= 36,
        odds: {
          home_win: 0.45 - ((count * 0.013) % 0.2),
          draw: 0.25,
          away_win: 0.3 + ((count * 0.011) % 0.2),
        },
      });
      if (matches.length >= 64) return matches;
    }
  }
  return matches;
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

  const outcomes: Outcome[] = match.allows_draw
    ? ["home_win", "draw", "away_win"]
    : ["home_win", "away_win"];

  const implied = pickImplied(match, outcomes);
  let favouriteIndex = 0;
  for (let i = 1; i < implied.length; i++) {
    if (implied[i]! > implied[favouriteIndex]!) favouriteIndex = i;
  }

  const chalk = clamp01(chalkScore);
  let total = 0;
  const blended: number[] = new Array(outcomes.length);
  for (let i = 0; i < outcomes.length; i++) {
    const spike = i === favouriteIndex ? 1 : 0;
    const v = (1 - chalk) * implied[i]! + chalk * spike;
    blended[i] = v;
    total += v;
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
