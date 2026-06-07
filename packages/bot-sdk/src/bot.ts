/**
 * The `Bot` class: queue picks, then flush as one bulk request.
 *
 * Designed for the common case where a developer writes one bot and submits
 * its full bracket. Picks are upsert-style: calling `pick(matchId, ...)` a
 * second time for the same match replaces the earlier outcome (matches the
 * server's `ON CONFLICT DO UPDATE` semantics; spec §7.3).
 */

import { submitBulk } from "./bulk.js";
import type { ClientOpts } from "./client.js";
import type { BulkResponse, Outcome, Pick } from "./types.js";

export interface BotOpts extends ClientOpts {
  botId: string;
  tournamentId?: string;
}

export class Bot {
  private readonly queue: Pick[] = [];
  private readonly opts: BotOpts;

  constructor(opts: BotOpts) {
    if (!opts.botId) {
      throw new Error("bot-sdk: botId is required on Bot");
    }
    this.opts = opts;
  }

  /** Identifier this bot submits under. */
  get botId(): string {
    return this.opts.botId;
  }

  /** Tournament this bot is competing in (default: fifa-wc-2026). */
  get tournamentId(): string {
    return this.opts.tournamentId ?? "fifa-wc-2026";
  }

  /** Number of picks currently queued for submission. */
  get queueSize(): number {
    return this.queue.length;
  }

  /** Snapshot of the queued picks. Callers must not mutate the result. */
  picks(): readonly Pick[] {
    return this.queue;
  }

  /**
   * Queue a pick. Idempotent: re-picking the same match replaces the
   * outcome rather than appending a duplicate row.
   */
  pick(matchId: string, outcome: Outcome): void {
    if (!matchId) throw new Error("bot-sdk: matchId is required");
    if (outcome !== "home_win" && outcome !== "draw" && outcome !== "away_win") {
      throw new Error(`bot-sdk: invalid outcome ${String(outcome)}`);
    }
    const idx = this.queue.findIndex((p) => p.match_id === matchId);
    const next: Pick = { match_id: matchId, outcome };
    if (idx >= 0) this.queue[idx] = next;
    else this.queue.push(next);
  }

  /** Drop all queued picks without sending. */
  clear(): void {
    this.queue.length = 0;
  }

  /**
   * POST queued picks as a single bulk submission. Returns the server's
   * response. The queue is cleared only on a successful response; on error
   * the queue is preserved so the caller can retry.
   */
  async flush(): Promise<BulkResponse> {
    if (this.queue.length === 0) {
      return {
        accepted: 0,
        dropped_picks: [],
        quota_remaining: { picks_per_hour: 0, bots_owned: 0 },
      };
    }
    const res = await submitBulk(this.opts, {
      tournament_id: this.tournamentId,
      submissions: [{ bot_id: this.opts.botId, picks: this.queue.slice() }],
    });
    this.queue.length = 0;
    return res;
  }
}
