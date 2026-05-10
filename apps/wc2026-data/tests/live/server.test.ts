/**
 * Fastify server tests for the wc2026-data live service.
 *
 * Coverage:
 *   - GET /healthz returns ok + backend.
 *   - GET /v1/version returns version + provider name.
 *   - GET /v1/upcoming returns fixtures from the injected provider.
 *   - GET /v1/match/:id returns the snapshot.
 *   - GET /v1/match/:id with bad id → 400.
 *   - GET /v1/match/:id when provider throws missing-key → 503.
 *   - SSE /v1/match/:id/stream emits a `ready` event then snapshot frames.
 *   - POST /v1/admin/reset gated by x-internal-secret when configured.
 *   - POST /v1/admin/reset rejected for non-mock backends.
 */

import { describe, expect, it } from "vitest";

import { buildServer } from "../../src/server.js";
import { MockLiveDataProvider } from "../../src/live/mock-provider.js";
import { MissingApiKeyError } from "../../src/live/sportradar-provider.js";
import type { LiveDataProvider, LiveMatchState, LiveMatchUpdate } from "../../src/live/types.js";

const FIXTURES = [
  {
    match_number: 1,
    home_team_slot: "MEX",
    away_team_slot: "RSA",
    host_city_id: "mexico_city",
    kickoff_utc: "2026-06-11T19:00:00Z",
    stage: "group_a",
  },
];

function makeMockProvider(): MockLiveDataProvider {
  return new MockLiveDataProvider({
    fixtures: FIXTURES,
    nowMs: () => Date.parse("2026-06-10T00:00:00Z"),
    minutesPerTick: 1,
    tickIntervalMs: 30,
  });
}

describe("server: meta routes", () => {
  it("GET /healthz returns ok", async () => {
    const provider = makeMockProvider();
    const { app } = await buildServer({ provider, env: { WC2026_DATA_BACKEND: "mock" }, bridge: null });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.backend).toBe("mock");
    await app.close();
  });

  it("GET /v1/version returns version + provider name", async () => {
    const provider = makeMockProvider();
    const { app } = await buildServer({ provider, env: { WC2026_DATA_BACKEND: "mock" }, bridge: null });
    const res = await app.inject({ method: "GET", url: "/v1/version" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.providerName).toBe("mock");
    expect(body.backend).toBe("mock");
    expect(typeof body.version).toBe("string");
    await app.close();
  });
});

