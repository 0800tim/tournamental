/**
 * Game-service HTTP client for the bracket UI.
 *
 * One thin wrapper over the three endpoints the bracket builder cares
 * about. Each function is fetch-only (no SWR, no react-query) so it can
 * be called from event handlers (Save button, popup confirm) without
 * dragging hook machinery into the click path.
 *
 *   savePerMatchPick   → PUT  /v1/picks/:userId/:matchId
 *   saveFullBracket    → POST /v1/bracket/submit
 *   loadServerBracket  → GET  /v1/bracket/me?tournament_id=...
 *
 * Auth: every request carries `X-User-Id: <userId>` (the same dev-trust
 * model used by the game service today, per
 * apps/game/src/routes/picks.ts:53). Production will swap this for a
 * Telegram-session JWT once docs/13 ships.
 *
 * Timeout: each call has a 4s AbortController so a wedged tunnel / slow
 * network doesn't make the user's click feel dropped. The caller is
 * expected to fall back to localStorage if `ok` is false.
 *
 * Base URL: resolved from `NEXT_PUBLIC_GAME_API_URL` at module load.
 * Defaults to https://game.tournamental.com in prod, http://localhost:3360
 * locally (matched against typeof window for SSR safety).
 */

import type { Bracket, MatchPrediction } from "@tournamental/bracket-engine";

const DEFAULT_GAME_URL =
  typeof process !== "undefined" && process.env.NODE_ENV === "production"
    ? "https://game.tournamental.com"
    : "http://localhost:3360";

export const GAME_API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_GAME_API_URL) ||
  DEFAULT_GAME_URL;

/** Default per-request timeout. Tweakable so tests don't hang on aborted fetches. */
export const DEFAULT_TIMEOUT_MS = 4000;

export interface SavePerMatchInput {
  readonly userId: string;
  readonly matchId: string;
  readonly tournamentId: string;
  readonly outcome: MatchPrediction["outcome"];
  readonly homeScore?: number;
  readonly awayScore?: number;
  readonly oddsAtLock?: MatchPrediction["oddsAtLock"];
}

export interface SavePerMatchResult {
  readonly ok: true;
  readonly pick: MatchPrediction;
  readonly bracketId: string;
  readonly tournamentId: string;
  readonly stage: string | null;
  readonly cascadeRefreshHint: boolean;
}

export interface SaveFullBracketResult {
  readonly ok: true;
  readonly bracketId: string;
  readonly userId: string;
  readonly tournamentId: string;
  readonly lockedAt: string;
  readonly version: number;
  /**
   * Public opaque share guid the user copies into the share URL.
   * Always present in the response from a 0004-migrated server.
   */
  readonly shareGuid: string;
  readonly rejected?: ReadonlyArray<{
    readonly matchId: string;
    readonly error: string;
    readonly kickoff_utc: string;
    readonly lockedAt: string;
  }>;
}

export interface LoadServerBracketResult {
  readonly ok: true;
  readonly bracketId: string;
  readonly userId: string;
  readonly tournamentId: string;
  readonly lockedAt: string;
  readonly scoreTotal: number;
  readonly bracket: Bracket;
  readonly shareGuid: string | null;
}

export interface ApiFailure {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly message?: string;
}

export type ApiResult<T> = T | ApiFailure;

// ---------- internals ----------

interface CallOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Override AbortSignal (tests). If set, takes precedence over timeoutMs. */
  readonly signal?: AbortSignal;
}

function resolveFetch(opts: CallOptions): typeof fetch | null {
  if (opts.fetchImpl) return opts.fetchImpl;
  if (typeof fetch !== "undefined") return fetch;
  return null;
}

function resolveBase(opts: CallOptions): string {
  return (opts.baseUrl ?? GAME_API_BASE).replace(/\/+$/, "");
}

function abortAfter(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), ms);
  return {
    signal: ctl.signal,
    cancel: () => clearTimeout(id),
  };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---------- public surface ----------

/**
 * Save a single match prediction. Hits `PUT /v1/picks/:userId/:matchId`.
 *
 * Returns `ok: true` with the server's confirmed pick on 2xx. Returns
 * `ok: false` with the structured error code (e.g. `match_already_started`,
 * `outcome_not_allowed_for_stage`, `rate_limited`) on 4xx, and
 * `network_error` on transport failure / timeout. Callers should fall
 * back to localStorage on `ok: false` so the click never feels dropped.
 */
