/**
 * /world-cup-2026/calendar, linear list of all 104 World Cup 2026 matches.
 *
 * Tim 2026-06-06: a flat chronological calendar — match #1 through #104 —
 * sitting under the "More" desktop menu and the drawer's "App" section.
 * Group stages render with real flags (we know who's playing); knockout
 * rounds show TBD vs TBD until the cascade resolves them on the bracket
 * page. Tapping a row opens the existing MatchOverlay (which already
 * handles all the per-match detail). Tapping a team flag opens the
 * TeamOverlay. Single column on both mobile and desktop.
 */

import type { Metadata } from "next";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { AppShell } from "@/components/shell";
import { BracketOverlayShell } from "@/components/overlay/BracketOverlayShell";
import { OverlayServerShim } from "@/components/overlay/OverlayServerShim";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

import { CalendarList } from "./CalendarList";
import { buildCalendarRows } from "./build-rows";

import "./calendar.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Match calendar · FIFA World Cup 2026 · Tournamental",
  description:
    "Every one of the 104 matches at the 2026 FIFA World Cup, listed in order. Group stages with confirmed teams, knockouts as TBD until the bracket resolves. Kickoff times, stadiums, and the full schedule.",
};

interface CalendarPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CalendarPage(props: CalendarPageProps) {
  const searchParams = await props.searchParams;
  const baseTournament = loadFixtures2026();
  const tournament = enrichTournamentTeams(
    baseTournament,
    canonicalTeamsRaw as CanonicalTeamsFile,
  );
  const rows = buildCalendarRows(tournament);

  return (
    <AppShell title="Match Calendar">
      <BracketOverlayShell pageLabel="Match Calendar" pageHref="/world-cup-2026/calendar">
        <main className="vt-calendar-page">
          <header className="vt-calendar-header">
            <p className="vt-calendar-eyebrow">FIFA World Cup 2026</p>
            <h1 className="vt-calendar-title">Match calendar</h1>
            <p className="vt-calendar-lede">
              All 104 matches in order, from Match #1 (Mexico vs the
              Group A opener) to the final on 19 July. Group stages
              show the confirmed teams; knockouts show TBD vs TBD until
              the bracket cascade resolves them on the predict page.
            </p>
          </header>
          <CalendarList rows={rows} />
          <OverlayServerShim searchParams={searchParams} />
        </main>
      </BracketOverlayShell>
    </AppShell>
  );
}
