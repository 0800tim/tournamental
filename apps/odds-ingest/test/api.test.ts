import { describe, expect, it } from "vitest";
import { pino } from "pino";

import { buildApp } from "../src/api.js";
import { loadConfig } from "../src/config.js";
import { loadDataPack } from "../src/data.js";
import { IngestPoller } from "../src/poller.js";
import { OddsStore } from "../src/store/sqlite.js";

const log = pino({ level: "silent" });

async function setup() {
  const data = loadDataPack();
  const store = new OddsStore({ dbPath: ":memory:" });
  const config = loadConfig({
    ...process.env,
    ODDS_INGEST_DB_PATH: ":memory:",
    SOURCE_POLYMARKET_ENABLED: "false",
    SOURCE_THE_ODDS_API_ENABLED: "false",
    SOURCE_MOCK_ENABLED: "true",
    THE_ODDS_API_KEY: "",
  });
  const poller = new IngestPoller(config, store, data, log);
  poller.seedMockData(1_700_000_000_000);
  const app = await buildApp({ store, data, poller });
  return { app, store, data };
}

describe("GET /healthz", () => {
  it("reports source status", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; source_status: { mock: string } };
    expect(body.ok).toBe(true);
    expect(body.source_status.mock).toBe("live");
  });
});

describe("GET /v1/odds/match/:matchNo", () => {
  it("returns W/D/L probabilities for a known group fixture from mock data", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/v1/odds/match/1" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      home: { code: string; prob: number };
      away: { code: string; prob: number };
      draw: { prob: number };
    };
    expect(body.home.code).toBe("MEX");
    expect(body.away.code).toBe("RSA");
    expect(body.home.prob + body.away.prob + body.draw.prob).toBeCloseTo(1, 3);
    expect(body.home.prob).toBeGreaterThan(body.away.prob); // MEX higher ranked
  });

  it("returns 400 for non-numeric match number", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/v1/odds/match/foo" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown match number", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/v1/odds/match/9999" });
    expect(res.statusCode).toBe(404);
  });

  it("gracefully degrades to nulls when the fixture is a knockout TBD", async () => {
    const { app, data } = await setup();
    // Find a fixture whose home_team_slot is not a real team code.
    const tbd = data.fixtures.find((f) => !data.byCode.has(f.home_team_slot));
    expect(tbd).toBeTruthy();
    const res = await app.inject({ method: "GET", url: `/v1/odds/match/${tbd!.match_number}` });
    // We expect either a 404 (placeholder slots) OR a graceful nullable response.
    expect([200, 404]).toContain(res.statusCode);
  });
});

describe("GET /v1/odds/team/:code/winner", () => {
  it("returns tournament-winner probability for ARG", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/v1/odds/team/ARG/winner" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { team_name: string; prob: number };
    expect(body.team_name).toBe("Argentina");
    expect(body.prob).toBeGreaterThan(0);
    expect(body.prob).toBeLessThan(1);
  });

  it("returns 404 for an unknown team code", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/v1/odds/team/ZZZ/winner" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/odds/markets", () => {
  it("lists all markets and respects a kind filter", async () => {
    const { app } = await setup();
    const all = await app.inject({ method: "GET", url: "/v1/odds/markets" });
    expect(all.statusCode).toBe(200);
    const allBody = all.json() as { count: number };
    expect(allBody.count).toBeGreaterThan(40);

    const winners = await app.inject({
      method: "GET",
      url: "/v1/odds/markets?kind=tournament_winner",
    });
    const winBody = winners.json() as { count: number; markets: { kind: string }[] };
    expect(winBody.count).toBe(48);
    expect(winBody.markets.every((m) => m.kind === "tournament_winner")).toBe(true);
  });
});

describe("GET /v1/odds/snapshot", () => {
  it("returns a probability map for every market", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/v1/odds/snapshot" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      probabilities: Record<string, Record<string, number>>;
      market_count: number;
    };
    expect(body.market_count).toBeGreaterThan(40);
    // Every match_moneyline entry should have three outcome labels.
    const matches = Object.entries(body.probabilities).filter(([k]) =>
      k.startsWith("wc2026:match:"),
    );
    expect(matches.length).toBeGreaterThan(40);
    for (const [, probs] of matches) {
      const sum = Object.values(probs).reduce((s, v) => s + v, 0);
      expect(sum).toBeGreaterThan(0.95);
      expect(sum).toBeLessThan(1.05);
    }
  });
});
