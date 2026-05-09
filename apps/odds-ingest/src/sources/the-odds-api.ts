/**
 * The Odds API client. Free tier: 500 req/month at https://the-odds-api.com.
 *
 * We hit /sports/soccer_fifa_world_cup/odds?regions=us,uk,eu&markets=h2h
 * which returns one row per fixture, each with an array of bookmakers
 * each with home/away/draw decimal odds.
 *
 * We compute median-of-bookmakers, vig-stripped per book, then store one
 * tick per outcome.
 */

import { request } from "undici";

import { buildMarketId, fixtureForPair, medianProbs, teamCodeFromLabel } from "../normalise.js";
import type { DataPack } from "../data.js";
import type { OddsMarket, OddsTick, OutcomeMapping } from "../types.js";

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: {
    key: string; // "h2h" etc.
    last_update: string;
    outcomes: { name: string; price: number }[]; // decimal odds; "name" is team name or "Draw"
  }[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsApiClientOptions {
  baseUrl: string;
  apiKey: string;
  fetcher?: (url: string) => Promise<{ status: number; body: unknown }>;
}

async function undiciFetcher(url: string): Promise<{ status: number; body: unknown }> {
  const res = await request(url, { method: "GET", headersTimeout: 10_000, bodyTimeout: 15_000 });
  const body = (await res.body.json()) as unknown;
  return { status: res.statusCode, body };
}

export class OddsApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetcher: (url: string) => Promise<{ status: number; body: unknown }>;

  constructor(opts: OddsApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetcher = opts.fetcher ?? undiciFetcher;
  }

  /** GET /sports/soccer_fifa_world_cup/odds?... */
  async fetchH2H(): Promise<OddsApiEvent[]> {
    const url =
      `${this.baseUrl}/sports/soccer_fifa_world_cup/odds` +
      `?regions=us,uk,eu` +
      `&markets=h2h` +
      `&oddsFormat=decimal` +
      `&apiKey=${encodeURIComponent(this.apiKey)}`;
    const { status, body } = await this.fetcher(url);
    if (status !== 200) return [];
    if (!Array.isArray(body)) return [];
    return body as OddsApiEvent[];
  }
}

/**
 * Convert one Odds API event into our internal market + ticks. Outcome
 * order is always [home, draw, away] by convention so probabilities can be
 * vig-stripped consistently across books.
 */
export function oddsApiEventToInternal(
  event: OddsApiEvent,
  data: DataPack,
  now: number = Date.now(),
): { market: OddsMarket; ticks: OddsTick[] } | null {
  const homeCode = teamCodeFromLabel(event.home_team, data);
  const awayCode = teamCodeFromLabel(event.away_team, data);
  if (!homeCode || !awayCode || homeCode === awayCode) return null;
  const startsAt = Date.parse(event.commence_time);
  const fixture = fixtureForPair(
    homeCode,
    awayCode,
    data,
    Number.isFinite(startsAt) ? startsAt : null,
  );
  if (!fixture) return null;

  const id = buildMarketId("match_moneyline", { match_no: fixture.match_number });
  const outcomes: OutcomeMapping[] = [
    {
      label: data.byCode.get(homeCode)?.name ?? homeCode,
      our_team_code: homeCode,
      our_player_id: null,
      source_token_id: null,
    },
    { label: "Draw", our_team_code: null, our_player_id: null, source_token_id: null },
    {
      label: data.byCode.get(awayCode)?.name ?? awayCode,
      our_team_code: awayCode,
      our_player_id: null,
      source_token_id: null,
    },
  ];

  // Build per-book odds rows in [home, draw, away] order.
  const books: number[][] = [];
  for (const bk of event.bookmakers) {
    const market = bk.markets.find((m) => m.key === "h2h");
    if (!market) continue;
    const homeOdds = market.outcomes.find((o) => o.name === event.home_team)?.price;
    const awayOdds = market.outcomes.find((o) => o.name === event.away_team)?.price;
    const drawOdds = market.outcomes.find((o) => /draw/i.test(o.name))?.price;
    if (homeOdds == null || awayOdds == null) continue;
    books.push([homeOdds, drawOdds ?? 0, awayOdds]);
  }
  if (books.length === 0) return null;

  const probs = medianProbs(books);
  const market: OddsMarket = {
    id,
    source: "theoddsapi",
    source_id: event.id,
    match_id: String(fixture.match_number),
    kind: "match_moneyline",
    question: `${event.home_team} vs ${event.away_team}`,
    outcomes,
    starts_at: Number.isFinite(startsAt) ? startsAt : null,
    ends_at: null,
    resolved: false,
    resolved_outcome: null,
    updated_at: now,
  };
  const ticks: OddsTick[] = outcomes.map((om, idx) => ({
    market_id: id,
    outcome_label: om.label,
    best_bid: null,
    best_ask: null,
    last: null,
    implied_prob: probs[idx] ?? 0,
    volume_24h: null,
    ts: now,
  }));

  return { market, ticks };
}
