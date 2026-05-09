import { describe, expect, it } from "vitest";
import { pino } from "pino";

import { loadConfig } from "../src/config.js";
import { loadDataPack } from "../src/data.js";
import { IngestPoller } from "../src/poller.js";
import { OddsStore } from "../src/store/sqlite.js";

const baseEnv: NodeJS.ProcessEnv = {
  ODDS_INGEST_DB_PATH: ":memory:",
  SOURCE_POLYMARKET_ENABLED: "true",
  SOURCE_THE_ODDS_API_ENABLED: "true",
  SOURCE_MOCK_ENABLED: "true",
  THE_ODDS_API_KEY: "",
};

const log = pino({ level: "silent" });

function freshFixture() {
  const data = loadDataPack();
  const store = new OddsStore({ dbPath: ":memory:" });
  const config = loadConfig({ ...process.env, ...baseEnv });
  const poller = new IngestPoller(config, store, data, log);
  return { data, store, poller };
}

describe("IngestPoller seedMockData", () => {
  it("seeds at least one mock market per resolvable group fixture", () => {
    const { store, poller, data } = freshFixture();
    const result = poller.seedMockData(1_700_000_000_000);
    expect(result.markets).toBeGreaterThan(40); // group fixtures alone are 72
    const all = store.listMarkets({ kind: "match_moneyline" });
    expect(all.length).toBeGreaterThan(40);
    // Tournament-winner markets exist for every team.
    const winners = store.listMarkets({ kind: "tournament_winner" });
    expect(winners.length).toBe(data.teams.length);
  });

  it("is idempotent — second call doesn't double-count or change probabilities", () => {
    const { store, poller } = freshFixture();
    poller.seedMockData(1_700_000_000_000);
    const before = store.listMarkets().length;
    const ticksBefore = store.latestTicksAll().length;
    poller.seedMockData(1_700_000_000_000);
    expect(store.listMarkets().length).toBe(before);
    expect(store.latestTicksAll().length).toBe(ticksBefore);
  });

  it("does not overwrite a Polymarket market with mock data", () => {
    const { store, poller } = freshFixture();
    // Pretend we already ingested a Polymarket market for fixture #1.
    store.upsertMarket({
      id: "wc2026:match:1",
      source: "polymarket",
      source_id: "real",
      match_id: "1",
      kind: "match_moneyline",
      question: "Real Polymarket market",
      outcomes: [],
      starts_at: null,
      ends_at: null,
      resolved: false,
      resolved_outcome: null,
      updated_at: 1,
    });
    poller.seedMockData();
    const stillReal = store.getMarket("wc2026:match:1");
    expect(stillReal?.source).toBe("polymarket");
  });
});

describe("IngestPoller pollGammaOnce", () => {
  it("upserts polymarket markets returned by the gamma client", async () => {
    const { store, poller } = freshFixture();
    // Inject a fake gamma client by reaching into the poller — the public
    // API of the class is intentionally narrow but for tests we monkey-patch
    // the private field via a cast to its known structural type.
    const fake = {
      fetchMarketsByTagSlugs: async () => [
        {
          conditionId: "real-1",
          question: "Will Argentina win the 2026 FIFA World Cup?",
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.18","0.82"]',
          clobTokenIds: '["t1","t2"]',
        },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poller as any).gamma = fake;
    const n = await poller.pollGammaOnce(1_700_000_000_000);
    expect(n).toBe(1);
    const market = store.getMarket("wc2026:winner:ARG");
    expect(market?.source).toBe("polymarket");
    const status = poller.getStatus();
    expect(status.source.polymarket).toBe("live");
  });

  it("marks the source degraded when the upstream fails", async () => {
    const { poller } = freshFixture();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poller as any).gamma = {
      fetchMarketsByTagSlugs: async () => {
        throw new Error("boom");
      },
    };
    const n = await poller.pollGammaOnce();
    expect(n).toBe(0);
    expect(poller.getStatus().source.polymarket).toBe("degraded");
    expect(poller.getStatus().last_error.polymarket_gamma).toBe("boom");
  });
});

describe("IngestPoller pollOddsApiOnce", () => {
  it("does nothing when no api key is configured", async () => {
    const { poller } = freshFixture();
    const n = await poller.pollOddsApiOnce();
    expect(n).toBe(0);
    expect(poller.getStatus().source.theoddsapi).toBe("down");
  });

  it("upserts the-odds-api events when wired with a fake client", async () => {
    const { store, poller } = freshFixture();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (poller as any).oddsApi = {
      fetchH2H: async () => [
        {
          id: "ev1",
          sport_key: "soccer_fifa_world_cup",
          sport_title: "FIFA World Cup",
          commence_time: "2026-06-11T19:00:00Z",
          home_team: "Mexico",
          away_team: "South Africa",
          bookmakers: [
            {
              key: "pinnacle",
              title: "Pinnacle",
              last_update: "",
              markets: [
                {
                  key: "h2h",
                  last_update: "",
                  outcomes: [
                    { name: "Mexico", price: 1.6 },
                    { name: "South Africa", price: 6.0 },
                    { name: "Draw", price: 4.0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const n = await poller.pollOddsApiOnce();
    expect(n).toBe(1);
    const m = store.getMarket("wc2026:match:1");
    expect(m?.source).toBe("theoddsapi");
  });
});
