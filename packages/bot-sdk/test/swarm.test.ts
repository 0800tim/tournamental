import { describe, it, expect } from "vitest";
import { Swarm } from "../src/swarm.js";

function okResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("Swarm", () => {
  it("runs eachBot in parallel and flushes once per bot", async () => {
    const calls: string[] = [];
    const swarm = new Swarm({
      apiKey: "tnm_testkey_1234",
      baseUrl: "http://x",
      botIds: ["bot_a", "bot_b", "bot_c"],
      fetchImpl: ((url: string) => {
        calls.push(String(url));
        return Promise.resolve(
          okResponse({
            accepted: 1,
            dropped_picks: [],
            quota_remaining: { picks_per_hour: 99, bots_owned: 9 },
          }),
        );
      }) as unknown as typeof fetch,
    });
    const stats = await swarm.eachBot(async (bot) => {
      bot.pick("1", "home_win");
    });
    expect(calls.length).toBe(3);
    expect(stats).toEqual({ bots: 3, ok: 3, failed: 0 });
  });

  it("respects concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ids = Array.from({ length: 20 }, (_, i) => `bot_${i}`);
    const swarm = new Swarm({
      apiKey: "tnm_testkey_1234",
      baseUrl: "http://x",
      botIds: ids,
      concurrency: 4,
      fetchImpl: (async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return okResponse({
          accepted: 1,
          dropped_picks: [],
          quota_remaining: { picks_per_hour: 1, bots_owned: 1 },
        });
      }) as unknown as typeof fetch,
    });
    await swarm.eachBot(async (bot) => {
      bot.pick("1", "home_win");
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("counts failures without stopping the swarm", async () => {
    let n = 0;
    const swarm = new Swarm({
      apiKey: "tnm_testkey_1234",
      baseUrl: "http://x",
      botIds: ["bot_a", "bot_b", "bot_c"],
      retryBaseMs: 1,
      fetchImpl: (() => {
        n += 1;
        if (n === 2) return Promise.resolve(okResponse({ err: "bad" }, 400));
        return Promise.resolve(
          okResponse({
            accepted: 1,
            dropped_picks: [],
            quota_remaining: { picks_per_hour: 0, bots_owned: 0 },
          }),
        );
      }) as unknown as typeof fetch,
    });
    const stats = await swarm.eachBot(async (bot) => {
      bot.pick("1", "home_win");
    });
    expect(stats.bots).toBe(3);
    expect(stats.ok + stats.failed).toBe(3);
    expect(stats.failed).toBeGreaterThanOrEqual(1);
  });

  it("rejects an empty bot list", () => {
    expect(
      () =>
        new Swarm({
          apiKey: "tnm_testkey_1234",
          baseUrl: "http://x",
          botIds: [],
        }),
    ).toThrow(/at least one botId/);
  });
});
