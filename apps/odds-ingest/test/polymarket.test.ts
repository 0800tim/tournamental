import { describe, expect, it } from "vitest";

import { loadDataPack } from "../src/data.js";
import { bookToTick } from "../src/clob-snapshot.js";
import {
  PolymarketGammaClient,
  gammaEventToInternal,
  gammaMarketToInternal,
  parseStringifiedArray,
} from "../src/sources/polymarket.js";

const data = loadDataPack();

describe("parseStringifiedArray", () => {
  it("parses Gamma's stringified arrays", () => {
    expect(parseStringifiedArray('["Yes","No"]')).toEqual(["Yes", "No"]);
    expect(parseStringifiedArray(["Yes", "No"])).toEqual(["Yes", "No"]);
    expect(parseStringifiedArray(undefined)).toEqual([]);
    expect(parseStringifiedArray("not-json")).toEqual([]);
  });
});

describe("gammaMarketToInternal - tournament winner", () => {
  it("maps 'Will Argentina win the 2026 FIFA World Cup?' to wc2026:winner:ARG", () => {
    const raw = {
      conditionId: "0xdeadbeef",
      question: "Will Argentina win the 2026 FIFA World Cup?",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.18","0.82"]',
      clobTokenIds: '["tok-yes","tok-no"]',
      startDate: "2026-06-11T00:00:00Z",
      endDate: "2026-07-19T23:59:59Z",
      active: true,
      closed: false,
      volume24hr: 12345,
    };
    const out = gammaMarketToInternal(raw, data, 1_700_000_000_000);
    expect(out).not.toBeNull();
    expect(out!.market.id).toBe("wc2026:winner:ARG");
    expect(out!.market.kind).toBe("tournament_winner");
    expect(out!.market.source).toBe("polymarket");
    expect(out!.market.source_id).toBe("0xdeadbeef");
    expect(out!.ticks.length).toBe(2);
    const yes = out!.ticks.find((t) => t.outcome_label === "Yes");
    expect(yes?.implied_prob).toBeCloseTo(0.18, 5);
  });
});

describe("gammaMarketToInternal - group winner", () => {
  it("maps 'Will Brazil win Group C?' to wc2026:group:BRA", () => {
    const raw = {
      conditionId: "g-bra-c",
      question: "Will Brazil win Group C?",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.42","0.58"]',
      clobTokenIds: '["tk1","tk2"]',
    };
    const out = gammaMarketToInternal(raw, data);
    expect(out).not.toBeNull();
    expect(out!.market.id).toBe("wc2026:group:BRA");
    expect(out!.market.kind).toBe("group_winner");
  });
});

describe("gammaMarketToInternal - match moneyline", () => {
  it("maps a real fixture pair to wc2026:match:<n>", () => {
    // Match #1 in fixtures.json is MEX vs RSA.
    const raw = {
      conditionId: "match-mex-rsa",
      question: "Will Mexico beat South Africa?",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.62","0.38"]',
      clobTokenIds: '["yes","no"]',
      startDate: "2026-06-11T19:00:00Z",
    };
    const out = gammaMarketToInternal(raw, data);
    expect(out).not.toBeNull();
    expect(out!.market.id).toBe("wc2026:match:1");
    expect(out!.market.match_id).toBe("1");
    expect(out!.market.kind).toBe("match_moneyline");
  });

  it("returns null when neither team can be resolved", () => {
    const raw = {
      conditionId: "x",
      question: "Will Atlantis beat Mu?",
      outcomes: '["Yes","No"]',
    };
    expect(gammaMarketToInternal(raw, data)).toBeNull();
  });
});

describe("gammaMarketToInternal - top scorer", () => {
  it("classifies 'Top scorer' markets even without a player table", () => {
    const raw = {
      conditionId: "ts-1",
      question: "Will Mbappé be top scorer at the 2026 FIFA World Cup?",
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.08","0.92"]',
    };
    const out = gammaMarketToInternal(raw, data);
    expect(out).not.toBeNull();
    expect(out!.market.kind).toBe("top_scorer");
    expect(out!.market.id.startsWith("wc2026:topscorer:")).toBe(true);
  });
});

