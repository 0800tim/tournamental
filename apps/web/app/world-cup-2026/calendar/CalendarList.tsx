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

import type { MouseEvent } from "react";

import { useOverlay } from "@/components/overlay/OverlayProvider";
import { canonicalTeam } from "@/app/match/[id]/preview/_lib/match-data";
import { venueInfo, hostFlag } from "@/lib/venues";

import type { CalendarRow, CalendarSide } from "./build-rows";

interface CalendarListProps {
  readonly rows: readonly CalendarRow[];
}

export function CalendarList({ rows }: CalendarListProps) {
  const overlay = useOverlay();

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

  // Group rows by calendar day (in venue local time) so the list gets
  // day headers — keeps the scroll legible across 104 entries.
  const groups: { dayKey: string; dayLabel: string; rows: CalendarRow[] }[] = [];
  for (const row of rows) {
    const v = venueInfo(row.venue);
    const tz = v?.timezone ?? "UTC";
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

  return (
    <li className="vt-cal-row" data-stage={row.stage}>
      <button
        type="button"
        className="vt-cal-row-button"
        onClick={onOpenMatch(row.matchId)}
        aria-label={`Match ${row.matchNo}: ${describeRowForA11y(row)}. Open match details.`}
      >
        <header className="vt-cal-row-header">
          <span className="vt-cal-row-badge" data-stage={row.stage}>
            {row.stageBadge}
          </span>
          <span className="vt-cal-row-no">Match {row.matchNo}</span>
        </header>

        <div className="vt-cal-row-teams">
          <SideBox side={row.home} onOpenTeam={onOpenTeam} />
          <span className="vt-cal-vs" aria-hidden="true">VS</span>
          <SideBox side={row.away} onOpenTeam={onOpenTeam} />
        </div>

        <footer className="vt-cal-row-footer">
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
        </footer>
      </button>
    </li>
  );
}

interface SideBoxProps {
  readonly side: CalendarSide;
  readonly onOpenTeam: (code: string) => (e: MouseEvent) => void;
}

function SideBox({ side, onOpenTeam }: SideBoxProps) {
  if (!side.code) {
    return (
      <div className="vt-cal-side vt-cal-side-tbd" aria-label="To be determined">
        <span className="vt-cal-tbd-label">TBD</span>
        {side.slotLabel && (
          <span className="vt-cal-tbd-slot">{side.slotLabel}</span>
        )}
      </div>
    );
  }

  const team = canonicalTeam(side.code);
  const name = team?.name ?? side.code;
  const code = side.code.toUpperCase();
  const flagUrl = `/flags/${code}.svg`;
  const accent = team?.kit?.primary ?? "#dca94b";

  return (
    <span
      className="vt-cal-side vt-cal-side-team"
      style={
        {
          backgroundImage: `url(${flagUrl})`,
          "--vt-cal-accent": accent,
        } as React.CSSProperties
      }
      data-team-code={code}
    >
      <span className="vt-cal-side-scrim" aria-hidden="true" />
      <button
        type="button"
        className="vt-cal-team-button"
        onClick={onOpenTeam(code)}
        aria-label={`Open ${name} team details`}
      >
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
      </button>
    </span>
  );
}

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
