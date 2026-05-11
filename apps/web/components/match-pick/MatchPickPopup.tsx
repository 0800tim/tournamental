/**
 * MatchPickPopup, single-match prediction popup that can render as
 * a bottom-sheet, a centered modal, or an inline card.
 *
 * Tim's spec: "as you're browsing and looking at teams and matches and
 * seeing when they're playing… tap on each of those and pop up just
 * that match and predict that match, like changing your score." Same
 * component is reusable from the bracket grid, the team page, search
 * results, and (later) social cards.
 *
 * Persistence: hooks into `useMatchPick` which talks to the per-match
 * game-service endpoints (PUT/GET/DELETE /v1/picks/:userId/:matchId).
 *
 * Kickoff freeze: if `now() >= kickoff`, the W/D/L buttons disable and a
 * banner appears with Tim's exact phrasing, same message as
 * `MatchPredictionRow`.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal="true" for sheet/modal.
 *   - Inline mode renders as a normal card (no role/aria-modal).
 *   - Escape key closes; backdrop click closes; X button closes.
 *   - Tab order: first focusable is the close button; after that the
 *     three picks; then the score steppers; then Save/Cancel.
 *   - Drag-down to close on mobile is wired in via a touch listener
 *     on the sheet header.
 */

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";

import type { MatchPrediction, Team } from "@tournamental/bracket-engine";

import type { MatchOdds } from "@/lib/odds/types";
import { snapshotOdds } from "@/lib/bracket/history";
import { TeamFlag } from "@/components/bracket/TeamFlag";

import { useMatchPick } from "./useMatchPick";

import "./MatchPickPopup.css";

export type MatchPickPresentation = "sheet" | "modal" | "inline";

export interface MatchPickPopupProps {
  readonly matchId: string;
  readonly homeTeam: Team;
  readonly awayTeam: Team;
  readonly kickoffIso?: string | null;
  readonly venue?: string | null;
  /** Tournament id passed to the API. Defaults to fifa-wc-2026. */
  readonly tournamentId?: string;
  /** Live odds; clicking the chip expands an oddsAtLock summary. */
  readonly odds?: MatchOdds | null;
  /** Optional override for the inline user id (tests). */
  readonly userId?: string;
  /** Knockouts hide the draw button. */
  readonly noDraw?: boolean;
  /** Where to render: bottom sheet / centered modal / inline card. */
  readonly presentation: MatchPickPresentation;
  /**
   * Optional initial pick. When omitted, the hook fetches from the API.
   * Tests pass this to keep their fixtures synchronous.
   */
  readonly initialPick?: MatchPrediction | null;
  /** Override the fetch impl (tests). */
  readonly fetchImpl?: typeof fetch;
  /** Override the API base (tests). */
  readonly baseUrl?: string;
  readonly onSaved?: (pick: MatchPrediction) => void;
  readonly onClose: () => void;
}

const ALL_OUTCOMES: readonly MatchPrediction["outcome"][] = [
  "home_win",
  "draw",
  "away_win",
];

function pctLabel(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "-";
  return `${Math.round(p * 100)}%`;
}

