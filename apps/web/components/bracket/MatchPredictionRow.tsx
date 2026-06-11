/**
 * MatchPredictionRow, one match in the group/knockout stage with the
 * "two big flags + small DRAW pill in the middle" UX. Live W/D/L odds
 * percentages sit inline under each option, fed by the parent's bulk
 * `/api/odds/snapshot` fetch (`odds` prop). When odds are not yet
 * loaded the percentages render as "-".
 *
 * Tap the home flag → home_win. Tap the away flag → away_win. Tap the
 * DRAW pill → draw (group stage only). Selected option gets a glow
 * ring + bright label; unselected options dim.
 *
 * Below the picks sits a single `MatchVenueFooter` lozenge showing
 * the user's local kickoff date/time + a gold info icon. Tapping it
 * opens the existing MatchOverlay with full venue + timing detail.
 * (FIFA WC 2026 doesn't collect predicted scores, so the previous
 * "Add score" toggle and the top-right "⋯" link were folded into
 * this single, much larger tap target. Tim 2026-06-06.)
 *
 * Keyboard: 1/H = home, 2/D = draw, 3/A = away. Arrow keys cycle.
 *
 * Pure controlled component; parent owns prediction state.
 */

"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";

import type { HostCity } from "@/lib/host-cities";
import { MatchVenueFooter } from "./MatchVenueFooter";

