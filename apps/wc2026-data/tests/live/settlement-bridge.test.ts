/**
 * Settlement bridge tests.
 *
 * Coverage:
 *   - No POST when status != "final".
 *   - One POST on first final transition.
 *   - No second POST for the same (matchId, version) replay.
 *   - No second POST for an older version after settling.
 *   - Skips POST (with warn log) when gameInternalSecret is empty.
 *   - On non-2xx, doesn't mark as settled — retries on next call.
 *   - Computes winner correctly (home / away / draw).
 */

import { describe, expect, it, vi } from "vitest";

import { SettlementBridge } from "../../src/settlement-bridge.js";
import type { LiveMatchState } from "../../src/live/types.js";

function makeState(overrides: Partial<LiveMatchState> = {}): LiveMatchState {
  return {
    matchId: "1",
    status: "final",
    currentMinute: 90,
    homeScore: 2,
    awayScore: 1,
    scorers: [],
    latestEvents: [],
    version: 50,
    updatedAtUtc: "2026-06-11T21:30:00Z",
    ...overrides,
  };
}

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe("SettlementBridge", () => {
  it("does not POST on non-final states", async () => {
    const fetcher = vi.fn();
    const bridge = new SettlementBridge({
      gameBaseUrl: "http://game",
      gameInternalSecret: "shh",
      tournamentId: "t",
      fetcher,
      logger: noopLogger,
    });
    const r = await bridge.onMatchUpdate(makeState({ status: "live" }));
    expect(r.posted).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("POSTs once on first final transition", async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: {} }));
    const bridge = new SettlementBridge({
      gameBaseUrl: "http://game",
      gameInternalSecret: "shh",
      tournamentId: "fifa-wc-2026",
      fetcher,
      logger: noopLogger,
    });
    const r = await bridge.onMatchUpdate(makeState());
    expect(r.posted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, url, headers, body] = fetcher.mock.calls[0]!;
    expect(url).toBe("http://game/v1/match/1/result");
    expect((headers as Record<string, string>)["x-game-internal-secret"]).toBe("shh");
    const payload = JSON.parse(body as string);
    expect(payload.tournament_id).toBe("fifa-wc-2026");
    expect(payload.winner).toBe("home"); // 2-1
    expect(payload.outcome).toBe("decisive");
  });

  it("does not POST a second time for the same (matchId, version)", async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: {} }));
    const bridge = new SettlementBridge({
      gameBaseUrl: "http://game",
      gameInternalSecret: "shh",
      tournamentId: "t",
      fetcher,
      logger: noopLogger,
    });
    await bridge.onMatchUpdate(makeState({ version: 5 }));
    const r = await bridge.onMatchUpdate(makeState({ version: 5 }));
    expect(r.posted).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not POST for an older version after settling", async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: {} }));
    const bridge = new SettlementBridge({
      gameBaseUrl: "http://game",
      gameInternalSecret: "shh",
      tournamentId: "t",
      fetcher,
      logger: noopLogger,
    });
    await bridge.onMatchUpdate(makeState({ version: 10 }));
    const r = await bridge.onMatchUpdate(makeState({ version: 5 }));
    expect(r.posted).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries on subsequent calls if POST fails", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls++;
      return { status: calls === 1 ? 503 : 200, body: {} };
    });
    const bridge = new SettlementBridge({
      gameBaseUrl: "http://game",
      gameInternalSecret: "shh",
      tournamentId: "t",
      fetcher,
      logger: noopLogger,
    });
    const a = await bridge.onMatchUpdate(makeState({ version: 1 }));
    expect(a.posted).toBe(false);
    const b = await bridge.onMatchUpdate(makeState({ version: 1 }));
    expect(b.posted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("computes winner=draw correctly", async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: {} }));
    const bridge = new SettlementBridge({
      gameBaseUrl: "http://game",
      gameInternalSecret: "shh",
      tournamentId: "t",
      fetcher,
      logger: noopLogger,
    });
    await bridge.onMatchUpdate(makeState({ homeScore: 1, awayScore: 1 }));
    const payload = JSON.parse(fetcher.mock.calls[0]![3] as string);
    expect(payload.winner).toBe("draw");
    expect(payload.outcome).toBe("draw");
  });

  it("computes winner=away correctly", async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: {} }));
    const bridge = new SettlementBridge({
      gameBaseUrl: "http://game",
      gameInternalSecret: "shh",
      tournamentId: "t",
      fetcher,
      logger: noopLogger,
    });
    await bridge.onMatchUpdate(makeState({ homeScore: 0, awayScore: 2 }));
    const payload = JSON.parse(fetcher.mock.calls[0]![3] as string);
    expect(payload.winner).toBe("away");
  });

  it("skips the POST when no internal secret is configured (dev mode)", async () => {
    const fetcher = vi.fn();
    const warnings: string[] = [];
    const bridge = new SettlementBridge({
      gameBaseUrl: "http://game",
      gameInternalSecret: "",
      tournamentId: "t",
      fetcher,
      logger: {
        info: () => {},
        warn: (m) => warnings.push(m),
        error: () => {},
      },
    });
    const r = await bridge.onMatchUpdate(makeState());
    expect(r.posted).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(warnings.some((w) => /no WC2026_GAME_INTERNAL_SECRET/.test(w))).toBe(true);
  });

  it("reset() clears settlement state", async () => {
    const fetcher = vi.fn(async () => ({ status: 200, body: {} }));
    const bridge = new SettlementBridge({
      gameBaseUrl: "http://game",
      gameInternalSecret: "shh",
      tournamentId: "t",
      fetcher,
      logger: noopLogger,
    });
    await bridge.onMatchUpdate(makeState({ version: 5 }));
    bridge.reset();
    const r = await bridge.onMatchUpdate(makeState({ version: 5 }));
    expect(r.posted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
