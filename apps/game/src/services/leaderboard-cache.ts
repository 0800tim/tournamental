/**
 * In-memory LRU cache for the Bot Arena leaderboard reads.
 *
 * Separate from `apps/game/src/scoring/cache.ts` because that one is
 * tied to the LeaderboardRow shape and the (tournament, syndicate)
 * scoping; the Bot Arena reads are tabbed by humans|bots|all and need
 * prefix invalidation so a single kickoff event can wipe every tab's
 * cached snapshot in one call.
 *
 * Sized so the worst-case key cardinality (one tournament x three
 * scopes x per-pool tabs) stays well under maxEntries on the dev box.
 * When the production fan-out justifies it the Map is the line to swap
 * for a Redis backend , the public API stays the same.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §8.3
 */

interface CacheEntry<T> {
  value: T;
  expires_at: number;
}

export interface LeaderboardCacheOpts {
  /** Default time-to-live in ms. The Bot Arena default is 30s; the in-match acceleration is set per-call. */
  defaultTtlMs?: number;
  /** Soft max entries. When exceeded the oldest insertion is evicted. */
  maxEntries?: number;
}

/**
 * Generic in-memory cache used by the Bot Arena leaderboard tabs.
 *
 * Map iteration in V8 is insertion-ordered, so deleting the first key
 * on eviction is a cheap O(1) approximation of LRU. The Bot Arena
 * leaderboard fan-out fits in <100 keys so the difference between true
 * LRU and insertion-order LRU is irrelevant.
 */
export class LeaderboardCache {
  private readonly map = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(opts: LeaderboardCacheOpts = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? 30_000;
    this.maxEntries = opts.maxEntries ?? 512;
  }

  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlOverrideMs?: number,
  ): Promise<T> {
    const now = Date.now();
    const cached = this.map.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expires_at > now) {
      return cached.value;
    }
    const value = await fetcher();
    const ttl = ttlOverrideMs ?? this.defaultTtlMs;
    this.map.set(key, { value, expires_at: now + ttl });
    this.evictIfFull();
    return value;
  }

  /** Synchronously read a still-fresh cached value without invoking a fetcher. */
  peek<T>(key: string): T | null {
    const now = Date.now();
    const cached = this.map.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expires_at > now) return cached.value;
    return null;
  }

  invalidate(key: string): void {
    this.map.delete(key);
  }

  /**
   * Drop every key starting with the supplied prefix. Used by the
   * kickoff and match-completed events to invalidate every tab's
   * snapshot in one call.
   */
  invalidatePrefix(prefix: string): void {
    for (const k of [...this.map.keys()]) {
      if (k.startsWith(prefix)) this.map.delete(k);
    }
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  private evictIfFull(): void {
    while (this.map.size > this.maxEntries) {
      const firstKey = this.map.keys().next().value;
      if (firstKey === undefined) break;
      this.map.delete(firstKey);
    }
  }
}
