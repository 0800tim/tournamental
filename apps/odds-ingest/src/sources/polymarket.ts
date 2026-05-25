/**
 * Polymarket Gamma + CLOB clients. Read-only; no auth.
 *
 * - Gamma: market metadata. https://gamma-api.polymarket.com
 *   We hit /markets?tag_slug=... or /markets?closed=false&active=true and
 *   filter client-side as a defensive fallback since Polymarket has changed
 *   query semantics historically.
 *
 * - CLOB: orderbook snapshot. https://clob.polymarket.com/book?token_id=...
 *   Returns top-of-book bid/ask. We compute mid = (bid + ask) / 2 as the
 *   implied probability for that outcome token (Yes-token price IS the
 *   probability for binary markets, which is what we use).
 */

import { request } from "undici";

import {
  buildMarketId,
  classifyMarket,
  fixtureForPair,
  impliedFromYesPrice,
  pairFromMatchQuestion,
  teamCodeFromLabel,
} from "../normalise.js";
import type { DataPack } from "../data.js";
import type { OddsMarket, OddsTick, OutcomeMapping } from "../types.js";

export interface GammaMarketRaw {
  id?: string;
  conditionId?: string;
  questionID?: string;
  question?: string;
  /** Per-outcome label within an event (e.g. "Mexico", "Draw (Mexico vs. …)"). */
  groupItemTitle?: string;
  description?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  tags?: string[] | { slug?: string; label?: string }[];
  /** Stringified arrays in the live API. */
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
  clobTokenIds?: string[] | string;
  startDate?: string;
  endDate?: string;
  volume24hr?: number | string;
  volume?: number | string;
}

/**
 * A Gamma "event" groups several child markets under one title. The 2026
 * World Cup futures and per-match moneylines are modelled this way:
 *
 *   - "2026 FIFA World Cup Winner"  -> 60 child markets, one per team,
 *     question "Will <Team> win the 2026 FIFA World Cup?".
 *   - "FIFA World Cup Group A Winner" -> child per team in the group,
 *     question "Will <Team> win Group A in the 2026 FIFA World Cup?".
 *   - "Mexico vs. South Africa" -> 3 child markets:
 *       "Will Mexico win on 2026-06-11?"            (groupItemTitle "Mexico")
 *       "Will Mexico vs. South Africa end in a draw?" (groupItemTitle "Draw …")
 *       "Will South Africa win on 2026-06-11?"      (groupItemTitle "South Africa")
 *
 * The flat `/markets?tag_slug=` query only ever returns the tournament-winner
 * children (they carry the tag individually); the group + per-match children
 * are reachable only through `/events?tag_slug=`. We therefore prefer the
 * events query and fall back to flat markets.
 */
export interface GammaEventRaw {
  id?: string;
  ticker?: string;
  slug?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  volume24hr?: number | string;
  markets?: GammaMarketRaw[];
}

export interface GammaClientOptions {
  baseUrl: string;
  /** Fetch override for tests. */
  fetcher?: typeof undiciFetcher;
}

async function undiciFetcher(url: string): Promise<{ status: number; body: unknown }> {
  const res = await request(url, { method: "GET", headersTimeout: 10_000, bodyTimeout: 15_000 });
  const body = (await res.body.json()) as unknown;
  return { status: res.statusCode, body };
}