function fmtKickoff(iso?: string | null): string {
  if (!iso) return "Kickoff TBC";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })} - ${d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function MatchPickPopup(props: MatchPickPopupProps) {
  const {
    matchId,
    homeTeam,
    awayTeam,
    kickoffIso,
    venue,
    tournamentId,
    odds,
    userId,
    noDraw,
    presentation,
    initialPick,
    fetchImpl,
    baseUrl,
    onSaved,
    onClose,
  } = props;

  const stageHint = noDraw ? "knockout" : "group";
  const hook = useMatchPick(matchId, {
    tournamentId,
    userId,
    fetchImpl,
    baseUrl,
    stageHint,
  });

  // Local UI state for the controlled outcome + scores. Hydrated from the
  // hook on first paint and after each refresh.
  const [outcome, setOutcome] = useState<MatchPrediction["outcome"] | null>(
    initialPick?.outcome ?? hook.pick?.outcome ?? null,
  );
  const [homeScore, setHomeScore] = useState<number | undefined>(
    initialPick?.homeScore ?? hook.pick?.homeScore,
  );
  const [awayScore, setAwayScore] = useState<number | undefined>(
    initialPick?.awayScore ?? hook.pick?.awayScore,
  );
  const [showScores, setShowScores] = useState<boolean>(false);
  const [oddsExpanded, setOddsExpanded] = useState<boolean>(false);
  const [now, setNow] = useState<number>(() => Date.now());

  // Sync hook state into local controlled state when the hook resolves.
  useEffect(() => {
    if (hook.pick) {
      setOutcome((cur) => cur ?? hook.pick!.outcome);
      setHomeScore((cur) => (cur === undefined ? hook.pick!.homeScore : cur));
      setAwayScore((cur) => (cur === undefined ? hook.pick!.awayScore : cur));
    }
  }, [hook.pick]);

  // Tick the lock state without a refresh once kickoff approaches.
  useEffect(() => {
    if (!kickoffIso) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [kickoffIso]);

  const kickoffMs = kickoffIso ? Date.parse(kickoffIso) : null;
  const matchStarted =
    kickoffMs !== null && Number.isFinite(kickoffMs) && now >= kickoffMs;
  const locked = matchStarted;

  const outcomes: readonly MatchPrediction["outcome"][] = useMemo(
    () => (noDraw ? ALL_OUTCOMES.filter((o) => o !== "draw") : ALL_OUTCOMES),
    [noDraw],
  );

  // Drag-down to close, works on the sheet header only.
  const dragRef = useRef<{ startY: number; lastY: number } | null>(null);
  const onTouchStart = (e: ReactTouchEvent<HTMLElement>) => {
    if (presentation !== "sheet") return;
    const t = e.touches[0];
    if (!t) return;
    dragRef.current = { startY: t.clientY, lastY: t.clientY };
  };
  const onTouchMove = (e: ReactTouchEvent<HTMLElement>) => {
    if (presentation !== "sheet") return;
    const t = e.touches[0];
    if (!t || !dragRef.current) return;
    dragRef.current.lastY = t.clientY;
  };
  const onTouchEnd = () => {
    if (presentation !== "sheet") return;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.lastY - drag.startY > 80) onClose();
  };

  // Escape key closes (sheet/modal only).
  useEffect(() => {
    if (presentation === "inline") return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation, onClose]);

  // Pick-button keyboard shortcuts inside the dialog.
  const onContainerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (locked) return;
      const k = e.key.toLowerCase();
      if (k === "1" || k === "h") {
        e.preventDefault();
        setOutcome("home_win");
      } else if (k === "2" || (k === "d" && !noDraw)) {
        if (!noDraw) {
          e.preventDefault();
          setOutcome("draw");
        }
      } else if (k === "3" || k === "a" || (k === "2" && noDraw)) {
        e.preventDefault();
        setOutcome("away_win");
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const cur = outcome ?? outcomes[0]!;
        const idx = outcomes.indexOf(cur);
        const next =
          e.key === "ArrowLeft"
            ? outcomes[Math.max(0, idx - 1)]!
            : outcomes[Math.min(outcomes.length - 1, idx + 1)]!;
        e.preventDefault();
        setOutcome(next);
      }
    },
    [locked, noDraw, outcome, outcomes],
  );

  const accent: CSSProperties = {
    "--mpp-home-accent": homeTeam.kit?.primary ?? "#fbbf24",
    "--mpp-away-accent": awayTeam.kit?.primary ?? "#3b82f6",
  } as CSSProperties;

  const isHome = outcome === "home_win";
  const isDraw = outcome === "draw";
  const isAway = outcome === "away_win";

  const onSave = async () => {
    if (!outcome) return;
    try {
      const saved = await hook.save({
        outcome,
        homeScore,
        awayScore,
        oddsAtLock: snapshotOdds(odds),
      });
      onSaved?.(saved);
      if (presentation !== "inline") onClose();
    } catch {
      // useMatchPick has already surfaced the error; nothing to do here.
    }
  };

  const onRemove = async () => {
    await hook.remove();
    setOutcome(null);
    setHomeScore(undefined);
    setAwayScore(undefined);
  };

  const titleId = `mpp-title-${matchId}`;
  const isOverlay = presentation === "sheet" || presentation === "modal";

  const content = (
    <div
      className={`mpp-card mpp-card-${presentation} ${matchStarted ? "is-locked" : ""}`}
      style={accent}
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay ? true : undefined}
      aria-labelledby={titleId}
      data-match-id={matchId}
      onKeyDown={onContainerKeyDown}
      tabIndex={-1}
    >
      <header
        className="mpp-header"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {presentation === "sheet" && (
          <span className="mpp-grabber" aria-hidden="true" />
        )}
        <div className="mpp-header-text">
          <h2 id={titleId} className="mpp-title">
            <span>{homeTeam.name}</span>
            <span className="mpp-vs" aria-hidden="true">
              vs
            </span>
            <span>{awayTeam.name}</span>
          </h2>
          <p className="mpp-subtitle">
            <time dateTime={kickoffIso ?? undefined}>{fmtKickoff(kickoffIso)}</time>
            {venue && (
              <>
                <span className="mpp-sep" aria-hidden="true">
                  •
                </span>
                <span className="mpp-venue">{venue}</span>
              </>
            )}
          </p>
        </div>
        {presentation !== "inline" && (
          <button
            type="button"
            className="mpp-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </header>

      {matchStarted && (
        <div className="mpp-locked-banner" role="status" aria-live="polite">
          Sorry, this match has already started. You can&apos;t change it now.
        </div>
      )}

      <div className="mpp-picks" role="group" aria-label="Pick outcome">
        <button
          type="button"
          className={`mpp-pick mpp-pick-home ${isHome ? "is-selected" : ""} ${outcome && !isHome ? "is-dim" : ""}`}
          aria-pressed={isHome}
          aria-label={`${homeTeam.name} to win`}
          onClick={() => setOutcome("home_win")}
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
            dim={!!outcome && !isHome}
          />
          <span className="mpp-pick-code">{homeTeam.id}</span>
          <span className="mpp-pick-pct" data-outcome="home_win">
            {pctLabel(odds?.homeWin)}
          </span>
        </button>

        {!noDraw && (
          <button
            type="button"
            className={`mpp-pick mpp-pick-draw ${isDraw ? "is-selected" : ""} ${outcome && !isDraw ? "is-dim" : ""}`}
            aria-pressed={isDraw}
            aria-label="Draw"
            onClick={() => setOutcome("draw")}
            disabled={locked}
          >
            <span className="mpp-pick-draw-pill">DRAW</span>
            <span className="mpp-pick-pct" data-outcome="draw">
              {pctLabel(odds?.draw)}
            </span>
          </button>
        )}

        <button
          type="button"
          className={`mpp-pick mpp-pick-away ${isAway ? "is-selected" : ""} ${outcome && !isAway ? "is-dim" : ""}`}
          aria-pressed={isAway}
          aria-label={`${awayTeam.name} to win`}
          onClick={() => setOutcome("away_win")}
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
            dim={!!outcome && !isAway}
          />
          <span className="mpp-pick-code">{awayTeam.id}</span>
          <span className="mpp-pick-pct" data-outcome="away_win">
            {pctLabel(odds?.awayWin)}
          </span>
        </button>
      </div>

      {odds && (
        <button
          type="button"
          className={`mpp-odds-chip ${oddsExpanded ? "is-expanded" : ""}`}
          aria-expanded={oddsExpanded}
          onClick={() => setOddsExpanded((v) => !v)}
        >
          <span className="mpp-odds-source">{odds.source}</span>
          <span className="mpp-odds-summary">
            {pctLabel(odds.homeWin)} / {pctLabel(odds.draw)} / {pctLabel(odds.awayWin)}
          </span>
        </button>
      )}
      {odds && oddsExpanded && (
        <div className="mpp-odds-detail" role="region" aria-label="Live odds detail">
          <p>
            Source: <strong>{odds.source}</strong>
          </p>
          <p>
            Captured at: <time dateTime={odds.updatedAt}>{odds.updatedAt}</time>
          </p>
          <p className="mpp-odds-detail-note">
            Saving now snapshots these odds with your pick so the multiplier
            uses the implied probability at the moment you saved. You can
            still change the pick until the match kicks off.
          </p>
        </div>
      )}

      {outcome && (
        <div className="mpp-scores-wrap">
          <button
            type="button"
            className="mpp-scores-toggle"
            aria-expanded={showScores}
            onClick={() => setShowScores((v) => !v)}
            disabled={locked}
          >
            {showScores ? "Hide exact score" : "Add exact score"}
          </button>
          {showScores && (
            <div className="mpp-scores">
              <label className="mpp-score-input">
                <span className="mpp-score-label">{homeTeam.id}</span>
                <input
                  type="number"
                  min={0}
                  max={9}
                  step={1}
                  value={homeScore ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value);
                    setHomeScore(Number.isFinite(v as number) ? (v as number) : undefined);
                  }}
                  aria-label={`${homeTeam.name} score`}
                  disabled={locked}
                />
              </label>
              <span aria-hidden="true">–</span>
              <label className="mpp-score-input">
                <span className="mpp-score-label">{awayTeam.id}</span>
                <input
                  type="number"
                  min={0}
                  max={9}
                  step={1}
                  value={awayScore ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Number(e.target.value);
                    setAwayScore(Number.isFinite(v as number) ? (v as number) : undefined);
                  }}
                  aria-label={`${awayTeam.name} score`}
                  disabled={locked}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {hook.error && (
        <div className="mpp-error" role="alert">
          {hook.error.code === "match_already_started"
            ? "Sorry, this match has already started. You can't change it now."
            : hook.error.code === "outcome_not_allowed_for_stage"
              ? "Knockout matches can't end in a draw. Pick a winner."
              : hook.error.code === "rate_limited"
                ? "Slow down, too many edits. Try again in a moment."
                : "Couldn't save just yet. Your pick was kept locally, try again in a sec."}
        </div>
      )}

      <footer className="mpp-actions">
        {hook.pick && (
          <button
            type="button"
            className="mpp-btn mpp-btn-ghost"
            onClick={onRemove}
            disabled={locked || hook.isSaving}
          >
            Remove pick
          </button>
        )}
        {presentation !== "inline" && (
          <button
            type="button"
            className="mpp-btn mpp-btn-cancel"
            onClick={onClose}
            disabled={hook.isSaving}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="mpp-btn mpp-btn-primary"
          onClick={onSave}
          disabled={!outcome || locked || hook.isSaving}
        >
          {hook.isSaving ? "Saving…" : hook.pick ? "Update pick" : "Save pick"}
        </button>
      </footer>
    </div>
  );

  if (presentation === "inline") {
    return content;
  }

  // Sheet / modal: backdrop click closes; the inner card does not propagate.
  return (
    <div
      className={`mpp-overlay mpp-overlay-${presentation}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="mpp-overlay"
    >
      <div
        className="mpp-overlay-inner"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
    </div>
  );
}
