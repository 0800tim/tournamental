/**
 * In-process leaderboard cache.
 *
 * docs/12 specifies a Redis ZSET + snapshotter for the production stack.
 * Until that lands, an in-process LRU-ish cache with a 30s TTL is good
 * enough — leaderboard queries are O(log N + M) on the SQLite index and
 * the 30s window absorbs the read-spike from the bot fanning out a
 * "leaderboard updated" event.
 *
 * Keys are stable: `<tournament_id>::global::<n>` and
 * `<tournament_id>::syndicate::<syndicate_id>::<n>`.
 */

import type { LeaderboardRow } from "../types.js";

interface Entry {
  rows: readonly LeaderboardRow[];
  expires_at: number;
}

export class LeaderboardCache {
  private readonly map = new Map<string, Entry>();
  constructor(private readonly ttl_ms: number) {}

  get(key: string, now = Date.now()): readonly LeaderboardRow[] | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expires_at <= now) {
      this.map.delete(key);
      return null;
    }
    return entry.rows;
  }

  set(key: string, rows: readonly LeaderboardRow[], now = Date.now()): void {
    this.map.set(key, { rows, expires_at: now + this.ttl_ms });
  }

  /** Drop every cached leaderboard. Called on every match-result POST. */
  invalidateAll(): void {
    this.map.clear();
  }

  /** Drop only entries scoped to this tournament. */
  invalidateTournament(tournament_id: string): void {
    const prefix = `${tournament_id}::`;
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(prefix)) this.map.delete(key);
    }
  }

  size(): number {
    return this.map.size;
  }
}

export function globalKey(tournament_id: string, n: number): string {
  return `${tournament_id}::global::${n}`;
}

export function syndicateKey(
  tournament_id: string,
  syndicate_id: string,
  n: number,
): string {
  return `${tournament_id}::syndicate::${syndicate_id}::${n}`;
}
