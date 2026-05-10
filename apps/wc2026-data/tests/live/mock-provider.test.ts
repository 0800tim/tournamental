/**
 * Deterministic state-machine tests for the mock live-data provider.
 *
 * Coverage:
 *   - fetchUpcoming returns kickoff-ascending fixtures and respects limit.
 *   - tick() advances scheduled → live → ht → live → final cleanly.
 *   - Goal events bump score, push scorers, push events, increment version.
 *   - Random goal generation is deterministic given a seed (same matchId
 *     produces the same goal-pattern across runs).
 *   - reset() / resetAll() cycle the machine.
 *   - subscribeMatch fires expected sequence end-to-end.
 *   - hostFromCity maps every host city in the fixtures file.
 */

import { describe, expect, it, vi } from "vitest";

import {
  MockLiveDataProvider,
  hostFromCity,
  seededRand,
} from "../../src/live/mock-provider.js";
import type { LiveMatchState } from "../../src/live/types.js";

const FIXTURES = [
  {
    match_number: 1,
    home_team_slot: "MEX",
    away_team_slot: "RSA",
    host_city_id: "mexico_city",
    kickoff_utc: "2026-06-11T19:00:00Z",
    stage: "group_a",
  },
  {
    match_number: 2,
    home_team_slot: "KOR",
    away_team_slot: "CZE",
    host_city_id: "guadalajara",
    kickoff_utc: "2026-06-12T22:00:00Z",
    stage: "group_a",
  },
  {
    match_number: 7,
    home_team_slot: "CAN",
    away_team_slot: "BIH",
    host_city_id: "toronto",
    kickoff_utc: "2026-06-12T19:00:00Z",
    stage: "group_b",
  },
];

function makeProvider(opts: { now?: number; minutesPerTick?: number } = {}): MockLiveDataProvider {
  return new MockLiveDataProvider({
    fixtures: FIXTURES,
    nowMs: () => opts.now ?? Date.parse("2026-06-10T00:00:00Z"),
    minutesPerTick: opts.minutesPerTick ?? 1,
    tickIntervalMs: 50,
  });
}

describe("hostFromCity", () => {
  it("maps US/CA/MX cities correctly", () => {
    expect(hostFromCity("mexico_city")).toBe("MX");
    expect(hostFromCity("guadalajara")).toBe("MX");
    expect(hostFromCity("monterrey")).toBe("MX");
    expect(hostFromCity("toronto")).toBe("CA");
    expect(hostFromCity("vancouver")).toBe("CA");
    expect(hostFromCity("dallas")).toBe("US");
    expect(hostFromCity("new_york")).toBe("US");
  });
  it("defaults unknown cities to US", () => {
    expect(hostFromCity("atlantis")).toBe("US");
  });
});

