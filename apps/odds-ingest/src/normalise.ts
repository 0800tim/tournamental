/**
 * Normalisation: map external feed strings (Polymarket question / outcome
 * tokens, The Odds API team names) onto our FIFA team codes and our
 * internal market kinds.
 *
 * Polymarket markets we care about typically look like:
 *   "Will Argentina win the 2026 FIFA World Cup?" -> tournament_winner / ARG
 *   "Will Brazil win Group C?"                    -> group_winner / BRA
 *   "Will Argentina beat Mexico?"                 -> match_moneyline / ARG vs MEX
 *   "FIFA World Cup 2026 Top Goalscorer"          -> top_scorer (per outcome)
 *
 * These rules are intentionally conservative — when no confident mapping is
 * available we return null and the caller logs + skips the market rather
 * than guessing.
 */

import type { DataPack, Fixture, Team } from "./data.js";
import type { MarketKind } from "./types.js";

const NORMALISE_WS = /\s+/g;

export function normaliseString(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—]/g, "-") // en/em dashes
    .replace(/[‘’‚‛′]/g, "'") // smart single quotes + prime
    .replace(/[“”„‟″]/g, '"') // smart double quotes + double prime
    .replace(NORMALISE_WS, " ")
    .trim();
}

/**
 * Best-effort lookup of an FIFA code given an arbitrary external label.
 * Returns null if the label can't be mapped with confidence.
 */
