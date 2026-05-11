/**
 * MatchPickOverlay, client wrapper that opens the MatchPickPopup
 * whenever the URL has `?pick=open` (or `?pick=<matchId>` matching the
 * current match). Used to satisfy Tim's deep-link spec:
 *
 *   /match/[id]?pick=open       → popup opens on top of the preview page
 *
 * The overlay sits in the page tree once and only renders the popup
 * when the URL says so; closing it removes the search param.
 */

"use client";

import { useEffect, useState } from "react";

import type { Team } from "@tournamental/bracket-engine";

import { MatchPickPopup } from "@/components/match-pick/MatchPickPopup";

export interface MatchPickOverlayProps {
  readonly matchId: string;
  readonly homeTeam: Team | null;
  readonly awayTeam: Team | null;
  readonly kickoffIso?: string | null;
  readonly venue?: string | null;
  readonly noDraw?: boolean;
}

function readPickParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("pick");
}

function clearPickParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("pick")) return;
  url.searchParams.delete("pick");
  window.history.pushState({}, "", url.toString());
}

export function MatchPickOverlay(props: MatchPickOverlayProps) {
  const { matchId, homeTeam, awayTeam, kickoffIso, venue, noDraw } = props;
  const [open, setOpen] = useState<boolean>(false);

  useEffect(() => {
    const sync = () => {
      const param = readPickParam();
      // Accept either `?pick=open` (anywhere) or `?pick=<thisMatchId>`.
      setOpen(param === "open" || param === matchId);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [matchId]);

  if (!open || !homeTeam || !awayTeam) return null;
  return (
    <MatchPickPopup
      matchId={matchId}
      homeTeam={homeTeam}
      awayTeam={awayTeam}
      kickoffIso={kickoffIso ?? null}
      venue={venue ?? null}
      presentation="sheet"
      noDraw={noDraw}
      onClose={() => {
        clearPickParam();
        setOpen(false);
      }}
    />
  );
}