describe("seededRand", () => {
  it("returns numbers in [0, 1)", () => {
    for (const seed of [0, 1, 100, 99999]) {
      const v = seededRand(seed);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("is deterministic for the same seed", () => {
    expect(seededRand(42)).toBe(seededRand(42));
    expect(seededRand(7)).not.toBe(seededRand(8));
  });
});

describe("MockLiveDataProvider.fetchUpcoming", () => {
  it("returns fixtures in kickoff-ascending order", async () => {
    const p = makeProvider();
    const got = await p.fetchUpcoming(10);
    expect(got).toHaveLength(3);
    // Mexico kicks off 19:00 UTC on the 11th — earliest.
    expect(got[0]!.matchId).toBe("1");
    // Match 7 (Canada vs BIH) kicks 19:00 on the 12th, before match 2 (22:00).
    expect(got[1]!.matchId).toBe("7");
    expect(got[2]!.matchId).toBe("2");
  });

  it("respects limit", async () => {
    const p = makeProvider();
    const got = await p.fetchUpcoming(2);
    expect(got).toHaveLength(2);
  });

  it("returns empty array for non-positive limits", async () => {
    const p = makeProvider();
    expect(await p.fetchUpcoming(0)).toEqual([]);
    expect(await p.fetchUpcoming(-1)).toEqual([]);
  });

  it("includes currentMinute on in-progress matches", async () => {
    const p = makeProvider();
    p.tick("1"); // kickoff
    p.tick("1"); // live, minute 1
    const got = await p.fetchUpcoming(10);
    const m1 = got.find((f) => f.matchId === "1");
    expect(m1?.status).toBe("live");
    expect(m1?.currentMinute).toBe(1);
  });

  it("filters out fixtures more than 3 hours past kickoff (so already-finished matches drop out)", async () => {
    // Set "now" to 4 hours after match 1 kickoff.
    const p = new MockLiveDataProvider({
      fixtures: FIXTURES,
      nowMs: () => Date.parse("2026-06-11T23:30:00Z"),
    });
    const got = await p.fetchUpcoming(10);
    const ids = got.map((f) => f.matchId);
    expect(ids).not.toContain("1");
  });
});

describe("MockLiveDataProvider state machine", () => {
  it("advances scheduled → live on first tick", () => {
    const p = makeProvider();
    const s0 = p.tick("1");
    expect(s0.status).toBe("live");
    expect(s0.currentMinute).toBe(0);
    expect(s0.latestEvents.some((e) => e.type === "kickoff")).toBe(true);
    expect(s0.version).toBe(1);
  });

  it("advances live → ht when crossing minute 45", () => {
    const p = makeProvider({ minutesPerTick: 50 });
    p.tick("1"); // → live, minute 0
    const s = p.tick("1"); // skips well past 45
    expect(s.status).toBe("ht");
    expect(s.currentMinute).toBe(45);
    expect(s.latestEvents.some((e) => e.type === "half_time")).toBe(true);
  });

  it("advances ht → live on resume", () => {
    const p = makeProvider({ minutesPerTick: 50 });
    p.tick("1"); // live
    p.tick("1"); // ht
    const s = p.tick("1"); // back to live
    expect(s.status).toBe("live");
    expect(s.latestEvents.some((e) => e.type === "second_half_start")).toBe(true);
  });

  it("advances live → final after minute 90", () => {
    const p = makeProvider({ minutesPerTick: 100 });
    p.tick("1"); // live
    p.tick("1"); // ht (minute 45)
    p.tick("1"); // back to live
    const s = p.tick("1"); // → final
    expect(s.status).toBe("final");
    expect(s.currentMinute).toBe(90);
    expect(s.latestEvents.some((e) => e.type === "full_time")).toBe(true);
  });

  it("never advances past final on subsequent ticks", () => {
    const p = makeProvider({ minutesPerTick: 200 });
    p.tick("1");
    p.tick("1");
    p.tick("1");
    const s1 = p.tick("1");
    const s2 = p.tick("1");
    expect(s1.status).toBe("final");
    expect(s2.status).toBe("final");
    // Score doesn't change after final.
    expect(s2.homeScore).toBe(s1.homeScore);
    expect(s2.awayScore).toBe(s1.awayScore);
  });

  it("is deterministic — same seeded run produces identical scoring", () => {
    const a = makeProvider({ minutesPerTick: 100 });
    const b = makeProvider({ minutesPerTick: 100 });
    let stateA: LiveMatchState | null = null;
    let stateB: LiveMatchState | null = null;
    while (!stateA || stateA.status !== "final") stateA = a.tick("1");
    while (!stateB || stateB.status !== "final") stateB = b.tick("1");
    expect(stateA.homeScore).toBe(stateB.homeScore);
    expect(stateA.awayScore).toBe(stateB.awayScore);
    expect(stateA.scorers).toEqual(stateB.scorers);
  });

  it("monotonically increments version", () => {
    const p = makeProvider();
    const versions: number[] = [];
    for (let i = 0; i < 5; i++) versions.push(p.tick("1").version);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
    }
  });

  it("rejects unknown match ids", async () => {
    const p = makeProvider();
    await expect(p.fetchMatch("9999")).rejects.toThrow(/unknown matchId/);
  });

  it("reset(matchId) cycles a single match back to scheduled", () => {
    const p = makeProvider({ minutesPerTick: 200 });
    p.tick("1");
    p.tick("1");
    p.tick("1");
    p.tick("1"); // final
    p.reset("1");
    const s = p.tick("1");
    expect(s.status).toBe("live");
    expect(s.currentMinute).toBe(0);
    expect(s.homeScore).toBe(0);
    expect(s.awayScore).toBe(0);
  });

  it("resetAll() clears state for every match", async () => {
    const p = makeProvider({ minutesPerTick: 200 });
    p.tick("1");
    p.tick("2");
    p.resetAll();
    const s1 = await p.fetchMatch("1");
    const s2 = await p.fetchMatch("2");
    expect(s1.status).toBe("scheduled");
    expect(s2.status).toBe("scheduled");
  });
});

describe("MockLiveDataProvider.subscribeMatch", () => {
  it("fires an immediate first tick with current state", async () => {
    const p = makeProvider();
    const updates: LiveMatchState[] = [];
    const stop = p.subscribeMatch("1", (s) => updates.push(s));
    // First tick is synchronous (deliver() called inside subscribeMatch).
    expect(updates).toHaveLength(1);
    expect(updates[0]!.matchId).toBe("1");
    stop();
  });

  it("delivers subsequent ticks via setInterval", async () => {
    vi.useFakeTimers();
    try {
      const p = makeProvider();
      const updates: LiveMatchState[] = [];
      const stop = p.subscribeMatch("1", (s) => updates.push(s));
      expect(updates).toHaveLength(1);
      // Advance one interval (50ms in this provider).
      await vi.advanceTimersByTimeAsync(60);
      expect(updates.length).toBeGreaterThanOrEqual(2);
      // Versions are unique.
      const versions = new Set(updates.map((u) => u.version));
      expect(versions.size).toBe(updates.length);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops delivering after unsubscribe", async () => {
    vi.useFakeTimers();
    try {
      const p = makeProvider();
      const updates: LiveMatchState[] = [];
      const stop = p.subscribeMatch("1", (s) => updates.push(s));
      await vi.advanceTimersByTimeAsync(60);
      const beforeStop = updates.length;
      stop();
      await vi.advanceTimersByTimeAsync(500);
      expect(updates.length).toBe(beforeStop);
    } finally {
      vi.useRealTimers();
    }
  });
});
