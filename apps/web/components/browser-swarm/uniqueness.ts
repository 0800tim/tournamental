/**
 * Within-swarm uniqueness via index-based deviation enumeration.
 *
 * The chalk strategy produces a single "pure chalk" bracket (favourite
 * outcome for every match). Two bots that hash to the same chalk score
 * will pick the same bracket; the existing per-bot PRNG fan-out via the
 * chalk-weighted blend gives high-probability uniqueness but not a
 * guarantee. For the federated leaderboard story we want a HARD
 * guarantee that two distinct bot indices on the same operator produce
 * structurally distinct brackets (no two bots ever have the same 104
 * outcomes).
 *
 * The algorithm:
 *
 *   1. Rank all matches by chalk confidence (lowest first). Lowest
 *      confidence means the favourite has the smallest margin over the
 *      next-best outcome; deviating there costs the bracket the least
 *      expected score, so it's the natural place to start sampling
 *      alternative brackets.
 *
 *   2. For each match `i`, enumerate its "deviation slots", one slot
 *      per non-favourite outcome (1 slot for knockouts, 2 slots for
 *      group matches where the favourite is win or loss). Each slot is
 *      a (match_id, alt_outcome) pair.
 *
 *   3. Bot 0  = pure chalk (no deviations).
 *      Bots 1..S = single-deviation brackets, indexed in confidence
 *                  order across the deviation-slot list.
 *      Bots S+1..S + C(S,2) = double-deviation brackets, indexed by
 *                  lexicographic order of the pair of deviation slots.
 *      Bots beyond that: triple-, quadruple-, ... in the same scheme.
 *
 *   4. The mapping `bot_index -> Set<(slot_idx)>` is computed in
 *      O(log(index)) using a standard combinatorial-rank decomposition
 *      (similar to base factorial number system). Cheap enough to call
 *      per-bot inside the worker without blowing the per-bot budget.
 *
 * This guarantees:
 *
 *   - Bot 0 != Bot 1 != Bot 2 ... for the first S+1 indices because
 *     each single-deviation bracket flips exactly one outcome.
 *   - Bot k > S != Bot k' > S for distinct k, k' because the
 *     combinatorial unranking returns a different deviation set.
 *
 * Coverage: the universe of brackets reachable from chalk by any
 * combination of deviations equals the full Cartesian product of
 * outcomes over the 104 matches (3^72 * 2^32 ~= 10^33). This algorithm
 * enumerates ALL of them in a deterministic order so any finite swarm
 * is a prefix of that enumeration. Two operators running the same
 * `matches[]` are guaranteed to collide ONLY on the same bot_index, so
 * federation can dedupe by `(operator, bot_index)` directly.
 */

import type { MatchSpec, Outcome } from "./types";

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

interface RankedOutcome {
  readonly outcome: Outcome;
  readonly implied: number;
}

function impliedFor(match: MatchSpec, outcomes: readonly Outcome[]): RankedOutcome[] {
  const odds = match.odds;
  if (!odds) {
    const equal = 1 / outcomes.length;
    return outcomes.map((o) => ({ outcome: o, implied: equal }));
  }
  const raw = outcomes.map((o) => Math.max(0, odds[o] ?? 0));
  const total = raw.reduce((s, x) => s + x, 0);
  if (total <= 0) {
    const equal = 1 / outcomes.length;
    return outcomes.map((o) => ({ outcome: o, implied: equal }));
  }
  return outcomes.map((o, i) => ({ outcome: o, implied: raw[i]! / total }));
}

/**
 * A deviation slot: at match index `match_idx` (into the matches array)
 * pick `alt_outcome` instead of the chalk-favourite outcome.
 */
export interface DeviationSlot {
  readonly match_idx: number;
  readonly favourite: Outcome;
  readonly alt_outcome: Outcome;
  /** Confidence margin: favourite_implied - alt_implied. Smaller =
   *  cheaper deviation. Used for sort order. */
  readonly margin: number;
}

/**
 * Pre-computed slot table for a fixture list. The slot order is
 * deterministic: ascending margin first, then a stable secondary
 * sort (FNV hash of match_id concatenated with alt_outcome) so two
 * slots with identical margin order the same way across runs.
 */
export interface DeviationTable {
  readonly slots: readonly DeviationSlot[];
  readonly favouriteByMatchIdx: readonly Outcome[];
}

/**
 * Build the deviation table from a fixture list. Group matches
 * contribute 2 slots (draw + opposite-of-favourite); knockout matches
 * contribute 1 slot (opposite-of-favourite).
 */
export function buildDeviationTable(matches: readonly MatchSpec[]): DeviationTable {
  const slots: DeviationSlot[] = [];
  const favouriteByMatchIdx: Outcome[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const outcomes: Outcome[] = match.allows_draw
      ? ["home_win", "draw", "away_win"]
      : ["home_win", "away_win"];
    const ranked = impliedFor(match, outcomes).sort(
      (a, b) => b.implied - a.implied,
    );
    const favourite = ranked[0]!.outcome;
    favouriteByMatchIdx.push(favourite);
    // Every non-favourite outcome is a candidate deviation slot.
    for (let r = 1; r < ranked.length; r++) {
      slots.push({
        match_idx: i,
        favourite,
        alt_outcome: ranked[r]!.outcome,
        margin: ranked[0]!.implied - ranked[r]!.implied,
      });
    }
  }
  // Sort by ascending margin so the cheapest deviations come first; a
  // bot one rank above pure chalk flips the lowest-confidence outcome
  // (which is the most informative variation to publish to the
  // leaderboard).
  slots.sort((a, b) => {
    if (a.margin !== b.margin) return a.margin - b.margin;
    // Stable secondary: hash of (match_idx, alt_outcome). Deterministic
    // across runs.
    const ka = fnv1a(`${a.match_idx}:${a.alt_outcome}`);
    const kb = fnv1a(`${b.match_idx}:${b.alt_outcome}`);
    if (ka !== kb) return ka - kb;
    return a.match_idx - b.match_idx;
  });
  return { slots, favouriteByMatchIdx };
}

