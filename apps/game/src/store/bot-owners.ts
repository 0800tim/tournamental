/**
 * Bot ownership DAO. Ties an externally-issued bot (a row in `users`
 * with is_bot=1) to the API key that minted it.
 *
 * Used by:
 *   - The /v1/picks/bulk endpoint, which rejects pick submissions for
 *     a bot the caller's API key does not own.
 *   - The bot-keys page, which displays the number of bots provisioned
 *     against each key vs the per-key quota.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.4, §7.2
 */
import type { Database as DatabaseT } from "better-sqlite3";

export interface ClaimParams {
  bot_id: string;
  api_key_hash: string;
  owner_email: string;
  /** Override the clock (tests). */
  now?: number;
}

export class BotOwnerStore {
  constructor(private readonly db: DatabaseT) {}

  /**
   * Record that this bot belongs to this API key. Idempotent on
   * bot_id , re-running the seed CLI or the same bulk-insert payload
   * does not duplicate rows.
   */
  claim(p: ClaimParams): void {
    this.db
      .prepare(
        `INSERT INTO bot_owner
           (bot_id, owner_email, owner_api_key_hash, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(bot_id) DO NOTHING`,
      )
      .run(p.bot_id, p.owner_email, p.api_key_hash, p.now ?? Date.now());
  }

  countByApiKey(api_key_hash: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM bot_owner WHERE owner_api_key_hash = ?`,
      )
      .get(api_key_hash) as { n: number };
    return row.n;
  }

  ownedBotIds(api_key_hash: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT bot_id FROM bot_owner
             WHERE owner_api_key_hash = ?
             ORDER BY created_at ASC, bot_id ASC`,
        )
        .all(api_key_hash) as Array<{ bot_id: string }>
    ).map((r) => r.bot_id);
  }

  isOwner(api_key_hash: string, bot_id: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM bot_owner
           WHERE owner_api_key_hash = ? AND bot_id = ?`,
      )
      .get(api_key_hash, bot_id);
    return row !== undefined;
  }

  /**
   * Bulk ownership check used by /v1/picks/bulk: returns the subset of
   * `bot_ids` that the key does NOT own. Cheap enough for 1k bots per
   * request (the spec ceiling) and avoids N round-trips through the
   * single-row isOwner path.
   */
  notOwnedBy(api_key_hash: string, bot_ids: readonly string[]): string[] {
    if (bot_ids.length === 0) return [];
    const placeholders = bot_ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT bot_id FROM bot_owner
           WHERE owner_api_key_hash = ? AND bot_id IN (${placeholders})`,
      )
      .all(api_key_hash, ...bot_ids) as Array<{ bot_id: string }>;
    const owned = new Set(rows.map((r) => r.bot_id));
    return bot_ids.filter((id) => !owned.has(id));
  }
}