function safeT(
  t: ReturnType<typeof useTranslations>,
  key: string,
  fallback: string,
): string {
  try {
    const out = t(key);
    if (out === key) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

import type { MatchPrediction, Team } from "@tournamental/bracket-engine";

import type { MatchOdds } from "@/lib/odds/types";
import { snapshotOdds } from "@/lib/bracket/history";
import {
  headToHeadFor,
  type HeadToHeadCounts,
} from "@/lib/head-to-head";
import { recentFormResults } from "@/lib/team-form";
import { FormDots, type FormResult } from "@/components/shared/FormDots";
import { HeadToHeadPill } from "@/components/shared/HeadToHeadPill";
import { MatchPickPopup } from "@/components/match-pick/MatchPickPopup";
import { TeamFlag } from "./TeamFlag";

export interface MatchPredictionRowProps {
  readonly matchId: string;
  readonly homeTeam: Team;
  readonly awayTeam: Team;
  readonly prediction?: MatchPrediction;
  readonly disabled?: boolean;
  /** When true, the "Draw" option is hidden (knockout matches). */
  readonly noDraw?: boolean;
  readonly groupLabel?: string;
  readonly kickoffIso?: string;
  readonly country?: string | null;
  /** Reserved for tests that opt out of the odds-aware UI; currently a
   * no-op since odds are inline under each pick and there is no longer
   * a separate per-row OddsChip. */
  readonly showOddsChip?: boolean;
  /** Pre-fetched odds (shape from `/api/odds/snapshot`). Rendered
   * inline as the W/D/L percentages under each pick. */
  readonly odds?: MatchOdds | null;
  /**
   * Optional override for the home team's last-5 W/D/L sequence (most
   * recent first). When omitted we look it up from the bundled stub.
   * Tests pass an explicit array so they don't depend on stub contents.
   */
  readonly homeForm?: readonly FormResult[];
  /** Optional override for the away team's last-5 W/D/L sequence. */
  readonly awayForm?: readonly FormResult[];
  /**
   * Optional override for the head-to-head record. When omitted we look it
   * up from the bundled stub. Pass `null` explicitly to suppress the pill.
   */
  readonly headToHead?: HeadToHeadCounts | null;
  /** Resolved host-city record (city, country, stadium, capacity,
   * IANA timezone). Plumbed through to `MatchVenueFooter` so the
   * lozenge can format the kickoff date/time in the user's local
   * timezone on the client and in the venue's timezone during SSR.
   * Parents resolve it via `hostCityById(fixture.host_city_id)`. */
  readonly hostCity?: HostCity;
  readonly onChange: (next: MatchPrediction) => void;
}

const ALL_OUTCOMES: readonly MatchPrediction["outcome"][] = [
  "home_win",
  "draw",
  "away_win",
];

function nowIso(): string {
  return new Date().toISOString();
}

function pctLabel(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "-";
  return `${Math.round(p * 100)}%`;
}

export function MatchPredictionRow(props: MatchPredictionRowProps) {
  const t = useTranslations();
  const {
    matchId,
    homeTeam,
    awayTeam,
    prediction,
    disabled,
    noDraw,
    kickoffIso,
    odds,
    homeForm,
    awayForm,
    headToHead,
    hostCity,
    onChange,
  } = props;
  const [now, setNow] = useState<number>(() => Date.now());
  const [popupOpen, setPopupOpen] = useState<boolean>(false);

  // Cheap heartbeat so the kickoff lockout banner appears without a
  // page refresh once the match starts. We don't need second-accuracy
  //, a 30s tick is enough.
  useEffect(() => {
    if (!kickoffIso) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [kickoffIso]);

  // Lockout: once the match has kicked off, predictions are frozen.
  // Tim's spec: "lock off any changes … at kickoff (0 minutes)".
  const kickoffMs = kickoffIso ? Date.parse(kickoffIso) : null;
  const matchStarted =
    kickoffMs !== null && Number.isFinite(kickoffMs) && now >= kickoffMs;
  const locked = !!disabled || matchStarted;

  const outcomes = noDraw ? ALL_OUTCOMES.filter((o) => o !== "draw") : ALL_OUTCOMES;

  const choose = (outcome: MatchPrediction["outcome"]): void => {
    if (locked) return;
    onChange({
      matchId,
      outcome,
      homeScore: prediction?.homeScore,
      awayScore: prediction?.awayScore,
      lockedAt: nowIso(),
      oddsAtLock: snapshotOdds(odds),
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (locked) return;
    const k = e.key.toLowerCase();
    if (k === "1" || k === "h") {
      e.preventDefault();
      choose("home_win");
    } else if (k === "2" || (k === "d" && !noDraw)) {
      e.preventDefault();
      if (!noDraw) choose("draw");
    } else if (k === "3" || k === "a" || (k === "2" && noDraw)) {
      e.preventDefault();
      choose("away_win");
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const cur = prediction?.outcome ?? outcomes[0]!;
      const idx = outcomes.indexOf(cur);
      const next =
        e.key === "ArrowLeft"
          ? outcomes[Math.max(0, idx - 1)]!
          : outcomes[Math.min(outcomes.length - 1, idx + 1)]!;
      e.preventDefault();
      choose(next);
    }
  };

  const accent: CSSProperties = {
    "--mpr-home-accent": homeTeam.kit?.primary ?? "#fbbf24",
    "--mpr-away-accent": awayTeam.kit?.primary ?? "#3b82f6",
  } as CSSProperties;

  const isHome = prediction?.outcome === "home_win";
  const isDraw = prediction?.outcome === "draw";
  const isAway = prediction?.outcome === "away_win";

  // Resolve form + h2h from props or fall back to the bundled stub. We
  // recompute these on every render, the underlying lookups are pure
  // synchronous reads from a small map so the cost is negligible relative
  // to the surrounding React work.
  const homeFormResults: readonly FormResult[] =
    homeForm ?? recentFormResults(homeTeam.id);
  const awayFormResults: readonly FormResult[] =
    awayForm ?? recentFormResults(awayTeam.id);
  const h2h: HeadToHeadCounts | null =
    headToHead === undefined
      ? headToHeadFor(homeTeam.id, awayTeam.id)
      : headToHead;

  return (
    <div
      className={`mpr-row ${matchStarted ? "is-locked" : ""}`}
      data-match-id={matchId}
      data-no-draw={noDraw ? "true" : undefined}
      role="group"
      aria-label={`${homeTeam.name} vs ${awayTeam.name} prediction`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={accent}
    >
      {matchStarted && (
        // Tim 2026-06-12: the verbose "Sorry, this match has already
        // started" copy collapses to a small padlock chip in the
        // upper-right of the row. Hover gives the same context on
        // desktop; touch users see a `title`-driven long-press hint.
        // The chip's label flips from "in progress" to "resulted" once
        // a result is known (wired in a follow-up pass). For now the
        // chip just says "in progress".
        <div
          className="mpr-lock-chip"
          role="img"
          aria-label="Match is in progress and locked"
          title="You cannot make changes to this prediction, the match is in progress."
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <span className="mpr-lock-chip-label">In progress</span>
        </div>
      )}
      {/* The previous top-right "⋯" link (Tim 2026-06-06) was folded
       * into the new full-width MatchVenueFooter lozenge below. One
       * single, easy tap target instead of a small icon in the
       * corner. */}
      {popupOpen && (
        <MatchPickPopup
          matchId={matchId}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          kickoffIso={kickoffIso ?? null}
          presentation="sheet"
          noDraw={noDraw}
          odds={odds ?? null}
          initialPick={prediction ?? null}
          onSaved={(saved) => {
            // Mirror the popup save back into the parent state so the
            // inline row reflects the new pick without a refresh.
            onChange(saved);
            setPopupOpen(false);
          }}
          onClose={() => setPopupOpen(false)}
        />
      )}
      <button
        type="button"
        className={`mpr-pick mpr-pick-home ${isHome ? "is-selected" : ""} ${prediction && !isHome ? "is-dim" : ""}`}
        aria-pressed={isHome}
        aria-label={`${homeTeam.name} to win`}
        onClick={() => choose("home_win")}
        disabled={locked}
      >
        <TeamFlag
          code={homeTeam.id}
          name={homeTeam.name}
          accentColor={homeTeam.kit?.primary}
          size="lg"
          sparkle={isHome}
          shape="circle"
          selectionRing={isHome}
          dim={!!prediction && !isHome}
        />
        <span className="mpr-pick-code">{homeTeam.id}</span>
        <span className="mpr-pick-pct" data-outcome="home_win">
          {pctLabel(odds?.homeWin)}
        </span>
      </button>

      {!noDraw && (
        <button
          type="button"
          className={`mpr-pick mpr-pick-draw ${isDraw ? "is-selected" : ""} ${prediction && !isDraw ? "is-dim" : ""}`}
          aria-pressed={isDraw}
          aria-label="Draw"
          onClick={() => choose("draw")}
          disabled={locked}
        >
          <span className="mpr-pick-draw-pill">{safeT(t, "bracket.match.draw", "DRAW")}</span>
          <span className="mpr-pick-pct" data-outcome="draw">
            {pctLabel(odds?.draw)}
          </span>
        </button>
      )}

      <button
        type="button"
        className={`mpr-pick mpr-pick-away ${isAway ? "is-selected" : ""} ${prediction && !isAway ? "is-dim" : ""}`}
        aria-pressed={isAway}
        aria-label={`${awayTeam.name} to win`}
        onClick={() => choose("away_win")}
        disabled={locked}
      >
        <TeamFlag
          code={awayTeam.id}
          name={awayTeam.name}
          accentColor={awayTeam.kit?.primary}
          size="lg"
          sparkle={isAway}
          shape="circle"
          selectionRing={isAway}
          dim={!!prediction && !isAway}
        />
        <span className="mpr-pick-code">{awayTeam.id}</span>
        <span className="mpr-pick-pct" data-outcome="away_win">
          {pctLabel(odds?.awayWin)}
        </span>
      </button>

      {kickoffIso && (
        <MatchVenueFooter
          matchId={matchId}
          homeName={homeTeam.name}
          awayName={awayTeam.name}
          kickoffIso={kickoffIso}
          hostCity={hostCity}
        />
      )}
    </div>
  );
}
