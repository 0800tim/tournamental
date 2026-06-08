import { describe, it, expect } from "vitest";
import { Bot } from "../src/bot.js";

type MockFetch = (url: string, init?: RequestInit) => Promise<Response>;

function okResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("Bot", () => {
  it("queues picks and flushes via the bulk endpoint", async () => {
    let captured: { url: string; body: string } | null = null;
    const fetchMock: MockFetch = (url, init) => {
      captured = { url: String(url), body: String(init?.body ?? "") };
      return Promise.resolve(
        okResponse({
          accepted: 1,
          dropped_picks: [],
          quota_remaining: { picks_per_hour: 99_999, bots_owned: 999 },
        }),
      );
    };
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "bot_a",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    bot.pick("1", "home_win");
    expect(bot.queueSize).toBe(1);
    const res = await bot.flush();
    expect(res.accepted).toBe(1);
    expect(bot.queueSize).toBe(0);
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("http://x/v1/picks/bulk");
    const parsed = JSON.parse(captured!.body);
    expect(parsed.tournament_id).toBe("fifa-wc-2026");
    expect(parsed.submissions[0].bot_id).toBe("bot_a");
    expect(parsed.submissions[0].picks).toEqual([
      { match_id: "1", outcome: "home_win" },
    ]);
  });

  it("re-picking the same match replaces the outcome", async () => {
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "bot_a",
      baseUrl: "http://x",
      fetchImpl: ((() =>
        Promise.resolve(
          okResponse({
            accepted: 1,
            dropped_picks: [],
            quota_remaining: { picks_per_hour: 0, bots_owned: 0 },
          }),
        )) as unknown) as typeof fetch,
    });
    bot.pick("m1", "home_win");
    bot.pick("m1", "draw");
    bot.pick("m2", "away_win");
    expect(bot.queueSize).toBe(2);
    const picks = bot.picks();
    expect(picks).toContainEqual({ match_id: "m1", outcome: "draw" });
    expect(picks).toContainEqual({ match_id: "m2", outcome: "away_win" });
  });

  it("retries on 503 with exponential backoff (succeeds on 3rd attempt)", async () => {
    let n = 0;
    const fetchMock: MockFetch = () => {
      n += 1;
      if (n < 3) return Promise.resolve(okResponse({}, 503));
      return Promise.resolve(
        okResponse({
          accepted: 1,
          dropped_picks: [],
          quota_remaining: { picks_per_hour: 99, bots_owned: 9 },
        }),
      );
    };
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "bot_a",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryBaseMs: 1,
    });
    bot.pick("1", "home_win");
    const res = await bot.flush();
    expect(res.accepted).toBe(1);
    expect(n).toBe(3);
  });

  it("retries on 429 (rate limit)", async () => {
    let n = 0;
    const fetchMock: MockFetch = () => {
      n += 1;
      if (n === 1) return Promise.resolve(okResponse({}, 429));
      return Promise.resolve(
        okResponse({
          accepted: 1,
          dropped_picks: [],
          quota_remaining: { picks_per_hour: 99, bots_owned: 9 },
        }),
      );
    };
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "bot_a",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryBaseMs: 1,
    });
    bot.pick("1", "home_win");
    const res = await bot.flush();
    expect(res.accepted).toBe(1);
    expect(n).toBe(2);
  });

  it("bails immediately on 4xx (non-429)", async () => {
    const fetchMock: MockFetch = () =>
      Promise.resolve(okResponse({ error: "bad_request" }, 400));
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "bot_a",
      baseUrl: "http://x",
      fetchImpl: fetchMock as unknown as typeof fetch,
      retryBaseMs: 1,
    });
    bot.pick("1", "home_win");
    await expect(bot.flush()).rejects.toThrow(/HTTP 400/);
    expect(bot.queueSize).toBe(1);
  });

  it("flush on empty queue is a no-op", async () => {
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "bot_a",
      baseUrl: "http://x",
      fetchImpl: ((() => {
        throw new Error("should not be called");
      }) as unknown) as typeof fetch,
    });
    const res = await bot.flush();
    expect(res.accepted).toBe(0);
  });

  it("rejects invalid outcomes", () => {
    const bot = new Bot({
      apiKey: "tnm_testkey_1234",
      botId: "bot_a",
      baseUrl: "http://x",
      fetchImpl: (() => Promise.resolve(okResponse({}))) as unknown as typeof fetch,
    });
    expect(() => bot.pick("1", "nope" as never)).toThrow(/invalid outcome/);
  });
});