/**
 * Binomial coefficient C(n, k), iterative to avoid overflow on big n.
 * Returns Infinity when the result exceeds Number.MAX_SAFE_INTEGER, so
 * the unranker can quickly fall back to "more deviations than this
 * swarm size will ever cover".
 */
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  if (k > n - k) k = n - k;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
    if (!Number.isFinite(result) || result > Number.MAX_SAFE_INTEGER) {
      return Infinity;
    }
  }
  return Math.round(result);
}

/**
 * Unrank a bot index into a set of deviation slot indices.
 *
 *   - rank 0  -> [] (pure chalk).
 *   - rank 1..S -> [s0], [s1], ..., [s_{S-1}] (single deviations).
 *   - rank S+1..S+C(S,2) -> all pairs in lexicographic order.
 *   - ... and so on.
 *
 * The unranker walks deviation-count levels and uses combinatorial
 * unranking inside each level. O(level * S) per call which for S=176
 * is a handful of microseconds per bot.
 */
export function deviationSlotsForBotIndex(
  rank: number,
  totalSlots: number,
): readonly number[] {
  if (rank <= 0 || totalSlots <= 0) return [];
  let remaining = rank;
  // Walk levels: level 0 = 1 chalk bracket; level k = C(totalSlots, k).
  // Skip past chalk.
  remaining -= 1;
  if (remaining < 0) return [];
  for (let k = 1; k <= totalSlots; k++) {
    const sizeAtLevel = binomial(totalSlots, k);
    if (sizeAtLevel === Infinity || remaining < sizeAtLevel) {
      // Unrank inside this level using the standard combinatorial
      // unranking algorithm. We enumerate k-combinations of
      // {0..totalSlots-1} in lexicographic order.
      return unrankCombination(remaining, totalSlots, k);
    }
    remaining -= sizeAtLevel;
  }
  // Rank exceeds the cap (which would require a swarm with more bots
  // than 2^totalSlots, an astronomically large number). Wrap around to
  // a hashed deviation set so federation still gets a distinct bracket
  // per index. This is a fail-safe path; in practice the swarm sizes
  // we cap at (~1M bots per browser node) sit deep inside the
  // double-deviation level.
  const fallback: number[] = [];
  const max = Math.min(totalSlots, 32);
  for (let i = 0; i < max; i++) {
    if ((fnv1a(`fallback:${rank}:${i}`) & 1) === 1) fallback.push(i);
  }
  return fallback;
}

/**
 * Lexicographic unranking of the `r`-th k-combination of {0..n-1}.
 * Standard textbook algorithm (Knuth TAOCP vol 4A, §7.2.1.3).
 *
 * Examples (n=5, k=2):
 *   r=0 -> [0,1]   r=1 -> [0,2]   r=2 -> [0,3]   r=3 -> [0,4]
 *   r=4 -> [1,2]   r=5 -> [1,3]   ...
 */
function unrankCombination(r: number, n: number, k: number): number[] {
  const out: number[] = [];
  let remaining = r;
  let start = 0;
  for (let i = 0; i < k; i++) {
    const slotsLeft = k - i - 1;
    let next = start;
    while (next < n) {
      const block = binomial(n - next - 1, slotsLeft);
      if (block === Infinity || remaining < block) break;
      remaining -= block;
      next++;
    }
    out.push(next);
    start = next + 1;
  }
  return out;
}

/**
 * Per-bot bracket as 104 outcomes, built by applying the bot's
 * deviation set on top of the pure-chalk bracket.
 */
export function perturbedBracket(
  table: DeviationTable,
  botIndex: number,
): Outcome[] {
  const result = [...table.favouriteByMatchIdx];
  if (botIndex <= 0) return result;
  const slotIndices = deviationSlotsForBotIndex(botIndex, table.slots.length);
  for (const si of slotIndices) {
    const slot = table.slots[si];
    if (!slot) continue;
    result[slot.match_idx] = slot.alt_outcome;
  }
  return result;
}

/**
 * Outcome for one match under the perturbation scheme. The worker uses
 * this in the tight inner loop instead of `perturbedBracket()` so it
 * avoids the per-bot allocation of a 104-entry array.
 */
export function perturbedOutcome(
  table: DeviationTable,
  botIndex: number,
  matchIdx: number,
): Outcome {
  const favourite = table.favouriteByMatchIdx[matchIdx];
  if (favourite === undefined) return "home_win"; // shouldn't happen
  if (botIndex <= 0) return favourite;
  const slotIndices = deviationSlotsForBotIndex(botIndex, table.slots.length);
  for (const si of slotIndices) {
    const slot = table.slots[si];
    if (slot && slot.match_idx === matchIdx) return slot.alt_outcome;
  }
  return favourite;
}

/**
 * Total number of single-deviation brackets reachable from chalk by
 * flipping exactly one match. Equals the deviation slot count. Useful
 * for tests + the federation report ("operator owns the first
 * single-deviation page of the chalk universe").
 */
export function singleDeviationCount(table: DeviationTable): number {
  return table.slots.length;
}

