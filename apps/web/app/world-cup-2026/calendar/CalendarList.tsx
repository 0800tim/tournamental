/**
 * CalendarList, client component that renders the linear match list.
 *
 * Each row is a button that opens the existing MatchOverlay via the
 * overlay router (so the calendar surface reuses every piece of match
 * detail that already exists on the bracket page). Team flags themselves
 * are nested buttons that open the TeamOverlay so users can tap a
 * country directly without going through the match popup first.
 *
 * Visual contract: the row is a horizontal three-column layout — home
 * box, "VS" divider, away box. Each team box has the team flag as a
 * full-bleed blurred background, a circular highlight flag in the
 * centre, and the team name below. Group rows show real flags; knockout
 * rows show a darkened "TBD" panel with the slot descriptor. Below the
 * boxes sits the time + venue strip (kickoff local + your local + city).
 */

"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

import { useOverlay } from "@/components/overlay/OverlayProvider";
import { canonicalTeam } from "@/app/match/[id]/preview/_lib/match-data";
import { venueInfo, hostFlag } from "@/lib/venues";

import type { CalendarRow, CalendarSide } from "./build-rows";
import { useCalendarPicks, type Outcome } from "./CalendarPicksContext";
import type { ResultedMatch } from "./types";

interface CalendarListProps {
  readonly rows: readonly CalendarRow[];
}

