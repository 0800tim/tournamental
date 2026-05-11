/**
 * Settlement bridge — turn `final` transitions into `apps/game` POSTs.
 *
 * The game service exposes `POST /v1/match/:match_id/result` (see
 * `apps/game/src/routes/match.ts`). When a match in our live-data stream
 * transitions to `final`, we POST the home/away score and inferred winner
 * to the game service so it persists the outcome and re-scores brackets.
 *
 * The bridge guarantees:
 *   - Each (matchId, version) is only delivered once. If the underlying
 *     stream re-emits a final snapshot (e.g. SportRadar's "ended" status
 *     repeats), we don't double-post.
 *   - A network error during settlement marks the match as un-settled so
 *     a subsequent identical snapshot retries.
 *   - We never settle a match without explicit `final` status.
 *
 * Auth: `x-game-internal-secret` header. The game's admin guard accepts
 * this header (treat absence as test-only). If `gameInternalSecret` is
 * not set, the bridge logs a warning and skips the POST — useful for dev.
 */

import { request } from "undici";

import type { LiveMatchState } from "./live/types.js";

export interface SettlementBridgeOptions {
  /** Base URL of the game service. e.g. https://api.tournamental.com/game */
  readonly gameBaseUrl: string;
  /** Shared secret expected by the game service's admin guard. */
  readonly gameInternalSecret: string | undefined;
  /** Tournament identifier — game service requires this on the body. */
  readonly tournamentId: string;
  /**
   * Override fetcher (tests). Receives method, url, headers, body. Returns
   * response status + body.
   */
  readonly fetcher?: (
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string,
  ) => Promise<{ status: number; body: unknown }>;
  /** Optional logger; defaults to console. */
  readonly logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

interface SettlementRecord {
  /** Highest version we've successfully posted for this match. */
  readonly settledVersion: number;
}

async function defaultFetcher(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request(url, {
    method: method as "POST" | "GET" | "PUT" | "DELETE" | "PATCH",
    headers,
    body,
    headersTimeout: 10_000,
    bodyTimeout: 15_000,
  });
  let parsed: unknown = null;
  try {
    parsed = await res.body.json();
  } catch {
    parsed = null;
  }
  return { status: res.statusCode, body: parsed };
}

const NOOP_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Stateful bridge — keeps a per-match record of what's been settled.
 * Construct once, call `onMatchUpdate(state)` for every snapshot the
 * provider emits.
 */
export class SettlementBridge {
  private readonly options: Required<Omit<SettlementBridgeOptions, "fetcher" | "logger">> & {
    fetcher: NonNullable<SettlementBridgeOptions["fetcher"]>;
    logger: NonNullable<SettlementBridgeOptions["logger"]>;
  };
  private readonly settled = new Map<string, SettlementRecord>();
  private readonly inFlight = new Set<string>();

  constructor(opts: SettlementBridgeOptions) {
    this.options = {
      gameBaseUrl: opts.gameBaseUrl.replace(/\/+$/, ""),
      gameInternalSecret: opts.gameInternalSecret ?? "",
      tournamentId: opts.tournamentId,
      fetcher: opts.fetcher ?? defaultFetcher,
      logger: opts.logger ?? (typeof console !== "undefined" ? console : NOOP_LOGGER),
    };
  }

  /**
   * Hook every live update through this method. No-ops unless `state.status`
   * is `"final"` and we haven't yet settled this `(matchId, version)`.
   */
  async onMatchUpdate(state: LiveMatchState): Promise<{ posted: boolean; status?: number }> {
    if (state.status !== "final") return { posted: false };

    const prior = this.settled.get(state.matchId);
    if (prior && prior.settledVersion >= state.version) {
      return { posted: false };
    }
    if (this.inFlight.has(state.matchId)) {
      return { posted: false };
    }

    if (!this.options.gameInternalSecret) {
      this.options.logger.warn(
        `[settlement-bridge] match ${state.matchId} reached FINAL but no ` +
          `WC2026_GAME_INTERNAL_SECRET set; skipping POST (dev mode).`,
      );
      // Mark as settled-locally so we don't re-warn every tick.
      this.settled.set(state.matchId, { settledVersion: state.version });
      return { posted: false };
    }

    this.inFlight.add(state.matchId);
    try {
      const url = `${this.options.gameBaseUrl}/v1/match/${encodeURIComponent(state.matchId)}/result`;
      const winner =
        state.homeScore === state.awayScore
          ? "draw"
          : state.homeScore > state.awayScore
            ? "home"
            : "away";
      const payload = {
        tournament_id: this.options.tournamentId,
        outcome: winner === "draw" ? "draw" : "decisive",
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        winner,
        stage: "live", // game service tolerates; refined later
        impliedAtLock: null,
        secondsSinceLock: null,
        windowSeconds: null,
        source: "wc2026-data:live",
        recordedAtUtc: state.updatedAtUtc,
      };
      const { status, body } = await this.options.fetcher(
        "POST",
        url,
        {
          "Content-Type": "application/json",
          "x-game-internal-secret": this.options.gameInternalSecret,
        },
        JSON.stringify(payload),
      );

      if (status >= 200 && status < 300) {
        this.settled.set(state.matchId, { settledVersion: state.version });
        this.options.logger.info(
          `[settlement-bridge] settled match ${state.matchId} score=${state.homeScore}-${state.awayScore} winner=${winner}`,
        );
        return { posted: true, status };
      } else {
        this.options.logger.error(
          `[settlement-bridge] match ${state.matchId} game POST failed status=${status} body=${JSON.stringify(body)}`,
        );
        return { posted: false, status };
      }
    } catch (err) {
      this.options.logger.error(
        `[settlement-bridge] match ${state.matchId} POST threw: ${(err as Error).message}`,
      );
      return { posted: false };
    } finally {
      this.inFlight.delete(state.matchId);
    }
  }

  /** Test/admin: forget all settlement records. */
  reset(): void {
    this.settled.clear();
    this.inFlight.clear();
  }
}
