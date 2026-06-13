/**
 * useLiveMatchStatus, the client-side hook that polls
 * /api/v1/live-status/<tid> every 60s and exposes the resulting
 * "match_no -> live status" map to consumers.
 *
 * Used by:
 *   - Calendar page (CalendarPicksProvider) — to swap the static
 *     "LOCKED" chip on currently-playing matches for a live
 *     "IN PROGRESS - 3-1 - 77'" treatment.
 *   - Bracket page (BracketBuilder / MatchPredictionRow) — same.
 *
 * Both surfaces hit the same edge-cached endpoint so the double
 * fetch is cheap (server cache absorbs it).
 *
 * Tim 2026-06-13.
 */

"use client";

import { useEffect, useState } from "react";

export interface LiveStatus {
  readonly match_no: number;
  readonly match_id: string;
  readonly state: "in";
  readonly statusName: string;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly clock: string;
  readonly period: number | null;
  readonly homeCode: string;
  readonly awayCode: string;
}

const POLL_INTERVAL_MS = 60_000;

export function useLiveMatchStatus(
  tournamentId: string,
): ReadonlyMap<string, LiveStatus> {
  const [byMatch, setByMatch] = useState<ReadonlyMap<string, LiveStatus>>(
    () => new Map(),
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/v1/live-status/${tournamentId}`, {
          credentials: "same-origin",
        });
        if (!r.ok) return;
        const body = (await r.json()) as { live?: ReadonlyArray<LiveStatus> };
        if (cancelled || !body.live) return;
        const next = new Map<string, LiveStatus>();
        for (const row of body.live) next.set(row.match_id, row);
        setByMatch(next);
      } catch {
        // Silent — next tick retries.
      }
    }
    void load();
    const id = window.setInterval(load, POLL_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tournamentId]);

  return byMatch;
}
