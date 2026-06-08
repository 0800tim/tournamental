/**
 * Sliding-hour per-API-key pick quota.
 *
 * Each window is bucketed to floor(now_ms / 3600000) * 3600000. A row
 * in `quota_window` tracks the picks consumed during that hour. The
 * primary key (api_key_hash, window_start) keeps the ledger compact ,
 * old rows can be GC'd by a daily cron without a complex query.
 *
 * Hard cap defaults live on the api_key row (quota_picks_per_hour) and
 * are passed in by the caller, so this DAO does not need to know the
 * academic-vs-default policy.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.4, §8.1
 */
import type { Database as DatabaseT } from "better-sqlite3";

const HOUR_MS = 3_600_000;

export class QuotaStore {
  constructor(private readonly db: DatabaseT) {}

  private windowStart(now: number): number {
    return Math.floor(now / HOUR_MS) * HOUR_MS;
  }

  consume(api_key_hash: string, n: number): void {
    this.consumeAt(api_key_hash, n, Date.now());
  }

  consumeAt(api_key_hash: string, n: number, now: number): void {
    if (n <= 0) return;
    const window_start = this.windowStart(now);
    this.db
      .prepare(
        `INSERT INTO quota_window
           (api_key_hash, window_start, picks_used)
         VALUES (?, ?, ?)
         ON CONFLICT(api_key_hash, window_start) DO UPDATE
           SET picks_used = picks_used + excluded.picks_used`,
      )
      .run(api_key_hash, window_start, n);
  }

  usedThisHour(api_key_hash: string): number {
    return this.usedThisHourAt(api_key_hash, Date.now());
  }

  usedThisHourAt(api_key_hash: string, now: number): number {
    const window_start = this.windowStart(now);
    const row = this.db
      .prepare(
        `SELECT picks_used FROM quota_window
           WHERE api_key_hash = ? AND window_start = ?`,
      )
      .get(api_key_hash, window_start) as { picks_used: number } | undefined;
    return row?.picks_used ?? 0;
  }

  /**
   * Attempt to charge `n` picks against the key. Returns true on
   * success (consumed). Returns false and does not consume when the
   * request would push the key over `hourly_cap` , the caller should
   * respond 429 quota_exceeded.
   */
  tryConsume(
    api_key_hash: string,
    n: number,
    hourly_cap: number,
    now: number = Date.now(),
  ): boolean {
    if (n > hourly_cap) return false;
    const used = this.usedThisHourAt(api_key_hash, now);
    if (used + n > hourly_cap) return false;
    this.consumeAt(api_key_hash, n, now);
    return true;
  }
}