export async function savePerMatchPick(
  input: SavePerMatchInput,
  opts: CallOptions = {},
): Promise<ApiResult<SavePerMatchResult>> {
  const fetchImpl = resolveFetch(opts);
  if (!fetchImpl) return { ok: false, status: 0, code: "no_fetch" };
  const base = resolveBase(opts);
  const url = `${base}/v1/picks/${encodeURIComponent(input.userId)}/${encodeURIComponent(input.matchId)}`;
  const body = {
    tournament_id: input.tournamentId,
    outcome: input.outcome,
    ...(input.homeScore !== undefined ? { homeScore: input.homeScore } : {}),
    ...(input.awayScore !== undefined ? { awayScore: input.awayScore } : {}),
    ...(input.oddsAtLock ? { oddsAtLock: input.oddsAtLock } : {}),
  };
  const timer = opts.signal ? null : abortAfter(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-user-id": input.userId,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: opts.signal ?? timer?.signal,
    });
    timer?.cancel();
    const json = (await readJson(res)) as
      | {
          pick?: MatchPrediction;
          bracket_id?: string;
          tournament_id?: string;
          stage?: string | null;
          cascade_refresh_hint?: boolean;
          error?: string;
          message?: string;
        }
      | null;
    if (!res.ok || !json || !json.pick) {
      return {
        ok: false,
        status: res.status,
        code: json?.error ?? "save_failed",
        message: json?.message,
      };
    }
    return {
      ok: true,
      pick: json.pick,
      bracketId: json.bracket_id ?? "",
      tournamentId: json.tournament_id ?? input.tournamentId,
      stage: json.stage ?? null,
      cascadeRefreshHint: !!json.cascade_refresh_hint,
    };
  } catch (err) {
    timer?.cancel();
    return {
      ok: false,
      status: 0,
      code: (err as Error)?.name === "AbortError" ? "timeout" : "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Save the entire bracket. Hits `POST /v1/bracket/submit`.
 *
 * Used by the "Save bracket" CTA on the Final tab. Server also runs
 * the per-match-kickoff filter and echoes back any rejected
 * predictions; the caller surfaces those to the user as "couldn't
 * save 2 picks: matches already started".
 */
export async function saveFullBracket(
  args: {
    readonly userId: string;
    readonly tournamentId: string;
    readonly bracket: Bracket;
    /**
     * Optional client-minted share guid. If absent, the server mints
     * one (16-char hex) and returns it in the response. Either way the
     * caller reads the canonical guid from `result.shareGuid`.
     */
    readonly shareGuid?: string | null;
  },
  opts: CallOptions = {},
): Promise<ApiResult<SaveFullBracketResult>> {
  const fetchImpl = resolveFetch(opts);
  if (!fetchImpl) return { ok: false, status: 0, code: "no_fetch" };
  const base = resolveBase(opts);
  const url = `${base}/v1/bracket/submit`;
  const timer = opts.signal ? null : abortAfter(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": args.userId,
      },
      body: JSON.stringify({
        tournament_id: args.tournamentId,
        user_id: args.userId,
        bracket: args.bracket,
        ...(args.shareGuid ? { share_guid: args.shareGuid } : {}),
      }),
      cache: "no-store",
      signal: opts.signal ?? timer?.signal,
    });
    timer?.cancel();
    const json = (await readJson(res)) as
      | {
          bracket_id?: string;
          user_id?: string;
          tournament_id?: string;
          locked_at?: string;
          version?: number;
          share_guid?: string;
          rejected?: SaveFullBracketResult["rejected"];
          error?: string;
          message?: string;
        }
      | null;
    if (!res.ok || !json || !json.bracket_id) {
      return {
        ok: false,
        status: res.status,
        code: json?.error ?? "save_failed",
        message: json?.message,
      };
    }
    return {
      ok: true,
      bracketId: json.bracket_id,
      userId: json.user_id ?? args.userId,
      tournamentId: json.tournament_id ?? args.tournamentId,
      lockedAt: json.locked_at ?? new Date().toISOString(),
      version: json.version ?? args.bracket.version,
      shareGuid: json.share_guid ?? "",
      ...(json.rejected && json.rejected.length ? { rejected: json.rejected } : {}),
    };
  } catch (err) {
    timer?.cancel();
    return {
      ok: false,
      status: 0,
      code: (err as Error)?.name === "AbortError" ? "timeout" : "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Hydrate the bracket from the server. Hits `GET /v1/bracket/me`.
 *
 * Returns the persisted Bracket so the bracket builder can pick up
 * where the user left off on any device. Returns `ok: false` with
 * code `not_found` when the server has no bracket yet, the caller
 * should keep whatever's in localStorage.
 */
export async function loadServerBracket(
  args: { readonly userId: string; readonly tournamentId: string },
  opts: CallOptions = {},
): Promise<ApiResult<LoadServerBracketResult>> {
  const fetchImpl = resolveFetch(opts);
  if (!fetchImpl) return { ok: false, status: 0, code: "no_fetch" };
  const base = resolveBase(opts);
  const url = `${base}/v1/bracket/me?tournament_id=${encodeURIComponent(args.tournamentId)}`;
  const timer = opts.signal ? null : abortAfter(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { "x-user-id": args.userId },
      cache: "no-store",
      signal: opts.signal ?? timer?.signal,
    });
    timer?.cancel();
    const json = (await readJson(res)) as
      | {
          bracket_id?: string;
          user_id?: string;
          tournament_id?: string;
          locked_at?: string;
          score_total?: number;
          share_guid?: string | null;
          bracket?: Bracket;
          error?: string;
        }
      | null;
    if (res.status === 404) {
      return { ok: false, status: 404, code: json?.error ?? "not_found" };
    }
    if (!res.ok || !json || !json.bracket) {
      return {
        ok: false,
        status: res.status,
        code: json?.error ?? "load_failed",
      };
    }
    return {
      ok: true,
      bracketId: json.bracket_id ?? "",
      userId: json.user_id ?? args.userId,
      tournamentId: json.tournament_id ?? args.tournamentId,
      lockedAt: json.locked_at ?? "",
      scoreTotal: json.score_total ?? 0,
      bracket: json.bracket,
      shareGuid: json.share_guid ?? null,
    };
  } catch (err) {
    timer?.cancel();
    return {
      ok: false,
      status: 0,
      code: (err as Error)?.name === "AbortError" ? "timeout" : "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
