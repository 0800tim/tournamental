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
 * Keyboard: 1/H = home, 2/D = draw, 3/A = away. Arrow keys cycle.
 *
 * Pure controlled component; parent owns prediction state.
 */

"use client";

import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";

import type { MatchPrediction, Team } from "@vtorn/bracket-engine";

import type { MatchOdds } from "@/lib/odds/types";
import { snapshotOdds } from "@/lib/bracket/history";
import {
  headToHeadFor,
  type HeadToHeadCounts,
} from "@/lib/head-to-head";
import { recentFormResults } from "@/lib/team-form";
import { FormDots, type FormResult } from "@/components/shared/FormDots";
import { HeadToHeadPill } from "@/components/shared/HeadToHeadPill";
import { useOptionalOverlay } from "@/components/overlay/OverlayProvider";
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
    onChange,
  } = props;
  const [showScores, setShowScores] = useState<boolean>(
    prediction?.homeScore !== undefined || prediction?.awayScore !== undefined,
  );
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

  const setScore = (side: "home" | "away", value: string): void => {
    if (locked) return;
    const n = value === "" ? undefined : Math.max(0, Math.min(99, Number(value)));
    if (value !== "" && Number.isNaN(n)) return;
    onChange({
      matchId,
      outcome: prediction?.outcome ?? "home_win",
      homeScore: side === "home" ? n : prediction?.homeScore,
      awayScore: side === "away" ? n : prediction?.awayScore,
      lockedAt: nowIso(),
      oddsAtLock: prediction?.oddsAtLock ?? snapshotOdds(odds),
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

  // Optional overlay router, when present, tapping the small "info"
  // chip below a flag opens the team overlay; tapping the "View match"
  // link opens the match overlay. When absent (e.g. in tests or pages
  // outside the bracket shell) these fall back to plain links.
  const overlay = useOptionalOverlay();
  const openTeamOverlay = (code: string) => (e: React.MouseEvent): void => {
    if (!overlay) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    overlay.open("team", { code });
  };
  const openMatchOverlay = (e: React.MouseEvent): void => {
    if (!overlay) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    overlay.open("match", { id: matchId });
  };

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
        <div className="mpr-locked-banner" role="status" aria-live="polite">
          Sorry, this match has already started. You can&apos;t change it now.
        </div>
      )}
      <a
        href={`/match/${matchId}/preview`}
        className="mpr-view-link"
        aria-label={`View match preview for ${homeTeam.name} vs ${awayTeam.name}`}
        title="View match preview"
        onClick={(e) => {
          e.stopPropagation();
          openMatchOverlay(e);
        }}
      >
        View match
      </a>
      <button
        type="button"
        className="mpr-popup-trigger"
        aria-label={`Open pick popup for ${homeTeam.name} vs ${awayTeam.name}`}
        title="Open in popup"
        onClick={(e) => {
          e.stopPropagation();
          setPopupOpen(true);
        }}
      >
        ⋯
      </button>
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
          <span className="mpr-pick-draw-pill">DRAW</span>
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

      <div className="mpr-scores-wrap">
        <button
          type="button"
          className="mpr-scores-toggle"
          aria-expanded={showScores}
          onClick={() => setShowScores((v) => !v)}
        >
          {showScores ? "Hide scores" : "Add score"}
        </button>
        {showScores && (
          <div className="mpr-scores">
            <label>
              <span className="sr-only">{homeTeam.name} score</span>
              <input
                type="number"
                min={0}
                max={99}
                value={prediction?.homeScore ?? ""}
                onChange={(e) => setScore("home", e.target.value)}
                disabled={locked}
                aria-label={`${homeTeam.name} score`}
              />
            </label>
            <span aria-hidden="true">–</span>
            <label>
              <span className="sr-only">{awayTeam.name} score</span>
              <input
                type="number"
                min={0}
                max={99}
                value={prediction?.awayScore ?? ""}
                onChange={(e) => setScore("away", e.target.value)}
                disabled={locked}
                aria-label={`${awayTeam.name} score`}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
