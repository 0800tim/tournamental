/**
 * The `Bot` class: queue picks, then flush as one bulk request.
 *
 * Designed for the common case where a developer writes one bot and submits
 * its full bracket. Picks are upsert-style: calling `pick(matchId, ...)` a
 * second time for the same match replaces the earlier outcome (matches the
 * server's `ON CONFLICT DO UPDATE` semantics; spec §7.3).
 *
 * Lifecycle:
 *
 *   const bot = new Bot({ apiKey, botId });
 *   await bot.connect();                 // authenticate + warm catalogue
 *   for (const m of bot.matches()) {     // iterate open matches
 *     await bot.pick(m.id, "home_win");
 *   }
 *   await bot.flush();                   // POST as one bulk request
 *
 * `connect()` is cheap and idempotent. `matches()` iterates the cached
 * catalogue and filters out anything past kickoff , so once a match
 * locks it disappears from the iterator on the next loop iteration.
 */

import { submitBulk } from "./bulk.js";
import { DEFAULT_BASE_URL, type ClientOpts } from "./client.js";
import { authHeaders } from "./auth.js";
import type { BulkResponse, MatchSpec, Outcome, Pick } from "./types.js";

export interface BotOpts extends ClientOpts {
  botId: string;
  tournamentId?: string;
}

/** Result of `Bot.connect()`. Exposes catalogue size for log lines. */
export interface ConnectResult {
  readonly botId: string;
  readonly tournamentId: string;
  readonly matches: number;
  /** True if the server validated the API key. False on cache-only paths. */
  readonly authenticated: boolean;
}

export class Bot {
  private readonly queue: Pick[] = [];
  private readonly opts: BotOpts;
  private catalogue: readonly MatchSpec[] | null = null;
  private connectedAt: number | null = null;

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

  /** True once `connect()` has been called at least once. */
  get connected(): boolean {
    return this.connectedAt !== null;
  }

  /**
   * Authenticate the API key, register `botId` with the server, and
   * cache the match catalogue. Cheap and idempotent: safe to call once
   * at startup and again on a reconnect.
   *
   * The whoami probe is best-effort: a 401 surfaces as a thrown error so
   * a misconfigured key fails fast, but a 404 / 5xx degrades to a
   * cache-only connect so the SDK still works in offline / mocked
   * environments. The catalogue probe is similarly best-effort, with an
   * empty catalogue on any non-2xx so `bot.matches()` still iterates
   * (zero times) rather than throwing.
   */
  async connect(): Promise<ConnectResult> {
    const fetcher =
      this.opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (!fetcher) {
      throw new Error(
        "bot-sdk: no fetch implementation available. Pass `fetchImpl` or run on Node >= 20.",
      );
    }
    const baseUrl = (this.opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...authHeaders(this.opts.apiKey),
    };

    let authenticated = false;
    try {
      const whoami = await fetcher(`${baseUrl}/v1/me/api-keys/whoami`, {
        method: "GET",
        headers,
      });
      if (whoami.status === 401 || whoami.status === 403) {
        throw new Error(
          `bot-sdk: connect() failed authentication (HTTP ${whoami.status})`,
        );
      }
      authenticated = whoami.ok;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("bot-sdk: connect()")) {
        throw err;
      }
      // Network or missing-route: degrade to cache-only.
      authenticated = false;
    }

    // Fetch and cache the match catalogue. The endpoint is
    // /v1/tournaments/<id>/matches per the existing MCP client; a
    // missing route degrades to an empty catalogue.
    let catalogue: MatchSpec[] = [];
    try {
      const cat = await fetcher(
        `${baseUrl}/v1/tournaments/${encodeURIComponent(this.tournamentId)}/matches`,
        { method: "GET", headers },
      );
      if (cat.ok) {
        const body = (await cat.json()) as { matches?: MatchSpec[] };
        if (Array.isArray(body?.matches)) {
          catalogue = body.matches;
        }
      }
    } catch {
      // Cache stays empty; not fatal.
    }
    this.catalogue = catalogue;
    this.connectedAt = Date.now();

    return {
      botId: this.botId,
      tournamentId: this.tournamentId,
      matches: catalogue.length,
      authenticated,
    };
  }

  /**
   * Synchronous iterator over the cached match catalogue, filtered to
   * matches still open for picks (i.e. their `kickoff_utc` is strictly
   * in the future relative to the caller's `now`).
   *
   * Iterating before `connect()` yields zero matches rather than
   * throwing, so a swarm worker that forgets the await gets visible
   * empty behaviour rather than a runtime crash.
   *
   * The `now` argument is optional and defaults to wall-clock. Tests
   * pass a fixed instant to make the iteration deterministic.
   */
  *matches(nowMs: number = Date.now()): Generator<MatchSpec> {
    if (!this.catalogue) return;
    for (const m of this.catalogue) {
      if (typeof m.kickoff_utc !== "string" || m.kickoff_utc.length === 0) {
        // No kickoff known , treat as open.
        yield m;
        continue;
      }
      const kickoff = Date.parse(m.kickoff_utc);
      if (Number.isFinite(kickoff) && kickoff <= nowMs) continue;
      yield m;
    }
  }

  /**
   * Manually seed the cached catalogue. Useful for tests and for
   * advanced flows where the operator loads the matches from a static
   * fixture (e.g. a federated node holding its own catalogue snapshot).
   */
  setCatalogue(matches: readonly MatchSpec[]): void {
    this.catalogue = matches.slice();
    if (this.connectedAt === null) this.connectedAt = Date.now();
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
