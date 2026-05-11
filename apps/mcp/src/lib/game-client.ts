/**
 * Thin client for the upstream game-service (apps/game, default :3360).
 *
 * Keeps the MCP server's tool handlers tiny: a tool maps inputs → one
 * `gameClient.x()` call → the validated zod shape. All HTTP details
 * (base URL, timeouts, error normalisation) live here so the tools
 * stay declarative.
 *
 * The client also accepts an `Authorization: Bearer <user-key>` header
 * to pass through to user-scoped endpoints, and an admin Bearer for
 * `/v1/admin/*` routes.
 */

export interface GameClientOptions {
  /** Base URL of the game-service. Default `http://127.0.0.1:3360`. */
  readonly baseUrl?: string;
  /** Per-request timeout in ms. Default 8000. */
  readonly timeoutMs?: number;
  /** Override the global fetch (tests pass a stub). */
  readonly fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  readonly userKey?: string;
  readonly adminKey?: string;
  readonly query?: Record<string, string | number | undefined>;
  readonly body?: unknown;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class GameClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GameClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.GAME_BASE_URL ?? 'http://127.0.0.1:3360').replace(
      /\/+$/,
      '',
    );
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.userKey) headers['authorization'] = `Bearer ${opts.userKey}`;
    if (opts.adminKey) headers['authorization'] = `Bearer ${opts.adminKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new UpstreamError(
        `upstream_unreachable: ${(err as Error).message}`,
        0,
        null,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      throw new UpstreamError(
        `upstream_error_${res.status}`,
        res.status,
        parsed,
      );
    }
    return parsed as T;
  }

  // ---------- Reads ----------

  async getTeam(teamCode: string): Promise<unknown> {
    return this.request('GET', `/v1/team/${encodeURIComponent(teamCode)}`);
  }

  async getTournament(tournamentId: string): Promise<unknown> {
    return this.request('GET', `/v1/tournament/${encodeURIComponent(tournamentId)}`);
  }

  async getLeaderboard(
    tournamentId: string,
    scope: 'global' | 'syndicate' | 'friends',
    syndicateSlug: string | undefined,
    limit: number,
    offset: number,
    userKey?: string,
  ): Promise<unknown> {
    if (scope === 'syndicate' && syndicateSlug) {
      return this.request(
        'GET',
        `/v1/leaderboard/${encodeURIComponent(tournamentId)}/syndicate/${encodeURIComponent(
          syndicateSlug,
        )}`,
        { query: { limit, offset }, userKey },
      );
    }
    if (scope === 'friends') {
      return this.request(
        'GET',
        `/v1/leaderboard/${encodeURIComponent(tournamentId)}/friends`,
        { query: { limit, offset }, userKey },
      );
    }
    return this.request('GET', `/v1/leaderboard/${encodeURIComponent(tournamentId)}`, {
      query: { limit, offset },
    });
  }

  async getBracketByGuid(guid: string, includePayload: boolean): Promise<unknown> {
    return this.request('GET', `/v1/bracket/by-guid/${encodeURIComponent(guid)}`, {
      query: includePayload ? { include: 'payload' } : undefined,
    });
  }

  async getSyndicate(slug: string): Promise<unknown> {
    return this.request('GET', `/v1/syndicate/${encodeURIComponent(slug)}`);
  }

  async getMatchPath(teamCode: string, tournamentId: string): Promise<unknown> {
    return this.request(
      'GET',
      `/v1/tournament/${encodeURIComponent(tournamentId)}/team/${encodeURIComponent(
        teamCode,
      )}/path`,
    );
  }

  async queryMolecule(bracketGuid: string): Promise<unknown> {
    return this.request('GET', `/v1/molecule/${encodeURIComponent(bracketGuid)}`);
  }

  // ---------- User-scoped writes ----------

  async submitBracket(bracket: unknown, userKey: string): Promise<unknown> {
    return this.request('POST', '/v1/bracket/submit', { body: bracket, userKey });
  }

  async updatePick(
    matchId: string,
    outcome: string,
    scoreHome: number | undefined,
    scoreAway: number | undefined,
    userKey: string,
  ): Promise<unknown> {
    return this.request('POST', '/v1/picks/upsert', {
      body: { match_id: matchId, outcome, score_home: scoreHome, score_away: scoreAway },
      userKey,
    });
  }

  async lockPicks(untilMatchId: string | undefined, userKey: string): Promise<unknown> {
    return this.request('POST', '/v1/picks/lock', {
      body: { until_match_id: untilMatchId ?? null },
      userKey,
    });
  }

  async saveShareGuid(shareGuid: string, userKey: string): Promise<unknown> {
    return this.request('POST', '/v1/bracket/share', {
      body: { share_guid: shareGuid },
      userKey,
    });
  }

  async setHandle(handle: string, userKey: string): Promise<unknown> {
    return this.request('POST', '/v1/me/handle', { body: { handle }, userKey });
  }

  async whoAmI(userKey: string): Promise<unknown> {
    return this.request('GET', '/v1/me', { userKey });
  }

  // ---------- Admin ----------

  async adminResolveMatch(
    matchId: string,
    outcome: string,
    scoreHome: number,
    scoreAway: number,
    adminKey: string,
  ): Promise<unknown> {
    return this.request('POST', `/v1/admin/match/${encodeURIComponent(matchId)}/resolve`, {
      body: { outcome, score_home: scoreHome, score_away: scoreAway },
      adminKey,
    });
  }

  async adminListPendingUsers(limit: number, adminKey: string): Promise<unknown> {
    return this.request('GET', '/v1/admin/users/pending', {
      query: { limit },
      adminKey,
    });
  }

  async adminInvalidateShare(
    guid: string,
    reason: string | undefined,
    adminKey: string,
  ): Promise<unknown> {
    return this.request('POST', `/v1/admin/share/${encodeURIComponent(guid)}/revoke`, {
      body: { reason: reason ?? null },
      adminKey,
    });
  }
}