describe("server: data routes", () => {
  it("GET /v1/upcoming returns fixtures", async () => {
    const provider = makeMockProvider();
    const { app } = await buildServer({ provider, env: {}, bridge: null });
    const res = await app.inject({ method: "GET", url: "/v1/upcoming?limit=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.fixtures)).toBe(true);
    expect(body.fixtures[0].matchId).toBe("1");
    await app.close();
  });

  it("GET /v1/match/:id returns the snapshot", async () => {
    const provider = makeMockProvider();
    const { app } = await buildServer({ provider, env: {}, bridge: null });
    const res = await app.inject({ method: "GET", url: "/v1/match/1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.state.matchId).toBe("1");
    expect(body.state.status).toBe("scheduled");
    await app.close();
  });

  it("GET /v1/match/:id with empty id → 400", async () => {
    const provider = makeMockProvider();
    const { app } = await buildServer({ provider, env: {}, bridge: null });
    const res = await app.inject({
      method: "GET",
      url: `/v1/match/${"x".repeat(65)}`,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("GET /v1/match/:id with unknown id → 404", async () => {
    const provider = makeMockProvider();
    const { app } = await buildServer({ provider, env: {}, bridge: null });
    const res = await app.inject({ method: "GET", url: "/v1/match/9999" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("GET /v1/match/:id surfaces 503 on missing-key error", async () => {
    const broken: LiveDataProvider = {
      name: "sportradar",
      async fetchUpcoming() {
        throw new MissingApiKeyError("sportradar");
      },
      async fetchMatch() {
        throw new MissingApiKeyError("sportradar");
      },
      subscribeMatch() {
        return () => {};
      },
    };
    const { app } = await buildServer({ provider: broken, env: { WC2026_DATA_BACKEND: "sportradar" }, bridge: null });
    const res = await app.inject({ method: "GET", url: "/v1/match/abc" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("missing_api_key");
    await app.close();
  });
});

describe("server: SSE", () => {
  it("emits ready event then a snapshot frame", async () => {
    let unsubscribed = false;
    const synthetic: LiveDataProvider = {
      name: "mock",
      async fetchUpcoming() {
        return [];
      },
      async fetchMatch() {
        return makeFinalState();
      },
      subscribeMatch(_id: string, on: LiveMatchUpdate) {
        // Emit a synthetic snapshot on the next tick so the listener has
        // time to register `data` handlers.
        setImmediate(() => on(makeFinalState()));
        return () => {
          unsubscribed = true;
        };
      },
    };
    const { app } = await buildServer({ provider: synthetic, env: {}, bridge: null });
    // Bind a real socket — `inject()` buffers SSE writes oddly and we want
    // to see the real HTTP framing.
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const chunks: string[] = [];
    const url = `http://127.0.0.1:${port}/v1/match/1/stream`;
    const buf = await new Promise<string>((resolve, reject) => {
      const req = require("node:http").get(url, (res: import("node:http").IncomingMessage) => {
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          chunks.push(chunk);
          // Once we've seen both the ready event and at least one data frame, close.
          const all = chunks.join("");
          if (all.includes("event: ready") && all.includes('"matchId":"1"') && /data: \{[^}]*"status"/.test(all)) {
            req.destroy();
            resolve(all);
          }
        });
        res.on("error", reject);
      });
      req.on("error", (err: Error) => {
        if ((err as NodeJS.ErrnoException).code === "ECONNRESET") resolve(chunks.join(""));
        else reject(err);
      });
      // Safety timeout.
      setTimeout(() => {
        req.destroy();
        resolve(chunks.join(""));
      }, 2000);
    });
    expect(buf).toContain("event: ready");
    expect(buf).toContain('"matchId":"1"');
    // Give the close handler a moment to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(unsubscribed).toBe(true);
    await app.close();
  });

  it("rejects oversized match ids on the SSE route", async () => {
    const provider = makeMockProvider();
    const { app } = await buildServer({ provider, env: {}, bridge: null });
    const res = await app.inject({ method: "GET", url: `/v1/match/${"x".repeat(65)}/stream` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("server: admin", () => {
  it("POST /v1/admin/reset succeeds without auth when no secret is set", async () => {
    const provider = makeMockProvider();
    const { app } = await buildServer({ provider, env: {}, bridge: null });
    const res = await app.inject({ method: "POST", url: "/v1/admin/reset" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it("POST /v1/admin/reset requires x-internal-secret when configured", async () => {
    const provider = makeMockProvider();
    const { app } = await buildServer({
      provider,
      env: { WC2026_DATA_ADMIN_SECRET: "shh" },
      bridge: null,
    });
    const r1 = await app.inject({ method: "POST", url: "/v1/admin/reset" });
    expect(r1.statusCode).toBe(401);
    const r2 = await app.inject({
      method: "POST",
      url: "/v1/admin/reset",
      headers: { "x-internal-secret": "shh" },
    });
    expect(r2.statusCode).toBe(200);
    await app.close();
  });

  it("POST /v1/admin/reset rejects on non-mock backend", async () => {
    const fakeReal: LiveDataProvider = {
      name: "sportradar",
      async fetchUpcoming() {
        return [];
      },
      async fetchMatch() {
        return makeFinalState();
      },
      subscribeMatch() {
        return () => {};
      },
    };
    const { app } = await buildServer({ provider: fakeReal, env: { WC2026_DATA_BACKEND: "sportradar" }, bridge: null });
    const res = await app.inject({ method: "POST", url: "/v1/admin/reset" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

function makeFinalState(): LiveMatchState {
  return {
    matchId: "1",
    status: "final",
    currentMinute: 90,
    homeScore: 1,
    awayScore: 0,
    scorers: [],
    latestEvents: [],
    version: 1,
    updatedAtUtc: "2026-06-11T21:30:00Z",
  };
}