export function teamCodeFromLabel(label: string, data: DataPack): string | null {
  if (!label) return null;
  const norm = normaliseString(label);
  // Direct hit on our index (covers canonical names, short codes, and aliases).
  const direct = data.byNameLc.get(norm);
  if (direct) return direct.code;
  // Three-letter code direct (uppercase the whole label).
  const upper = label.trim().toUpperCase();
  if (data.byCode.has(upper)) return upper;
  // Word-level scan: any token in the label that is itself a known alias or
  // 3-letter code wins. Catches things like "Will USA win ..." where the
  // bare token "usa" maps to USA via the alias table.
  for (const word of norm.split(/[^\p{Letter}']+/u)) {
    if (!word) continue;
    const aliasHit = data.byNameLc.get(word);
    if (aliasHit) return aliasHit.code;
    const codeHit = data.byCode.get(word.toUpperCase());
    if (codeHit) return codeHit.code;
  }
  // Substring scan: pick the team whose alias / name appears in the label,
  // longest match wins. Threshold of 4 chars prevents short-code false
  // positives (so "USA" and "DR" don't tag every label that mentions them).
  let best: Team | null = null;
  let bestLen = 0;
  for (const [alias, team] of data.byNameLc) {
    if (alias.length < 4) continue;
    if (norm.includes(alias) && alias.length > bestLen) {
      best = team;
      bestLen = alias.length;
    }
  }
  return best ? best.code : null;
}

/**
 * Attempt to classify a Polymarket Gamma market by question text.
 */
export function classifyMarket(
  question: string,
): { kind: MarketKind; hint: "tournament" | "group" | "match" | "topscorer" } | null {
  const q = normaliseString(question);
  if (/top (gol)?(scorer|goalscorer)|golden boot/.test(q)) {
    return { kind: "top_scorer", hint: "topscorer" };
  }
  if (
    /win (the )?(2026 )?(fifa )?world cup/.test(q) ||
    /world cup winner/.test(q) ||
    /to win (the )?world cup/.test(q)
  ) {
    return { kind: "tournament_winner", hint: "tournament" };
  }
  if (/win group [a-l]\b|to win group [a-l]\b|top group [a-l]\b/.test(q)) {
    return { kind: "group_winner", hint: "group" };
  }
  if (/\bbeat\b|\bvs\b|\bv\.\b|\bversus\b/.test(q)) {
    return { kind: "match_moneyline", hint: "match" };
  }
  return null;
}

/**
 * Find the (home, away) team pair referenced by a "match moneyline" question.
 * Returns null if either side can't be resolved.
 */
export function pairFromMatchQuestion(
  question: string,
  data: DataPack,
): { teamA: string; teamB: string } | null {
  const q = normaliseString(question);
  const splitters = [" beat ", " vs ", " v ", " versus ", " against "];
  for (const sep of splitters) {
    const idx = q.indexOf(sep);
    if (idx < 0) continue;
    const left = q.slice(0, idx);
    const right = q.slice(idx + sep.length);
    const codeA = teamCodeFromLabel(left, data);
    const codeB = teamCodeFromLabel(right, data);
    if (codeA && codeB && codeA !== codeB) return { teamA: codeA, teamB: codeB };
  }
  // Fallback: pick the two highest-confidence team mentions in the question.
  const mentions: Team[] = [];
  for (const t of data.teams) {
    const cn = normaliseString(t.name);
    if (cn.length >= 4 && q.includes(cn)) mentions.push(t);
  }
  if (mentions.length >= 2) {
    return { teamA: mentions[0]!.code, teamB: mentions[1]!.code };
  }
  return null;
}

/**
 * Match a (teamA, teamB) pair to a fixture in fixtures.json. Group-stage
 * pairs are unique within the group, so we accept either order. Returns the
 * earliest matching upcoming fixture if there are multiple (e.g. knockout
 * could happen between same teams more than once theoretically).
 */
export function fixtureForPair(
  teamA: string,
  teamB: string,
  data: DataPack,
  hintKickoffMs?: number | null,
): Fixture | null {
  const candidates = data.fixtures.filter(
    (f) =>
      (f.home_team_slot === teamA && f.away_team_slot === teamB) ||
      (f.home_team_slot === teamB && f.away_team_slot === teamA),
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  // Pick the closest fixture to the hint kickoff if provided, else the earliest.
  if (hintKickoffMs != null) {
    candidates.sort(
      (a, b) =>
        Math.abs(Date.parse(a.kickoff_utc) - hintKickoffMs) -
        Math.abs(Date.parse(b.kickoff_utc) - hintKickoffMs),
    );
    return candidates[0]!;
  }
  candidates.sort((a, b) => a.match_number - b.match_number);
  return candidates[0]!;
}

/**
 * Generate a stable internal market id. Format intentionally human-readable.
 */
export function buildMarketId(
  kind: MarketKind,
  ref: { match_no?: number | null; team_code?: string | null; player_id?: string | null },
): string {
  if (kind === "match_moneyline" && ref.match_no != null) {
    return `wc2026:match:${ref.match_no}`;
  }
  if (kind === "tournament_winner" && ref.team_code) {
    return `wc2026:winner:${ref.team_code}`;
  }
  if (kind === "group_winner" && ref.team_code) {
    return `wc2026:group:${ref.team_code}`;
  }
  if (kind === "top_scorer" && ref.player_id) {
    return `wc2026:topscorer:${ref.player_id}`;
  }
  // Last resort — caller should avoid this branch.
  return `wc2026:${kind}:${ref.team_code ?? ref.player_id ?? "unknown"}`;
}

/**
 * Convert a Polymarket Yes-token price (0..1) to our canonical implied
 * probability with vig stripped from a single-outcome binary. Polymarket
 * Yes-prices are already implied probabilities, so this is identity for
 * binary markets. Kept as a function for symmetry with multi-outcome
 * normalisation below.
 */
export function impliedFromYesPrice(yesPrice: number): number {
  if (!Number.isFinite(yesPrice)) return 0;
  return Math.min(1, Math.max(0, yesPrice));
}

/**
 * Strip overround (vig) from a set of decimal odds. Used by the Odds API
 * adapter. Returns probabilities that sum to 1.
 */
export function stripVig(decimalOdds: number[]): number[] {
  const inv = decimalOdds.map((o) => (o > 0 ? 1 / o : 0));
  const total = inv.reduce((s, v) => s + v, 0);
  if (total <= 0) return decimalOdds.map(() => 0);
  return inv.map((v) => v / total);
}

/**
 * Median-of-bookmakers probabilities, vig-stripped per book. Input is an
 * array of bookmakers, each with the same outcome ordering.
 */
export function medianProbs(books: number[][]): number[] {
  if (books.length === 0) return [];
  const numOutcomes = books[0]!.length;
  const stripped = books.map(stripVig);
  const result: number[] = [];
  for (let i = 0; i < numOutcomes; i += 1) {
    const col = stripped.map((row) => row[i] ?? 0).sort((a, b) => a - b);
    const mid = Math.floor(col.length / 2);
    const med =
      col.length % 2 === 0 ? (col[mid - 1]! + col[mid]!) / 2 : col[mid]!;
    result.push(med);
  }
  // Re-normalise to defend against tiny rounding.
  const sum = result.reduce((s, v) => s + v, 0);
  return sum > 0 ? result.map((v) => v / sum) : result;
}
