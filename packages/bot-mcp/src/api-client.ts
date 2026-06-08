/**
 * Thin HTTP client for the Tournamental Bot Arena public API.
 *
 * The full-featured `@tournamental/bot-sdk` ships `Bot`, `Swarm`, and
 * `getOdds` (see spec §6.2). This MCP package needs only the request-response
 * surface, so we wrap fetch directly and stay schema-compatible with the SDK
 * types (re-exported from `@tournamental/bot-sdk` so a future swap is
 * mechanical).
 *
 * Every method:
 *  - sends `Authorization: Bearer <key>` via `authHeaders` from the SDK.
 *  - throws `BotApiError` with status + parsed JSON body on non-2xx, so
 *    the MCP tool layer can surface a clean error message to the AI client.
 *  - returns the parsed JSON body on success, typed against the SDK's
 *    shared shapes.
 */

import { authHeaders } from "@tournamental/bot-sdk";
import type {
  BulkResponse,
  BulkSubmission,
  MatchSpec,
  OddsSnapshot,
  Pick,
} from "@tournamental/bot-sdk";

export interface ApiClientOptions {
  apiKey: string;
  baseUrl: string;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class BotApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "BotApiError";
    this.status = status;
    this.body = body;
  }
}

export interface LeaderboardEntry {
  rank: number;
  bot_id: string;
  display_name: string;
  points: number;
  correct_picks: number;
  still_perfect: boolean;
}

export interface LeaderboardResponse {
  scope: "humans" | "bots" | "pools";
  tournament_id: string;
  generated_at_utc: string;
  entries: LeaderboardEntry[];
  total_competitors: number;
}

export interface BotRecord {
  bot_id: string;
  display_name: string;
  created_at_utc: string;
  picks_submitted: number;
  current_rank?: number;
  current_points?: number;
}

export interface MyBotsResponse {
  bots: BotRecord[];
  quota: { bots_owned: number; bots_quota: number };
}

export interface MatchesResponse {
  tournament_id: string;
  matches: MatchSpec[];
}

export class TournamentalApiClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.headers = {
      ...authHeaders(opts.apiKey),
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "tournamental-bot-mcp/0.1.0",
    };
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Returns the 104-match catalogue for the given tournament (defaults to
   * the 2026 FIFA World Cup) with kickoff times.
   */
  async getMatches(tournamentId = "fifa-wc-2026"): Promise<MatchesResponse> {
    return this.request<MatchesResponse>(
      "GET",
      `/v1/tournaments/${encodeURIComponent(tournamentId)}/matches`,
    );
  }

  /** Current Polymarket-sourced odds for a single match. */
  async getOdds(matchId: string): Promise<OddsSnapshot> {
    return this.request<OddsSnapshot>(
      "GET",
      `/v1/matches/${encodeURIComponent(matchId)}/odds`,
    );
  }

  /** Submit a single pick for one of the caller's bots. */
  async submitPick(args: {
    botId: string;
    matchId: string;
    outcome: Pick["outcome"];
    tournamentId?: string;
  }): Promise<BulkResponse> {
    const submission: BulkSubmission = {
      tournament_id: args.tournamentId ?? "fifa-wc-2026",
      submissions: [
        {
          bot_id: args.botId,
          picks: [{ match_id: args.matchId, outcome: args.outcome }],
        },
      ],
    };
    return this.request<BulkResponse>("POST", "/v1/picks/bulk", submission);
  }

  /** Submit a bulk batch (up to 10,000 picks per request per spec §7.2). */
  async submitBulk(submission: BulkSubmission): Promise<BulkResponse> {
    return this.request<BulkResponse>("POST", "/v1/picks/bulk", submission);
  }

  /** Leaderboard read for one of the three scopes. */
  async getLeaderboard(args: {
    scope: "humans" | "bots" | "pools";
    tournamentId?: string;
    limit?: number;
  }): Promise<LeaderboardResponse> {
    const params = new URLSearchParams({
      scope: args.scope,
      tournament_id: args.tournamentId ?? "fifa-wc-2026",
      limit: String(args.limit ?? 100),
    });
    return this.request<LeaderboardResponse>(
      "GET",
      `/v1/leaderboard?${params.toString()}`,
    );
  }

  /** Bots owned by the configured API key, including their quota. */
  async getMyBots(): Promise<MyBotsResponse> {
    return this.request<MyBotsResponse>("GET", "/v1/bots/me");
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const msg =
        (parsed &&
          typeof parsed === "object" &&
          "error" in parsed &&
          typeof (parsed as { error: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : `Tournamental API ${method} ${path} failed with HTTP ${res.status}`);
      throw new BotApiError(msg, res.status, parsed);
    }
    return parsed as T;
  }
}
