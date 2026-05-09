import { describe, expect, it } from "vitest";

import {
  LeaderboardCache,
  globalKey,
  syndicateKey,
} from "../src/scoring/cache.js";

describe("LeaderboardCache", () => {
  it("get returns null on a cache miss", () => {
    const cache = new LeaderboardCache(1000);
    expect(cache.get("nope")).toBeNull();
  });

  it("set/get round-trips inside the TTL", () => {
    const cache = new LeaderboardCache(1000);
    const rows = [
      { rank: 1, user_id: "u_a", score_total: 99, bracket_id: "bk_a" },
    ];
    cache.set("k", rows, 1000);
    expect(cache.get("k", 1500)).toEqual(rows);
  });

  it("returns null after the TTL elapses", () => {
    const cache = new LeaderboardCache(1000);
    cache.set("k", [], 1000);
    expect(cache.get("k", 2001)).toBeNull();
  });

  it("invalidateAll clears every entry", () => {
    const cache = new LeaderboardCache(1000);
    cache.set("a", [], 1000);
    cache.set("b", [], 1000);
    expect(cache.size()).toBe(2);
    cache.invalidateAll();
    expect(cache.size()).toBe(0);
  });

  it("invalidateTournament only drops matching keys", () => {
    const cache = new LeaderboardCache(1000);
    cache.set(globalKey("t1", 100), [], 1000);
    cache.set(globalKey("t2", 100), [], 1000);
    cache.set(syndicateKey("t1", "syn-a", 100), [], 1000);
    expect(cache.size()).toBe(3);
    cache.invalidateTournament("t1");
    expect(cache.size()).toBe(1);
    expect(cache.get(globalKey("t2", 100), 1500)).not.toBeNull();
  });

  it("global and syndicate keys are namespaced", () => {
    expect(globalKey("t", 100)).not.toBe(syndicateKey("t", "g", 100));
  });
});