export class PolymarketGammaClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof undiciFetcher;

  constructor(opts: GammaClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetcher = opts.fetcher ?? undiciFetcher;
  }

  /**
   * Fetch markets matching one of the World Cup tag slugs. The Gamma API has
   * shifted query shape over time; we try `tag_slug=` first then fall back
   * to a generic active-markets query and filter client-side.
   */
  async fetchMarketsByTagSlugs(tagSlugs: string[]): Promise<GammaMarketRaw[]> {
    const seen = new Map<string, GammaMarketRaw>();
    for (const slug of tagSlugs) {
      const url = `${this.baseUrl}/markets?tag_slug=${encodeURIComponent(slug)}&active=true&closed=false&limit=500`;
      try {
        const { status, body } = await this.fetcher(url);
        if (status !== 200 || !Array.isArray(body)) continue;
        for (const m of body as GammaMarketRaw[]) {
          const key = m.conditionId ?? m.id ?? m.slug;
          if (key) seen.set(key, m);
        }
      } catch {
        // Swallow per-slug errors; the next slug or the broad query may succeed.
      }
    }
    if (seen.size === 0) {
      // Broad fallback: pull recent active markets and filter client-side
      // by question text containing "world cup".
      try {
        const url = `${this.baseUrl}/markets?active=true&closed=false&limit=500`;
        const { status, body } = await this.fetcher(url);
        if (status === 200 && Array.isArray(body)) {
          for (const m of body as GammaMarketRaw[]) {
            const q = (m.question ?? "").toLowerCase();
            if (q.includes("world cup") || q.includes("fifa")) {
              const key = m.conditionId ?? m.id ?? m.slug;
              if (key) seen.set(key, m);
            }
          }
        }
      } catch {
        // Ignored; caller observes empty result.
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Fetch events (with nested child markets) for the World Cup tag slugs.
   * This is the only query shape that exposes group-winner and per-match
   * moneyline markets. Returns the de-duplicated event list.
   */
  async fetchEventsByTagSlugs(tagSlugs: string[]): Promise<GammaEventRaw[]> {
    const seen = new Map<string, GammaEventRaw>();
    for (const slug of tagSlugs) {
      const url = `${this.baseUrl}/events?tag_slug=${encodeURIComponent(slug)}&closed=false&limit=500`;
      try {
        const { status, body } = await this.fetcher(url);
        if (status !== 200 || !Array.isArray(body)) continue;
        for (const e of body as GammaEventRaw[]) {
          const key = e.id ?? e.slug ?? e.ticker ?? e.title;
          if (key) seen.set(key, e);
        }
      } catch {
        // Swallow per-slug errors; the next slug may succeed.
      }
    }
    return Array.from(seen.values());
  }
}

export interface ClobBookSnapshot {
  token_id: string;
  best_bid: number | null;
  best_ask: number | null;
  last_trade_price: number | null;
}

export class PolymarketClobClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof undiciFetcher;

  constructor(opts: { baseUrl: string; fetcher?: typeof undiciFetcher }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetcher = opts.fetcher ?? undiciFetcher;
  }

  async fetchBook(tokenId: string): Promise<ClobBookSnapshot | null> {
    const url = `${this.baseUrl}/book?token_id=${encodeURIComponent(tokenId)}`;
    try {
      const { status, body } = await this.fetcher(url);
      if (status !== 200 || !body || typeof body !== "object") return null;
      const b = body as {
        bids?: { price: string; size: string }[];
        asks?: { price: string; size: string }[];
      };
      const topBid = b.bids?.[0] ? parseFloat(b.bids[0].price) : null;
      const topAsk = b.asks?.[0] ? parseFloat(b.asks[0].price) : null;
      return {
        token_id: tokenId,
        best_bid: Number.isFinite(topBid) ? topBid : null,
        best_ask: Number.isFinite(topAsk) ? topAsk : null,
        last_trade_price: null,
      };
    } catch {
      return null;
    }
  }
}

/** Helper: parse Gamma's stringified-array fields. */
export function parseStringifiedArray(v: string[] | string | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Convert a raw Gamma market into our internal OddsMarket shape, plus a
 * derived OddsTick for the current outcome prices if Gamma provided them.
 * Returns null when the market can't be classified or mapped.
 */
export function gammaMarketToInternal(
  raw: GammaMarketRaw,
  data: DataPack,
  now: number = Date.now(),
): { market: OddsMarket; ticks: OddsTick[] } | null {
  const question = raw.question ?? "";
  const cls = classifyMarket(question);
  if (!cls) return null;

  const outcomes = parseStringifiedArray(raw.outcomes);
  const outcomePrices = parseStringifiedArray(raw.outcomePrices).map((p) => parseFloat(p));
  const tokenIds = parseStringifiedArray(raw.clobTokenIds);
  const startsAt = raw.startDate ? Date.parse(raw.startDate) : null;
  const endsAt = raw.endDate ? Date.parse(raw.endDate) : null;
  const sourceId = raw.conditionId ?? raw.id ?? raw.slug ?? null;
  if (!sourceId) return null;

  // Build outcome mappings + a candidate market id depending on kind.
  let id: string | null = null;
  let matchId: string | null = null;
  const outcomeMappings: OutcomeMapping[] = [];

  if (cls.kind === "tournament_winner") {
    // Two-outcome binary on a single team. Question of form "Will <Team> win the World Cup?".
    // Strip framing tokens with word boundaries so we don't accidentally chew
    // letters out of team names (e.g. "the" inside "Netherlands").
    const stripped = question.replace(
      /\b(will|the|2026|fifa|world\s+cup|win|to|world)\b/gi,
      "",
    );
    const teamCode = teamCodeFromLabel(stripped, data);
    if (!teamCode) return null;
    id = buildMarketId("tournament_winner", { team_code: teamCode });
    outcomes.forEach((label, idx) => {
      outcomeMappings.push({
        label,
        our_team_code: /^yes$/i.test(label) ? teamCode : null,
        our_player_id: null,
        source_token_id: tokenIds[idx] ?? null,
      });
    });
  } else if (cls.kind === "group_winner") {
    const stripped = question.replace(/\b(will|win|to|the|group\s+[a-l])\b/gi, "");
    const teamCode = teamCodeFromLabel(stripped, data);
    if (!teamCode) return null;
    id = buildMarketId("group_winner", { team_code: teamCode });
    outcomes.forEach((label, idx) => {
      outcomeMappings.push({
        label,
        our_team_code: /^yes$/i.test(label) ? teamCode : null,
        our_player_id: null,
        source_token_id: tokenIds[idx] ?? null,
      });
    });
  } else if (cls.kind === "match_moneyline") {
    const pair = pairFromMatchQuestion(question, data);
    if (!pair) return null;
    const fixture = fixtureForPair(pair.teamA, pair.teamB, data, startsAt);
    if (!fixture) return null;
    matchId = String(fixture.match_number);
    id = buildMarketId("match_moneyline", { match_no: fixture.match_number });
    // Polymarket per-match markets are commonly Yes/No on "Will A beat B?".
    // Map outcomes onto teamA / teamB / Draw heuristically.
    outcomes.forEach((label, idx) => {
      const lc = label.toLowerCase();
      let teamCode: string | null = null;
      if (/draw|tie/.test(lc)) teamCode = null;
      else if (/^yes$/i.test(lc)) teamCode = pair.teamA;
      else if (/^no$/i.test(lc)) teamCode = pair.teamB;
      else teamCode = teamCodeFromLabel(label, data);
      outcomeMappings.push({
        label,
        our_team_code: teamCode,
        our_player_id: null,
        source_token_id: tokenIds[idx] ?? null,
      });
    });
  } else if (cls.kind === "top_scorer") {
    // We can't always map a player without a player table; preserve the raw
    // outcomes but mark player_id null. The market still gets stored.
    id = `wc2026:topscorer:${sourceId}`;
    outcomes.forEach((label, idx) => {
      outcomeMappings.push({
        label,
        our_team_code: null,
        our_player_id: null,
        source_token_id: tokenIds[idx] ?? null,
      });
    });
  }

  if (!id) return null;

  const market: OddsMarket = {
    id,
    source: "polymarket",
    source_id: sourceId,
    match_id: matchId,
    kind: cls.kind,
    question,
    outcomes: outcomeMappings,
    starts_at: Number.isFinite(startsAt as number) ? (startsAt as number) : null,
    ends_at: Number.isFinite(endsAt as number) ? (endsAt as number) : null,
    resolved: !!raw.closed,
    resolved_outcome: null,
    updated_at: now,
  };

  const ticks: OddsTick[] = [];
  outcomes.forEach((label, idx) => {
    const yesPrice = outcomePrices[idx];
    if (yesPrice == null || !Number.isFinite(yesPrice)) return;
    ticks.push({
      market_id: id!,
      outcome_label: label,
      best_bid: null,
      best_ask: null,
      last: yesPrice,
      implied_prob: impliedFromYesPrice(yesPrice),
      volume_24h:
        typeof raw.volume24hr === "number"
          ? raw.volume24hr
          : raw.volume24hr
            ? parseFloat(String(raw.volume24hr))
            : null,
      ts: now,
    });
  });

  return { market, ticks };
}

/** First (Yes) price of a child binary market, or null. */
function childYesPrice(raw: GammaMarketRaw): number | null {
  const prices = parseStringifiedArray(raw.outcomePrices).map((p) => parseFloat(p));
  const yes = prices[0];
  return yes != null && Number.isFinite(yes) ? yes : null;
}

/** First (Yes) CLOB token id of a child binary market, or null. */
function childYesToken(raw: GammaMarketRaw): string | null {
  return parseStringifiedArray(raw.clobTokenIds)[0] ?? null;
}

/**
 * Convert a Gamma *event* (with nested child markets) into our internal
 * markets + ticks. Handles the three event shapes the bracket needs:
 * tournament-winner, group-winner, and per-match moneyline. Returns an
 * array because a single event (e.g. "Group A Winner") yields one internal
 * market per team. Returns [] when the event can't be classified.
 *
 * Per-match moneylines are de-vigged: the three child Yes-prices (home win,
 * draw, away win) are normalised to sum to 1 so the bracket shows true
 * implied probabilities (~MEX 66 / DRAW 21 / RSA 12 for Mexico v South Africa).
 */
export function gammaEventToInternal(
  event: GammaEventRaw,
  data: DataPack,
  now: number = Date.now(),
): { market: OddsMarket; ticks: OddsTick[] }[] {
  const children = event.markets ?? [];
  if (children.length === 0) return [];
  const title = event.title ?? "";
  const startsAt = event.startDate ? Date.parse(event.startDate) : null;
  const endsAt = event.endDate ? Date.parse(event.endDate) : null;
  const vol =
    typeof event.volume24hr === "number"
      ? event.volume24hr
      : event.volume24hr
        ? parseFloat(String(event.volume24hr))
        : null;

  const cls = classifyMarket(title) ?? classifyMarket(children[0]?.question ?? "");

  // --- Per-match moneyline: title looks like "A vs. B". ---------------------
  const pair = pairFromMatchQuestion(title, data);
  const looksLikeMatch =
    pair != null && (cls == null || cls.kind === "match_moneyline");
  if (looksLikeMatch && pair) {
    const fixture = fixtureForPair(pair.teamA, pair.teamB, data, startsAt);
    if (!fixture) return [];
    const home = data.byCode.get(fixture.home_team_slot);
    const away = data.byCode.get(fixture.away_team_slot);
    if (!home || !away) return [];

    // Bucket each child by what its Yes-outcome represents.
    let homeYes: { price: number; token: string | null } | null = null;
    let awayYes: { price: number; token: string | null } | null = null;
    let drawYes: { price: number; token: string | null } | null = null;
    for (const c of children) {
      const price = childYesPrice(c);
      if (price == null) continue;
      const token = childYesToken(c);
      const gt = (c.groupItemTitle ?? "").toLowerCase();
      if (/draw|tie/.test(gt) || /end in a draw/i.test(c.question ?? "")) {
        drawYes = { price, token };
      } else {
        const code = teamCodeFromLabel(c.groupItemTitle ?? c.question ?? "", data);
        if (code === home.code) homeYes = { price, token };
        else if (code === away.code) awayYes = { price, token };
      }
    }
    if (!homeYes || !awayYes) return [];

    // De-vig: normalise the three Yes-prices to sum to 1.
    const rawH = homeYes.price;
    const rawA = awayYes.price;
    const rawD = drawYes?.price ?? 0;
    const sum = rawH + rawA + rawD;
    const norm = sum > 0 ? sum : 1;
    const id = buildMarketId("match_moneyline", { match_no: fixture.match_number });

    const outcomes: OutcomeMapping[] = [
      { label: home.name, our_team_code: home.code, our_player_id: null, source_token_id: homeYes.token },
      { label: "Draw", our_team_code: null, our_player_id: null, source_token_id: drawYes?.token ?? null },
      { label: away.name, our_team_code: away.code, our_player_id: null, source_token_id: awayYes.token },
    ];
    const market: OddsMarket = {
      id,
      source: "polymarket",
      source_id: event.id ?? event.slug ?? title,
      match_id: String(fixture.match_number),
      kind: "match_moneyline",
      question: title,
      outcomes,
      starts_at: Number.isFinite(startsAt as number) ? (startsAt as number) : null,
      ends_at: Number.isFinite(endsAt as number) ? (endsAt as number) : null,
      resolved: !!event.closed,
      resolved_outcome: null,
      updated_at: now,
    };
    const mkTick = (label: string, p: number): OddsTick => ({
      market_id: id,
      outcome_label: label,
      best_bid: null,
      best_ask: null,
      last: p,
      implied_prob: Math.min(1, Math.max(0, p / norm)),
      volume_24h: vol,
      ts: now,
    });
    const ticks: OddsTick[] = [mkTick(home.name, rawH), mkTick(away.name, rawA)];
    if (drawYes) ticks.push(mkTick("Draw", rawD));
    return [{ market, ticks }];
  }

  // --- Group / tournament winner: one binary per team. ----------------------
  const kind: "group_winner" | "tournament_winner" | null =
    cls?.kind === "group_winner"
      ? "group_winner"
      : cls?.kind === "tournament_winner"
        ? "tournament_winner"
        : null;
  if (!kind) return [];

  const out: { market: OddsMarket; ticks: OddsTick[] }[] = [];
  for (const c of children) {
    const price = childYesPrice(c);
    if (price == null) continue;
    // Each child names a single team. Prefer the explicit per-outcome title.
    const code = teamCodeFromLabel(c.groupItemTitle ?? "", data) ??
      teamCodeFromLabel(c.question ?? "", data);
    if (!code) continue;
    const id = buildMarketId(kind, { team_code: code });
    const token = childYesToken(c);
    const market: OddsMarket = {
      id,
      source: "polymarket",
      source_id: c.conditionId ?? c.id ?? c.slug ?? null,
      match_id: null,
      kind,
      question: c.question ?? `${c.groupItemTitle} (${title})`,
      outcomes: [
        { label: "Yes", our_team_code: code, our_player_id: null, source_token_id: token },
        { label: "No", our_team_code: null, our_player_id: null, source_token_id: parseStringifiedArray(c.clobTokenIds)[1] ?? null },
      ],
      starts_at: Number.isFinite(startsAt as number) ? (startsAt as number) : null,
      ends_at: Number.isFinite(endsAt as number) ? (endsAt as number) : null,
      resolved: !!c.closed,
      resolved_outcome: null,
      updated_at: now,
    };
    out.push({
      market,
      ticks: [
        {
          market_id: id,
          outcome_label: "Yes",
          best_bid: null,
          best_ask: null,
          last: price,
          implied_prob: impliedFromYesPrice(price),
          volume_24h: vol,
          ts: now,
        },
      ],
    });
  }
  return out;
}