export function CalendarList({ rows }: CalendarListProps) {
  const overlay = useOverlay();
  const picks = useCalendarPicks();

  const openMatch = (id: string) => (e: MouseEvent): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    overlay.open("match", { id });
  };
  const openTeam = (code: string) => (e: MouseEvent): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    overlay.open("team", { code });
  };

  // Tim 2026-06-16 iter#6 — simplified per Tim's feedback. Forget
  // ESPN live-status and userTz gating; just compare each row's
  // kickoff_utc to the device clock and scroll to the first match
  // whose kickoff is still in the future. Runs once on mount with
  // a 500ms layout-settling delay; ref guard prevents re-fire on
  // unrelated state changes. Anchors on the day-header for first-
  // of-day so the date label sits at the top of the viewport.
  // Idempotency guard lives INSIDE the timer callback, not before it.
  // React 18 strict mode (active under `next dev`) mounts every
  // component twice: the first mount's cleanup cancels its setTimeout,
  // and if the ref is flipped before scheduling, the second mount
  // early-returns and nothing ever fires. Letting the second mount
  // schedule its own timer (and gating the actual scroll on the ref)
  // works in both dev and prod.
  const didAutoScrollRef = useRef(false);
  useEffect(() => {
    if (didAutoScrollRef.current) return;
    if (typeof history !== "undefined" && "scrollRestoration" in history) {
      try {
        history.scrollRestoration = "manual";
      } catch {
        /* some embedded contexts forbid this; ignore */
      }
    }
    const timer = window.setTimeout(() => {
      if (didAutoScrollRef.current) return;
      didAutoScrollRef.current = true;
      const now = Date.now();
      const els = Array.from(
        document.querySelectorAll<HTMLElement>("[data-kickoff-utc]"),
      );
      if (els.length === 0) return;
      let target: HTMLElement | null = null;
      for (const el of els) {
        const ko = Date.parse(el.dataset.kickoffUtc ?? "");
        if (Number.isFinite(ko) && ko > now) {
          target = el;
          break;
        }
      }
      if (!target) target = els[els.length - 1] ?? null;
      if (!target) return;
      const daySection = target.closest(
        "li.vt-calendar-day",
      ) as HTMLElement | null;
      const dayRowsList = target.parentElement;
      const isFirstOfDay =
        !!dayRowsList && dayRowsList.firstElementChild === target;
      const anchor = isFirstOfDay && daySection ? daySection : target;
      anchor.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 500);
    return () => window.clearTimeout(timer);
  }, []);

  // Group rows by calendar day in the viewer's own timezone so the day
  // headers match the per-row "your time" (a 13:00 GMT-6 kickoff is the
  // 12th, not the 11th, for a GMT+12 viewer). Resolving the browser tz
  // only happens after mount; SSR and the first client paint fall back to
  // the venue tz so the grouped DOM structure matches and React doesn't
  // throw a hydration mismatch. After mount we re-group in local time.
  const [userTz, setUserTz] = useState<string | null>(null);
  useEffect(() => {
    try {
      setUserTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // Keep the venue-tz fallback if the runtime can't resolve a tz.
    }
  }, []);

  const groups: { dayKey: string; dayLabel: string; rows: CalendarRow[] }[] = [];
  for (const row of rows) {
    const v = venueInfo(row.venue);
    const tz = userTz ?? v?.timezone ?? "UTC";
    const dayKey = dayKeyInTz(row.kickoffUtc, tz);
    const dayLabel = dayLabelInTz(row.kickoffUtc, tz);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.rows.push(row);
    } else {
      groups.push({ dayKey, dayLabel, rows: [row] });
    }
  }

  return (
    <ol className="vt-calendar-list">
      {groups.map((g) => (
        <li key={g.dayKey} className="vt-calendar-day">
          <header className="vt-calendar-day-header">
            <span className="vt-calendar-day-label">{g.dayLabel}</span>
            <span className="vt-calendar-day-count">
              {g.rows.length} {g.rows.length === 1 ? "match" : "matches"}
            </span>
          </header>
          <ol className="vt-calendar-day-rows">
            {g.rows.map((row) => (
              <CalendarRowItem
                key={row.matchId}
                row={row}
                onOpenMatch={openMatch}
                onOpenTeam={openTeam}
              />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

interface RowItemProps {
  readonly row: CalendarRow;
  readonly onOpenMatch: (id: string) => (e: MouseEvent) => void;
  readonly onOpenTeam: (code: string) => (e: MouseEvent) => void;
}

function CalendarRowItem({ row, onOpenMatch, onOpenTeam }: RowItemProps) {
  const v = venueInfo(row.venue);
  const tz = v?.timezone ?? "UTC";
  const localTime = formatTimeInTz(row.kickoffUtc, tz);
  const yourTime = formatTimeLocal(row.kickoffUtc);

  // Tim 2026-06-12: per-row pick + result state. For knockouts the
  // cascade may have resolved team codes the static row doesn't
  // carry, so prefer the cascade map when it's populated.
  const picks = useCalendarPicks();
  const cascaded = picks.cascadeCodes.get(row.matchId);
  const homeCode = cascaded?.home ?? row.home.code;
  const awayCode = cascaded?.away ?? row.away.code;
  const result = picks.resultsByMatch.get(row.matchId) ?? null;
  // Lock once kickoff has passed. nowMs is 0 on SSR / pre-mount so
  // every row renders as "future" first paint (no SSR/client clock
  // mismatch); after mount the provider's interval updates the clock
  // and the lock / live / past state takes effect.
  const isLocked = picks.nowMs > 0 && picks.nowMs >= Date.parse(row.kickoffUtc);
  // Live status from ESPN (polled every 60s). Present only when the
  // match is actually on the pitch right now. Wins over the static
  // 'LOCKED' chip so viewers see the score + clock instead.
  const live = picks.liveByMatch.get(row.matchId) ?? null;
  // Score to render inside each flag tile: prefer FT result, fall
  // back to live score, hide if neither. Tim 2026-06-13.
  const homeScoreShown = result?.homeScore ?? (live ? live.homeScore : null);
  const awayScoreShown = result?.awayScore ?? (live ? live.awayScore : null);
  const isGroup = row.stage === "group";
  const stageKey = row.stage as "group" | "r32" | "r16" | "qf" | "sf" | "tp" | "f";

  // Current pick on this match (group / knockout map).
  const pick = (
    isGroup
      ? picks.bracket.matchPredictions?.[row.matchId]
      : picks.bracket.knockoutPredictions?.[row.matchId]
  ) as { outcome?: Outcome } | undefined;
  const picked = pick?.outcome ?? null;

  // Pick targets are disabled until hydration + tournament cascade
  // (for knockouts where teams haven't resolved), and after kickoff.
  const teamsResolved = !!homeCode && !!awayCode;
  const canPick = picks.hydrated && !isLocked && teamsResolved;

  function pickOutcome(outcome: Outcome) {
    return (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!canPick) return;
      picks.setPick({ matchId: row.matchId, outcome, stage: stageKey });
    };
  }

  return (
    <li
      className="vt-cal-row"
      data-stage={row.stage}
      data-locked={isLocked ? "true" : "false"}
      data-match-id={row.matchId}
      data-kickoff-utc={row.kickoffUtc}
    >
      <header className="vt-cal-row-header">
        <span className="vt-cal-row-badge" data-stage={row.stage}>
          {row.stageBadge}
        </span>
        <span className="vt-cal-row-no">Match {row.matchNo}</span>
        {result ? (
          <span className="vt-cal-status-pill" data-state="ft">FT</span>
        ) : live ? (
          <span className="vt-cal-status-pill" data-state="live">
            <span className="vt-cal-status-dot" aria-hidden="true" />
            <span className="vt-cal-status-label">LIVE</span>
            <span className="vt-cal-status-score">
              {live.homeScore}-{live.awayScore}
            </span>
            <span className="vt-cal-status-clock">{live.clock}</span>
          </span>
        ) : isLocked ? (
          <span className="vt-cal-status-pill" data-state="locked">LOCKED</span>
        ) : null}
      </header>

      <div className="vt-cal-row-teams" role="group" aria-label={describeRowForA11y(row)}>
        <PickableSide
          side={row.home}
          resolvedCode={homeCode}
          isSelected={picked === "home_win"}
          isPickable={canPick}
          onPick={pickOutcome("home_win")}
          onOpenTeam={onOpenTeam}
          score={homeScoreShown}
          verdict={picked && result ? verdictFor(picked, "home_win", result.outcome) : null}
        />

        {isGroup ? (
          <DrawPick
            isSelected={picked === "draw"}
            isPickable={canPick}
            onPick={pickOutcome("draw")}
            verdict={picked && result ? verdictFor(picked, "draw", result.outcome) : null}
          />
        ) : (
          <span className="vt-cal-vs" aria-hidden="true">VS</span>
        )}

        <PickableSide
          side={row.away}
          resolvedCode={awayCode}
          isSelected={picked === "away_win"}
          isPickable={canPick}
          onPick={pickOutcome("away_win")}
          onOpenTeam={onOpenTeam}
          score={awayScoreShown}
          verdict={picked && result ? verdictFor(picked, "away_win", result.outcome) : null}
        />
      </div>

      <button
        type="button"
        className="vt-cal-row-footer-btn"
        onClick={onOpenMatch(row.matchId)}
        aria-label={`Open match details for match ${row.matchNo}`}
      >
        <div className="vt-cal-time">
          <span className="vt-cal-time-primary">{yourTime.time}</span>
          <span className="vt-cal-time-label">{yourTime.tzLabel} · your time</span>
        </div>
        <div className="vt-cal-time">
          <span className="vt-cal-time-primary">{localTime.time}</span>
          <span className="vt-cal-time-label">{localTime.tzLabel} · local kickoff</span>
        </div>
        <div className="vt-cal-venue">
          <span className="vt-cal-flag" aria-hidden="true">{hostFlag(row.host)}</span>
          <span className="vt-cal-venue-text">
            {v ? `${v.city}, ${v.country}` : row.host}
            <span className="vt-cal-venue-sep"> · </span>
            <strong>{row.venue}</strong>
          </span>
        </div>
      </button>
    </li>
  );
}

// Whether the user's pick was correct given the actual outcome, but
// only render a verdict on the SIDE the user picked (so a "MEX win"
// pick shows the verdict on the MEX flag, not on the RSA flag).
function verdictFor(
  picked: Outcome,
  side: Outcome,
  actual: ResultedMatch["outcome"],
): "correct" | "wrong" | null {
  if (picked !== side) return null;
  return picked === actual ? "correct" : "wrong";
}

interface PickableSideProps {
  readonly side: CalendarSide;
  readonly resolvedCode: string | undefined;
  readonly isSelected: boolean;
  readonly isPickable: boolean;
  readonly onPick: (e: MouseEvent) => void;
  readonly onOpenTeam: (code: string) => (e: MouseEvent) => void;
  readonly score: number | null;
  readonly verdict: "correct" | "wrong" | null;
}

function PickableSide(props: PickableSideProps) {
  const { side, resolvedCode, isSelected, isPickable, onPick, score, verdict } = props;
  // void the team-overlay handler for now — calendar-as-picker means
  // tapping a flag picks; tapping the time/venue strip opens match
  // detail. Team-detail page is reachable from anywhere else.
  void props.onOpenTeam;

  if (!resolvedCode) {
    return (
      <div className="vt-cal-side vt-cal-side-tbd" aria-label="To be determined">
        <span className="vt-cal-tbd-label">TBD</span>
        {side.slotLabel && (
          <span className="vt-cal-tbd-slot">{side.slotLabel}</span>
        )}
      </div>
    );
  }

  const team = canonicalTeam(resolvedCode);
  const name = team?.name ?? resolvedCode;
  const code = resolvedCode.toUpperCase();
  const flagUrl = `/flags/${code}.svg`;
  const accent = team?.kit?.primary ?? "#dca94b";

  return (
    <button
      type="button"
      className="vt-cal-side vt-cal-side-team"
      style={
        {
          backgroundImage: `url(${flagUrl})`,
          "--vt-cal-accent": accent,
        } as React.CSSProperties
      }
      data-team-code={code}
      data-selected={isSelected ? "true" : "false"}
      data-verdict={verdict ?? "none"}
      disabled={!isPickable}
      onClick={onPick}
      aria-pressed={isSelected}
      aria-label={`Pick ${name} to win`}
    >
      <span className="vt-cal-side-scrim" aria-hidden="true" />
      <span className="vt-cal-flag-circle">
        <img
          src={flagUrl}
          alt=""
          width={56}
          height={56}
          loading="eager"
          decoding="async"
        />
      </span>
      <span className="vt-cal-side-name">{name}</span>
      <span className="vt-cal-side-code">{code}</span>
      {score !== null ? (
        <span className="vt-cal-side-score" aria-label={`${code} score`}>
          {score}
        </span>
      ) : null}
      {verdict ? (
        <span
          className="vt-cal-side-verdict"
          data-verdict={verdict}
          aria-label={verdict === "correct" ? "Pick was correct" : "Pick was incorrect"}
        >
          {verdict === "correct" ? "✓" : "✕"}
        </span>
      ) : null}
    </button>
  );
}

interface DrawPickProps {
  readonly isSelected: boolean;
  readonly isPickable: boolean;
  readonly onPick: (e: MouseEvent) => void;
  readonly verdict: "correct" | "wrong" | null;
}

function DrawPick({ isSelected, isPickable, onPick, verdict }: DrawPickProps) {
  return (
    <button
      type="button"
      className="vt-cal-draw"
      data-selected={isSelected ? "true" : "false"}
      data-verdict={verdict ?? "none"}
      disabled={!isPickable}
      onClick={onPick}
      aria-pressed={isSelected}
      aria-label="Pick draw"
    >
      <span className="vt-cal-draw-label">DRAW</span>
      {verdict ? (
        <span className="vt-cal-side-verdict" data-verdict={verdict} aria-hidden="true">
          {verdict === "correct" ? "✓" : "✕"}
        </span>
      ) : null}
    </button>
  );
}

// SideBox removed 2026-06-12: PickableSide (above) replaces it. The
// original SideBox rendered a static flag tile with a nested
// "open team details" button; the calendar now uses flags directly
// as pick targets, matching the bracket page's tap-the-flag pattern.

// ---------- date / time helpers ----------

function describeRowForA11y(row: CalendarRow): string {
  const h = row.home.code ? canonicalTeam(row.home.code)?.name ?? row.home.code : "TBD";
  const a = row.away.code ? canonicalTeam(row.away.code)?.name ?? row.away.code : "TBD";
  return `${h} vs ${a}, ${row.stageLabel}`;
}

function dayKeyInTz(iso: string, tz: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function dayLabelInTz(iso: string, tz: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-NZ", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

interface FormattedTime {
  readonly time: string;
  readonly tzLabel: string;
}

function formatTimeInTz(iso: string, tz: string): FormattedTime {
  const d = new Date(iso);
  let time = "";
  let tzLabel = "";
  try {
    time = new Intl.DateTimeFormat("en-NZ", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(d);
  } catch {
    time = d.toISOString().slice(11, 16);
  }
  try {
    const parts = new Intl.DateTimeFormat("en-NZ", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(d);
    tzLabel = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    tzLabel = "UTC";
  }
  return { time, tzLabel };
}

function formatTimeLocal(iso: string): FormattedTime {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZoneName: "short",
  }).formatToParts(d);
  const tzLabel = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return { time, tzLabel };
}
