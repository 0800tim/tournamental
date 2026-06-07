/**
 * LeaderboardCache (in-memory LRU + TTL + prefix invalidation).
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §8.3
 */
import { describe, it, expect, vi } from "vitest";

import { LeaderboardCache } from "../src/services/leaderboard-cache.js";

describe("LeaderboardCache", () => {
  it("returns cached value within TTL (single fetcher call)", async () => {
    const fetcher = vi.fn(async () => ({ rows: ["a"] }));
    const cache = new LeaderboardCache({ defaultTtlMs: 1_000 });
    await cache.get("k1", fetcher);
    await cache.get("k1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expiry", async () => {
    const fetcher = vi.fn(async () => ({ rows: ["a"] }));
    const cache = new LeaderboardCache({ defaultTtlMs: 5 });
    await cache.get("k1", fetcher);
    await new Promise((r) => setTimeout(r, 15));
    await cache.get("k1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a refetch for that key", async () => {
    const fetcher = vi.fn(async () => ({ rows: ["a"] }));
    const cache = new LeaderboardCache({ defaultTtlMs: 60_000 });
    await cache.get("k1", fetcher);
    cache.invalidate("k1");
    await cache.get("k1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidatePrefix() drops every matching key", async () => {
    const fetcher = vi.fn(async () => ({ rows: ["a"] }));
    const cache = new LeaderboardCache({ defaultTtlMs: 60_000 });
    await cache.get("lb:fifa-wc-2026:humans", fetcher);
    await cache.get("lb:fifa-wc-2026:bots", fetcher);
    await cache.get("other:key", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
    cache.invalidatePrefix("lb:");
    await cache.get("lb:fifa-wc-2026:humans", fetcher);
    await cache.get("lb:fifa-wc-2026:bots", fetcher);
    await cache.get("other:key", fetcher);
    // humans + bots refetched, other:key still warm.
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("evicts the oldest entry when maxEntries is reached", async () => {
    const fetcher = vi.fn(async (key: string) => ({ rows: [key] }));
    const cache = new LeaderboardCache({
      defaultTtlMs: 60_000,
      maxEntries: 2,
    });
    await cache.get("k1", () => fetcher("k1"));
    await cache.get("k2", () => fetcher("k2"));
    await cache.get("k3", () => fetcher("k3")); // evicts k1
    expect(cache.size()).toBe(2);
    await cache.get("k1", () => fetcher("k1")); // miss, refetches
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("accepts a per-call ttlOverrideMs", async () => {
    const fetcher = vi.fn(async () => ({ rows: ["a"] }));
    const cache = new LeaderboardCache({ defaultTtlMs: 60_000 });
    await cache.get("k1", fetcher, 5);
    await new Promise((r) => setTimeout(r, 20));
    await cache.get("k1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
