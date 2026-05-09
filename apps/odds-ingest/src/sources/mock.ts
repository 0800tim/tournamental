/**
 * Deterministic mock odds source.
 *
 * Generates plausible W/D/L probabilities for every fixture in
 * `data/fifa-wc-2026/fixtures.json` from each team's FIFA ranking. Always
 * populated, used in tests and as the safety-net source when neither
 * Polymarket nor The Odds API has covered a fixture yet.
 *
 * Algorithm:
 *   - Convert a FIFA ranking to a "strength" (lower rank = higher strength).
 *   - Logistic over the strength gap predicts P(home win | no draw).
 *   - Apply a fixed draw rate (~22%) calibrated against historic World Cup data.
 *   - Renormalise so home + draw + away = 1.
 *   - Add deterministic per-match jitter (seeded by match_number) to avoid
 *     identical numbers for matches between similarly ranked teams.
 */

import { buildMarketId } from "../normalise.js";
import type { DataPack, Fixture } from "../data.js";
import type { OddsMarket, OddsTick, OutcomeMapping } from "../types.js";

/** Crude strength: 1 / log(rank + 1). Top teams ~1.0; bottom teams ~0.3. */
export function strengthFromRanking(rank: number | null): number {
  const r = rank == null || !Number.isFinite(rank) || rank <= 0 ? 60 : rank;
  return 1 / Math.log2(r + 4);
}

function seededJitter(seed: number): number {
  // Deterministic [-1, 1] from an integer seed (Mulberry32-ish).
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return r * 2 - 1;
}

export interface MockMatchProbs {
  home: number;
  draw: number;
  away: number;
}

const DRAW_BASE = 0.22; // ~22% historic World Cup draw rate
const HOME_ADVANTAGE = 0.05; // small bump for nominal home side

export function probsForFixture(
  fixture: Fixture,
  data: DataPack,
): MockMatchProbs | null {
  const home = data.byCode.get(fixture.home_team_slot);
  const away = data.byCode.get(fixture.away_team_slot);
  if (!home || !away) return null;

  const sH = strengthFromRanking(home.fifa_ranking_at_2026);
  const sA = strengthFromRanking(away.fifa_ranking_at_2026);
  const gap = sH - sA + HOME_ADVANTAGE;
  // Logistic over strength gap: tuned so a #1 vs #80 sits ~0.75/0.18/0.07.
  const pHomeNonDraw = 1 / (1 + Math.exp(-gap * 4));
  const drawJitter = seededJitter(fixture.match_number * 7919) * 0.04;
  const draw = Math.max(0.08, Math.min(0.35, DRAW_BASE + drawJitter));
  const remaining = 1 - draw;
  const homeJitter = seededJitter(fixture.match_number * 104729) * 0.03;
  const homeShare = Math.max(0.05, Math.min(0.95, pHomeNonDraw + homeJitter));
  const home_ = remaining * homeShare;
  const away_ = remaining * (1 - homeShare);
  return { home: home_, draw, away: away_ };
}

/**
 * Generate a moneyline market + tick triple for one fixture. The output is
 * deterministic for a given (fixture, data) pair so tests can pin values.
 */
export function mockMarketForFixture(
  fixture: Fixture,
  data: DataPack,
  now: number = Date.now(),
): { market: OddsMarket; ticks: OddsTick[] } | null {
  const probs = probsForFixture(fixture, data);
  if (!probs) return null;
  const home = data.byCode.get(fixture.home_team_slot)!;
  const away = data.byCode.get(fixture.away_team_slot)!;
  const id = buildMarketId("match_moneyline", { match_no: fixture.match_number });

  const outcomes: OutcomeMapping[] = [
    { label: home.name, our_team_code: home.code, our_player_id: null, source_token_id: null },
    { label: "Draw", our_team_code: null, our_player_id: null, source_token_id: null },
    { label: away.name, our_team_code: away.code, our_player_id: null, source_token_id: null },
  ];
  const market: OddsMarket = {
    id,
    source: "mock",
    source_id: `mock:${fixture.match_number}`,
    match_id: String(fixture.match_number),
    kind: "match_moneyline",
    question: `${home.name} vs ${away.name}`,
    outcomes,
    starts_at: Date.parse(fixture.kickoff_utc),
    ends_at: null,
    resolved: false,
    resolved_outcome: null,
    updated_at: now,
  };
  const ticks: OddsTick[] = [
    { market_id: id, outcome_label: home.name, best_bid: null, best_ask: null, last: null, implied_prob: probs.home, volume_24h: null, ts: now },
    { market_id: id, outcome_label: "Draw", best_bid: null, best_ask: null, last: null, implied_prob: probs.draw, volume_24h: null, ts: now },
    { market_id: id, outcome_label: away.name, best_bid: null, best_ask: null, last: null, implied_prob: probs.away, volume_24h: null, ts: now },
  ];
  return { market, ticks };
}

/**
 * Tournament-winner markets. One binary per qualified team. Probability
 * derived from rank-based strength, then normalised across the field so
 * the 48 probabilities sum to 1.
 */
export function mockTournamentWinners(
  data: DataPack,
  now: number = Date.now(),
): { markets: OddsMarket[]; ticks: OddsTick[] } {
  const strengths = data.teams.map((t) => ({
    team: t,
    strength: Math.pow(strengthFromRanking(t.fifa_ranking_at_2026), 4),
  }));
  const total = strengths.reduce((s, v) => s + v.strength, 0) || 1;
  const markets: OddsMarket[] = [];
  const ticks: OddsTick[] = [];
  for (const { team, strength } of strengths) {
    const id = buildMarketId("tournament_winner", { team_code: team.code });
    const prob = strength / total;
    markets.push({
      id,
      source: "mock",
      source_id: `mock:winner:${team.code}`,
      match_id: null,
      kind: "tournament_winner",
      question: `Will ${team.name} win the 2026 FIFA World Cup?`,
      outcomes: [
        { label: "Yes", our_team_code: team.code, our_player_id: null, source_token_id: null },
        { label: "No", our_team_code: null, our_player_id: null, source_token_id: null },
      ],
      starts_at: null,
      ends_at: null,
      resolved: false,
      resolved_outcome: null,
      updated_at: now,
    });
    ticks.push({
      market_id: id,
      outcome_label: "Yes",
      best_bid: null,
      best_ask: null,
      last: null,
      implied_prob: prob,
      volume_24h: null,
      ts: now,
    });
    ticks.push({
      market_id: id,
      outcome_label: "No",
      best_bid: null,
      best_ask: null,
      last: null,
      implied_prob: 1 - prob,
      volume_24h: null,
      ts: now,
    });
  }
  return { markets, ticks };
}
