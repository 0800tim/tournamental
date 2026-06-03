/**
 * useMatchPick, load + save a single match prediction against the
 * per-match game-service endpoints (PUT/GET/DELETE
 * /v1/picks/:userId/:matchId).
 *
 * No SWR. The hook is a tiny manual fetch + reducer because the data
 * shape is small and the surrounding component already controls when
 * to revalidate (open/close of the popup). Avoiding SWR keeps the
 * client bundle lean.
 *
 * The hook silently writes the saved pick into the same localStorage
 * draft used by the bulk submit path so the user's bracket stays
 * coherent if they later open the bulk bracket builder.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import type { MatchPrediction } from "@tournamental/bracket-engine";

import { loadDraft, saveDraft, localUserId } from "@/lib/bracket/storage";

// Resolution order:
//   1. NEXT_PUBLIC_GAME_API_URL, canonical (matches `lib/bracket/api.ts`).
//   2. NEXT_PUBLIC_VTORN_GAME_URL, legacy env var name; kept for any
//      pre-existing deployment that still sets it.
//   3. https://game.tournamental.com, production default.
const GAME_BASE =
  process.env.NEXT_PUBLIC_GAME_API_URL ??
  process.env.NEXT_PUBLIC_VTORN_GAME_URL ??
  "https://game.tournamental.com";

export interface MatchPickError {
  readonly status: number;
  readonly code: string;
  readonly kickoff_utc?: string | null;
  readonly stage?: string | null;
  readonly message?: string;
}

export interface SavePickInput {
  readonly outcome: MatchPrediction["outcome"];
  readonly homeScore?: number;
  readonly awayScore?: number;
  readonly oddsAtLock?: MatchPrediction["oddsAtLock"];
}

export interface UseMatchPickResult {
  readonly pick: MatchPrediction | null;
  readonly stage: string | null;
  readonly kickoffUtc: string | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly error: MatchPickError | null;
  /** Re-fetch from the API. */
  refresh(): Promise<void>;
  /** Save a pick. Returns the saved prediction or throws on hard error. */
  save(input: SavePickInput): Promise<MatchPrediction>;
  /** Remove the pick. */
  remove(): Promise<void>;
}

export interface UseMatchPickOptions {
  /** Tournament id. Defaults to "fifa-wc-2026". */
  readonly tournamentId?: string;
  /** Override the user id (tests, server-rendered links). */
  readonly userId?: string;
  /** Override the API base (tests). */
  readonly baseUrl?: string;
  /** Fetch implementation (tests). */
  readonly fetchImpl?: typeof fetch;
  /** Stage hint, used to merge the local draft when the API isn't reachable. */
  readonly stageHint?: "group" | "knockout";
}

const DEFAULT_TOURNAMENT = "fifa-wc-2026";

/**
 * Returns a stable user id for picks. On the server falls back to
 * "ssr_user". On the client uses the per-browser id from
 * `lib/bracket/storage`.
 */
function resolveUserId(opts: UseMatchPickOptions): string {
  if (opts.userId) return opts.userId;
  if (typeof window === "undefined") return "ssr_user";
  return localUserId();
}

