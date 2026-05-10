/**
 * The first 12 matches of the tournament — group-stage matchday 1.
 *
 * Visual: TVNZ FIFA-app inspired flag-bg card. Each match cell is split
 * left/right by the two countries' flag SVGs as backgrounds with a soft
 * dark gradient over the top, plus a centred "vs" badge, plus a small
 * "UPCOMING" pill top-left. Below the flag band sit the date/time, team
 * names, group/venue, and an "Add to calendar" button.
 *
 * The wrapping element keeps `.wc-match` + `data-testid=wc-upcoming-matches`
 * so the existing e2e selectors continue to find the 12 cards.
 */

"use client";

import { useMemo } from "react";

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
    `DESCRIPTION:Group stage match #${match.match_number}. Save your bracket at https://2026wc.vtourn.com/world-cup-2026`,
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

function groupLetterFor(stage: string): string {
  // stage strings look like `group_a`, `group_b` etc.
  const parts = stage.split("_");
  const tail = parts[parts.length - 1] ?? "";
  return tail.toUpperCase();
}

export function UpcomingMatches() {
  const matches = useMemo(() => upcomingMatches(12), []);

  return (
    <div className="wc-matches" data-testid="wc-upcoming-matches">
      {matches.map((m) => {
        const date = new Date(m.kickoff_utc);
        const groupLetter = groupLetterFor(m.stage);
        const homeBg = { backgroundImage: `url("/flags/${m.home.code}.svg")` };
        const awayBg = { backgroundImage: `url("/flags/${m.away.code}.svg")` };
        return (
          <article className="wc-match" key={m.match_number}>
            <div className="wc-match-flagband">
              <div
                className="wc-match-half"
                data-side="home"
                style={homeBg}
                aria-hidden="true"
              >
                <span className="wc-match-half-grad" aria-hidden="true" />
                <span className="wc-match-half-code" data-side="home">
                  {m.home.short_name ?? m.home.code}
                </span>
              </div>
              <div
                className="wc-match-half"
                data-side="away"
                style={awayBg}
                aria-hidden="true"
              >
                <span className="wc-match-half-grad" aria-hidden="true" />
                <span className="wc-match-half-code" data-side="away">
                  {m.away.short_name ?? m.away.code}
                </span>
              </div>
              <span className="wc-match-pill" data-state="pre">UPCOMING</span>
              <span className="wc-match-vs-badge" aria-hidden="true">vs</span>
            </div>
            <div className="wc-match-body">
              <div className="wc-match-body-meta">
                <span className="wc-match-date" suppressHydrationWarning>
                  {date.toLocaleDateString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                  {" • "}
                  <span suppressHydrationWarning>
                    {date.toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
                <span className="wc-match-teams-line">
                  {m.home.name} <span className="wc-match-vs">v</span>{" "}
                  {m.away.name}
                </span>
                {groupLetter ? (
                  <span className="wc-match-group">Group {groupLetter}</span>
                ) : null}
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
          </article>
        );
      })}
    </div>
  );
}