describe("gammaEventToInternal - per-match moneyline from nested children", () => {
  it("de-vigs Mexico vs South Africa into home/draw/away ticks on wc2026:match:1", () => {
    // Mirrors the live Polymarket event shape: three Yes/No child binaries.
    const event = {
      id: "ev-mex-rsa",
      title: "Mexico vs. South Africa",
      startDate: "2026-06-11T19:00:00Z",
      closed: false,
      volume24hr: 50000,
      markets: [
        {
          question: "Will Mexico win on 2026-06-11?",
          groupItemTitle: "Mexico",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.665","0.335"]',
          clobTokenIds: '["mex-yes","mex-no"]',
        },
        {
          question: "Will Mexico vs. South Africa end in a draw?",
          groupItemTitle: "Draw (Mexico vs. South Africa)",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.215","0.785"]',
          clobTokenIds: '["draw-yes","draw-no"]',
        },
        {
          question: "Will South Africa win on 2026-06-11?",
          groupItemTitle: "South Africa",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.125","0.875"]',
          clobTokenIds: '["rsa-yes","rsa-no"]',
        },
      ],
    };
    const out = gammaEventToInternal(event, data, 1_700_000_000_000);
    expect(out.length).toBe(1);
    const { market, ticks } = out[0]!;
    expect(market.id).toBe("wc2026:match:1");
    expect(market.kind).toBe("match_moneyline");
    expect(market.source).toBe("polymarket");
    // Three de-vigged ticks summing to 1.
    const map = new Map(ticks.map((t) => [t.outcome_label, t.implied_prob]));
    expect(map.get("Mexico")).toBeCloseTo(0.665 / 1.005, 3);
    expect(map.get("Draw")).toBeCloseTo(0.215 / 1.005, 3);
    expect(map.get("South Africa")).toBeCloseTo(0.125 / 1.005, 3);
    const sum = [...map.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    // The home/away outcomes carry their Yes CLOB token for snapshotting.
    expect(market.outcomes.find((o) => o.label === "Mexico")?.source_token_id).toBe("mex-yes");
  });

  it("maps a 'Group A Winner' event into one wc2026:group:<CODE> per team", () => {
    const event = {
      id: "ev-grp-a",
      title: "FIFA World Cup Group A Winner",
      markets: [
        {
          conditionId: "ga-mex",
          question: "Will Mexico win Group A in the 2026 FIFA World Cup?",
          groupItemTitle: "Mexico",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.52","0.48"]',
          clobTokenIds: '["t1","t2"]',
        },
        {
          conditionId: "ga-rsa",
          question: "Will South Africa win Group A in the 2026 FIFA World Cup?",
          groupItemTitle: "South Africa",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.0565","0.9435"]',
          clobTokenIds: '["t3","t4"]',
        },
      ],
    };
    const out = gammaEventToInternal(event, data);
    expect(out.length).toBe(2);
    const mex = out.find((o) => o.market.id === "wc2026:group:MEX");
    expect(mex).toBeDefined();
    expect(mex!.market.kind).toBe("group_winner");
    expect(mex!.ticks[0]!.outcome_label).toBe("Yes");
    expect(mex!.ticks[0]!.implied_prob).toBeCloseTo(0.52, 5);
  });
});

describe("PolymarketGammaClient with mocked fetcher", () => {
  it("dedupes markets across multiple tag slugs", async () => {
    const calls: string[] = [];
    const client = new PolymarketGammaClient({
      baseUrl: "https://example.test",
      fetcher: async (url: string) => {
        calls.push(url);
        if (url.includes("tag_slug=fifa-world-cup")) {
          return {
            status: 200,
            body: [{ conditionId: "x1", question: "Will Argentina win the 2026 FIFA World Cup?" }],
          };
        }
        if (url.includes("tag_slug=fifa-2026")) {
          return {
            status: 200,
            body: [{ conditionId: "x1", question: "Will Argentina win the 2026 FIFA World Cup?" }],
          };
        }
        return { status: 200, body: [] };
      },
    });
    const out = await client.fetchMarketsByTagSlugs(["fifa-world-cup", "fifa-2026", "missing"]);
    expect(out.length).toBe(1);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it("falls back to a generic active-markets query when all slugs return empty", async () => {
    let fellBack = false;
    const client = new PolymarketGammaClient({
      baseUrl: "https://example.test",
      fetcher: async (url: string) => {
        if (url.includes("tag_slug=")) return { status: 200, body: [] };
        fellBack = true;
        return {
          status: 200,
          body: [
            { conditionId: "wc-arg", question: "Will Argentina win the 2026 FIFA World Cup?" },
            { conditionId: "off-topic", question: "Will Bitcoin hit $100k?" },
          ],
        };
      },
    });
    const out = await client.fetchMarketsByTagSlugs(["nope"]);
    expect(fellBack).toBe(true);
    expect(out.length).toBe(1); // only the WC market should pass the client-side filter
  });

  it("survives an upstream HTTP error and returns an empty array", async () => {
    const client = new PolymarketGammaClient({
      baseUrl: "https://example.test",
      fetcher: async () => {
        throw new Error("ECONNRESET");
      },
    });
    const out = await client.fetchMarketsByTagSlugs(["x"]);
    expect(out).toEqual([]);
  });
});

describe("bookToTick", () => {
  it("produces a tick with mid-price implied probability", () => {
    const tick = bookToTick(
      "wc2026:winner:ARG",
      "Yes",
      { token_id: "t", best_bid: 0.18, best_ask: 0.20, last_trade_price: null },
      1_700_000_000_000,
    );
    expect(tick).not.toBeNull();
    expect(tick!.implied_prob).toBeCloseTo(0.19, 5);
    expect(tick!.best_bid).toBe(0.18);
    expect(tick!.best_ask).toBe(0.20);
  });

  it("returns null when the book has no levels", () => {
    expect(
      bookToTick(
        "x",
        "Yes",
        { token_id: "t", best_bid: null, best_ask: null, last_trade_price: null },
        0,
      ),
    ).toBeNull();
  });

  it("rejects an illiquid wide-spread book so the Gamma price stands", () => {
    // Far-out WC markets often show best_bid 0.01 / best_ask 0.99; the 0.50
    // mid is meaningless and must not clobber the de-vigged Gamma value.
    expect(
      bookToTick(
        "wc2026:match:1",
        "Mexico",
        { token_id: "t", best_bid: 0.01, best_ask: 0.99, last_trade_price: null },
        0,
      ),
    ).toBeNull();
  });
});