function buildBase(opts: UseMatchPickOptions): string {
  return opts.baseUrl ?? GAME_BASE;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Merge a saved prediction into the local bulk-bracket draft. Best-effort -
 * if the user has never opened the bracket builder, the draft is empty
 * and we just write the single pick into it.
 */
function mergeIntoLocalDraft(
  tournamentId: string,
  userId: string,
  matchId: string,
  pred: MatchPrediction,
  stage: string | null,
): void {
  if (typeof window === "undefined") return;
  const isKnockout = !!stage && stage !== "group";
  const existing = loadDraft(tournamentId, userId);
  if (existing) {
    const next = {
      ...existing,
      matchPredictions: isKnockout
        ? existing.matchPredictions
        : { ...existing.matchPredictions, [matchId]: pred },
      knockoutPredictions: isKnockout
        ? { ...existing.knockoutPredictions, [matchId]: pred }
        : existing.knockoutPredictions,
    };
    saveDraft(tournamentId, next, userId);
    return;
  }
  saveDraft(
    tournamentId,
    {
      bracketId: `bk_local_${userId}_${tournamentId}`,
      matchPredictions: isKnockout ? {} : { [matchId]: pred },
      groupTiebreakers: {},
      knockoutPredictions: isKnockout ? { [matchId]: pred } : {},
      version: 1,
    },
    userId,
  );
}

export function useMatchPick(
  matchId: string,
  options: UseMatchPickOptions = {},
): UseMatchPickResult {
  const tournamentId = options.tournamentId ?? DEFAULT_TOURNAMENT;
  const fetchImpl = options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  const userId = resolveUserId(options);
  const base = buildBase(options);

  const [pick, setPick] = useState<MatchPrediction | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [kickoffUtc, setKickoffUtc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<MatchPickError | null>(null);

  const refresh = useCallback(async () => {
    if (!fetchImpl || !matchId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const url = `${base}/v1/picks/${encodeURIComponent(userId)}/${encodeURIComponent(matchId)}?tournament_id=${encodeURIComponent(tournamentId)}`;
      const res = await fetchImpl(url, {
        method: "GET",
        // SEC-WEB-03: cookie-only identity. The .tournamental.com
        // tnm_session cookie is forwarded via credentials: include;
        // game-service trusts only that signal in prod.
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 404) {
        setPick(null);
        // Fall back to the local draft so a user who picked offline
        // sees their saved pick when they reopen the popup.
        const draft = typeof window !== "undefined" ? loadDraft(tournamentId, userId) : null;
        const local =
          draft?.matchPredictions?.[matchId] ??
          draft?.knockoutPredictions?.[matchId] ??
          null;
        if (local) setPick(local);
        setIsLoading(false);
        return;
      }
      const json = (await readJson(res)) as
        | {
            pick?: MatchPrediction;
            stage?: string | null;
            kickoff_utc?: string | null;
            error?: string;
          }
        | null;
      if (!res.ok || !json) {
        setError({
          status: res.status,
          code: json?.error ?? "fetch_failed",
        });
        setIsLoading(false);
        return;
      }
      setPick(json.pick ?? null);
      setStage(json.stage ?? null);
      setKickoffUtc(json.kickoff_utc ?? null);
      setIsLoading(false);
    } catch (e) {
      // Network error → fall back to the local draft.
      const draft = typeof window !== "undefined" ? loadDraft(tournamentId, userId) : null;
      const local =
        draft?.matchPredictions?.[matchId] ??
        draft?.knockoutPredictions?.[matchId] ??
        null;
      setPick(local);
      setError({
        status: 0,
        code: "network_error",
        message: e instanceof Error ? e.message : String(e),
      });
      setIsLoading(false);
    }
  }, [base, fetchImpl, matchId, tournamentId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: SavePickInput): Promise<MatchPrediction> => {
      setIsSaving(true);
      setError(null);
      const url = `${base}/v1/picks/${encodeURIComponent(userId)}/${encodeURIComponent(matchId)}`;
      const body = {
        tournament_id: tournamentId,
        outcome: input.outcome,
        ...(input.homeScore !== undefined ? { homeScore: input.homeScore } : {}),
        ...(input.awayScore !== undefined ? { awayScore: input.awayScore } : {}),
        ...(input.oddsAtLock ? { oddsAtLock: input.oddsAtLock } : {}),
      };
      const local: MatchPrediction = {
        matchId,
        outcome: input.outcome,
        ...(input.homeScore !== undefined ? { homeScore: input.homeScore } : {}),
        ...(input.awayScore !== undefined ? { awayScore: input.awayScore } : {}),
        lockedAt: new Date().toISOString(),
        ...(input.oddsAtLock ? { oddsAtLock: input.oddsAtLock } : {}),
      };
      let res: Response | null = null;
      let networkError: Error | null = null;
      try {
        res = fetchImpl
          ? await fetchImpl(url, {
              method: "PUT",
              // SEC-WEB-03: cookie-only identity (no x-user-id).
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify(body),
              credentials: "include",
              cache: "no-store",
            })
          : null;
      } catch (e) {
        networkError = e instanceof Error ? e : new Error(String(e));
      }
      const json = (res ? await readJson(res) : null) as
        | {
            pick?: MatchPrediction;
            stage?: string | null;
            error?: string;
            kickoff_utc?: string | null;
            message?: string;
          }
        | null;

      if (networkError || !res || !res.ok) {
        // Local-only fallback so the user never feels like the click
        // dropped on the floor.
        mergeIntoLocalDraft(
          tournamentId,
          userId,
          matchId,
          local,
          options.stageHint === "knockout" ? "knockout" : json?.stage ?? null,
        );
        setPick(local);
        setError({
          status: res?.status ?? 0,
          code: networkError ? "network_error" : json?.error ?? "save_failed",
          kickoff_utc: json?.kickoff_utc ?? null,
          stage: json?.stage ?? null,
          message: networkError?.message ?? json?.message,
        });
        setIsSaving(false);
        throw networkError ?? new Error(json?.error ?? "save_failed");
      }
      const next = json!.pick ?? local;
      setPick(next);
      if (json!.stage !== undefined) setStage(json!.stage ?? null);
      mergeIntoLocalDraft(tournamentId, userId, matchId, next, json!.stage ?? null);
      setIsSaving(false);
      return next;
    },
    [base, fetchImpl, matchId, tournamentId, userId, options.stageHint],
  );

  const remove = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    const url = `${base}/v1/picks/${encodeURIComponent(userId)}/${encodeURIComponent(matchId)}?tournament_id=${encodeURIComponent(tournamentId)}`;
    try {
      const res = fetchImpl
        ? await fetchImpl(url, {
            method: "DELETE",
            // SEC-WEB-03: cookie-only identity.
            credentials: "include",
            cache: "no-store",
          })
        : null;
      const json = (res ? await readJson(res) : null) as
        | { error?: string; kickoff_utc?: string | null }
        | null;
      if (res && !res.ok) {
        setError({
          status: res.status,
          code: json?.error ?? "delete_failed",
          kickoff_utc: json?.kickoff_utc ?? null,
        });
        setIsSaving(false);
        return;
      }
      setPick(null);
      setIsSaving(false);
    } catch (e) {
      setError({
        status: 0,
        code: "network_error",
        message: e instanceof Error ? e.message : String(e),
      });
      setIsSaving(false);
    }
  }, [base, fetchImpl, matchId, tournamentId, userId]);

  return {
    pick,
    stage,
    kickoffUtc,
    isLoading,
    isSaving,
    error,
    refresh,
    save,
    remove,
  };
}
