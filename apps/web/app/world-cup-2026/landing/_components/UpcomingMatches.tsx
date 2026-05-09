/**
 * The first 12 matches of the tournament — group-stage matchday 1.
 * Renders home + away flags, kickoff time in the visitor's local timezone
 * (formatted client-side), and an "Add to calendar" button that builds an
 * .ics file inline.
 */

"use client";

import { useMemo } from "react";

import { TeamFlag } from "@/components/bracket/TeamFlag";
import { upcomingMatches, type UpcomingMatch } from "../_lib/groups";

function buildIcs(match: UpcomingMatch): string {
  const start = new Date(match.kickoff_utc);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2hr slot
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VTourn//WC2026//EN",
    "BEGIN:VEVENT",
    `UID:vtourn-wc2026-${match.match_number}@vtourn.com`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${match.home.name} vs ${match.away.name} — FIFA WC 2026`,
    `DESCRIPTION:Group stage match #${match.match_number}. Lock your bracket at https://2026wc.vtourn.com/world-cup-2026`,
    `LOCATION:${match.host_city_id.replaceAll("_", " ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadIcs(match: UpcomingMatch): void {
  const ics = buildIcs(match);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wc2026-match-${match.match_number}-${match.home.code}-${match.away.code}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function UpcomingMatches() {
  const matches = useMemo(() => upcomingMatches(12), []);

  return (
    <div className="wc-matches" data-testid="wc-upcoming-matches">
      {matches.map((m) => {
        const date = new Date(m.kickoff_utc);
        return (
          <div className="wc-match" key={m.match_number}>
            <div>
              <div className="wc-match-teams">
                <TeamFlag
                  code={m.home.code}
                  name={m.home.name}
                  accentColor={m.home.kit.primary}
                  size="md"
                />
                <strong>{m.home.short_name}</strong>
                <span className="wc-match-vs">vs</span>
                <TeamFlag
                  code={m.away.code}
                  name={m.away.name}
                  accentColor={m.away.kit.primary}
                  size="md"
                />
                <strong>{m.away.short_name}</strong>
              </div>
              <button
                type="button"
                className="wc-ics"
                onClick={() => downloadIcs(m)}
                aria-label={`Add ${m.home.name} vs ${m.away.name} to calendar`}
              >
                + Add to calendar
              </button>
            </div>
            <div className="wc-match-time">
              <span suppressHydrationWarning>
                {date.toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <br />
              <span suppressHydrationWarning>
                {date.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
