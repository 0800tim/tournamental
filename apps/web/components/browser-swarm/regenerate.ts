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

/**
 * Real 2026 FIFA World Cup fixtures, all 104 matches in match-number
 * order. Group-stage rows carry the real 3-letter team codes (MEX,
 * RSA, KOR, CZE etc.). Knockouts carry placeholder slot codes (1B,
 * 2F, W101, ...) which the bracket cascade will resolve per-bot in
 * Phase 2. For pick generation the slot labels are fine because the
 * bot is still picking home_win / draw / away_win and the merkle
 * commitment doesn't care about the human-readable team name.
 *
 * Vendored from `data/fifa-wc-2026/fixtures.json` at build time via
 * a static import so the file ships in the client bundle without
 * a fetch.
 */
import fixturesJson from "../../../../data/fifa-wc-2026/fixtures.json";

interface RawFixture {
  match_number: number;
  stage: string;
  home_team_slot: string;
  away_team_slot: string;
  kickoff_utc: string;
  host_city_id?: string;
}

interface RawFixturesFile {
  fixtures: RawFixture[];
}

const REAL_FIXTURES: RawFixture[] = (fixturesJson as unknown as RawFixturesFile).fixtures;

function buildFairOddsForStage(stage: string, matchNumber: number): { home_win: number; draw: number; away_win: number } {
  // Naive uniform-ish odds skewed slightly toward the favourite. The
  // real Polymarket pull happens in Phase 2; for Phase 1 we just need
  // SOMETHING that produces non-degenerate ranked alternatives so the
  // gold/silver/bronze UI has variation.
  if (stage.startsWith("group_")) {
    const homeBias = 0.35 + ((matchNumber * 0.013) % 0.15);
    const awayBias = 0.25 + ((matchNumber * 0.011) % 0.15);
    const draw = 1 - homeBias - awayBias;
    return { home_win: homeBias, draw, away_win: awayBias };
  }
  // Knockouts: stronger home-bias (slot 1 usually higher seed)
  const homeBias = 0.55 + ((matchNumber * 0.007) % 0.15);
  return { home_win: homeBias, draw: 0, away_win: 1 - homeBias };
}

export function buildDemoMatches(): MatchSpec[] {
  return REAL_FIXTURES.map((f) => {
    const isGroup = f.stage.startsWith("group_");
    return {
      match_id: `wc26-${f.match_number.toString().padStart(3, "0")}`,
      tournament_id: "fifa-wc-2026",
      home_team: f.home_team_slot,
      away_team: f.away_team_slot,
      kickoff_utc: f.kickoff_utc,
      allows_draw: isGroup,
      odds: buildFairOddsForStage(f.stage, f.match_number),
    };
  });
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
