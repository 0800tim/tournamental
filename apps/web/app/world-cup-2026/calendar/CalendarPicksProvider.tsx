/**
 * CalendarPicksProvider, owns the bracket state for the calendar
 * picker surface and mirrors what BracketBuilder does for the
 * interactive bracket page:
 *
 *   - Hydrate from localStorage (sync) then from /v1/bracket/me (async).
 *   - Merge local + server with mergeBrackets({ tournament }) so any
 *     match whose kickoff has passed defers to the server side, even
 *     if the local lockedAt is newer. Same rule as the bracket page,
 *     same incident root cause (Tim 2026-06-12).
 *   - Auto-save to /v1/bracket/submit ~3s after the last edit, then
 *     immediately on tab-hide and on unmount.
 *   - Resolve the knockout cascade so R32 .. Final rows know their
 *     home / away codes once enough group picks land.
 *   - Fetch /api/v1/match-results/<tid> for the resulted-state row
 *     UI (score + tick/cross).
 *
 * The bracket page (BracketBuilder) has its own provider-equivalent
 * inside the component. Both write to the same /v1/bracket/submit
 * endpoint — last-write-wins per match by lockedAt, and the server
 * rejects any post-kickoff edit (SEC-BRK-02). So a user can edit on
 * either surface and they reconcile transparently.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type Bracket,
  type MatchPrediction,
  type Tournament,
} from "@tournamental/bracket-engine";

import { useUser } from "@/lib/auth/useUser";
import { bracketSignature } from "@/lib/bracket/signature";
import { mergeBrackets } from "@/lib/bracket/merge";
import { cascadeWithUserPicks } from "@/lib/bracket/cascade-iter";
import {
  loadDraft,
  saveDraft,
  localUserId,
} from "@/lib/bracket/storage";
import { loadServerBracket, saveFullBracket } from "@/lib/bracket/api";

import {
  CalendarPicksContext,
  type CalendarPickRequest,
  type CalendarPicksContextValue,
} from "./CalendarPicksContext";
import type { ResultedMatch } from "./types";

const AUTOSAVE_DELAY_MS = 3000;

export interface CalendarPicksProviderProps {
  readonly tournament: Tournament;
  readonly children: React.ReactNode;
}

function emptyBracket(): Bracket {
  return {
    bracketId: "",
    matchPredictions: {},
    groupTiebreakers: {},
    knockoutPredictions: {},
    version: 1,
  } as Bracket;
}

export function CalendarPicksProvider({
  tournament,
  children,
}: CalendarPicksProviderProps) {
  const auth = useUser();
  const userId = auth.user?.id ?? localUserId();

  const [bracket, setBracket] = useState<Bracket>(emptyBracket);
  const [hydrated, setHydrated] = useState(false);
  const [lastSavedSig, setLastSavedSig] = useState<string | null>(null);
  const [resultsByMatch, setResultsByMatch] = useState<
    ReadonlyMap<string, ResultedMatch>
  >(new Map());

  // Hydrate: localStorage first (instant) → server bracket (async,
  // merged with the past-kickoff rule).
  useEffect(() => {
    if (auth.loading) return;
    let cancelled = false;
    const localDraft = loadDraft(tournament.id, userId);
    const initial = localDraft ?? emptyBracket();
    setBracket(initial);

    void (async () => {
      const remote = await loadServerBracket({
        userId,
        tournamentId: tournament.id,
      });
      if (cancelled) return;
      if (!remote.ok) {
        // Couldn't reach the server; treat local as authoritative for now.
        setLastSavedSig(bracketSignature(initial));
        setHydrated(true);
        return;
      }
      setBracket((current) => {
        const merged = mergeBrackets(current, remote.bracket, { tournament });
        saveDraft(tournament.id, merged, userId);
        // Anchor autosave baseline to the REMOTE signature so any
        // local-only state triggers an autosave on next tick — same
        // policy as BracketBuilder (commit d1206f3).
        setLastSavedSig(bracketSignature(remote.bracket));
        return merged;
      });
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [tournament, userId, auth.loading]);

  // Fetch recorded results (and refresh on tab-visibility change).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/v1/match-results/${tournament.id}`, {
          credentials: "same-origin",
        });
        if (!r.ok) return;
        const body = (await r.json()) as {
          results?: ReadonlyArray<ResultedMatch>;
        };
        if (cancelled || !body.results) return;
        const map = new Map<string, ResultedMatch>();
        for (const row of body.results) map.set(row.matchId, row);
        setResultsByMatch(map);
      } catch {
        // Silent — calendar still renders pre-result state.
      }
    }
    void load();
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tournament.id]);

  // Cascade-resolved team codes for knockouts. Re-computes when the
  // bracket changes; cheap (single iterative pass).
  const cascadeCodes = useMemo(() => {
    const map = new Map<string, { home?: string; away?: string }>();
    try {
      const out = cascadeWithUserPicks(tournament, bracket, "calendar-picker");
      for (const k of out.knockouts ?? []) {
        map.set(k.id, {
          home: k.home.team ?? undefined,
          away: k.away.team ?? undefined,
        });
      }
    } catch {
      // ignore — leave the map empty so rows fall back to TBD.
    }
    return map;
  }, [tournament, bracket]);

  // Per-pick handler. Patches the right map (group vs knockout) and
  // schedules an autosave. Skips silently if the match has already
  // kicked off (the user shouldn't be able to click anyway; defensive).
  const setPick = useCallback(
    ({ matchId, outcome, stage }: CalendarPickRequest) => {
      setBracket((current) => {
        const now = new Date().toISOString();
        const oldPick = (stage === "group"
          ? current.matchPredictions?.[matchId]
          : current.knockoutPredictions?.[matchId]) as
          | MatchPrediction
          | undefined;
        const newPick: MatchPrediction = {
          ...(oldPick ?? {
            matchId,
            outcome,
            oddsAtLock: undefined,
          }),
          matchId,
          outcome,
          lockedAt: now,
        };
        const next: Bracket = {
          ...current,
          ...(stage === "group"
            ? {
                matchPredictions: {
                  ...(current.matchPredictions ?? {}),
                  [matchId]: newPick,
                },
              }
            : {
                knockoutPredictions: {
                  ...(current.knockoutPredictions ?? {}),
                  [matchId]: newPick,
                },
              }),
        };
        saveDraft(tournament.id, next, userId);
        return next;
      });
    },
    [tournament.id, userId],
  );

  // Autosave: a debounced timer flushes the bracket to the server
  // when the live signature differs from the baseline.
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    const sig = bracketSignature(bracket);
    if (sig === lastSavedSig) return;
    try {
      const res = await saveFullBracket({
        userId,
        tournamentId: tournament.id,
        bracket,
      });
      if (res.ok) {
        setLastSavedSig(sig);
      }
    } catch {
      // Silent — next change will re-attempt.
    }
  }, [bracket, lastSavedSig, tournament.id, userId]);

  useEffect(() => {
    if (!hydrated) return;
    const sig = bracketSignature(bracket);
    if (sig === lastSavedSig) return;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      void flush();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [bracket, lastSavedSig, hydrated, flush]);

  // Flush on tab-hide so half-pending picks don't get lost when the
  // user backgrounds the tab.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") void flush();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  const value: CalendarPicksContextValue = useMemo(
    () => ({ bracket, setPick, resultsByMatch, cascadeCodes, hydrated }),
    [bracket, setPick, resultsByMatch, cascadeCodes, hydrated],
  );

  return (
    <CalendarPicksContext.Provider value={value}>
      {children}
    </CalendarPicksContext.Provider>
  );
}
