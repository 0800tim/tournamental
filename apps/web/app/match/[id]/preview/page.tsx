/**
 * /match/[id]/preview — pre-match preview page.
 *
 * FotMob-inspired five-tab match detail (Predict / H2H / Form / Lineup /
 * Stats) sitting above a kit-coloured hero strip with both team flags.
 * The 3D renderer lives at /match/[id]; this is the pre-match enrichment
 * surface (per docs/36-vtourn-ux-spec.md §B).
 *
 * Server component: looks up the match in the canonical tournament fixture
 * tree (`@vtorn/bracket-engine.loadFixtures2026`), enriches teams with kit
 * colours, and renders:
 *   - hero (kit gradient + two xl circular flags + scoreline placeholder
 *     or "Kicks off in N hours" countdown + group/round label + venue);
 *   - the five-tab content area, owned by the client `MatchPreviewTabs`.
 *
 * Tabs persist in the URL hash (#predict, #h2h, #form, #lineup, #stats)
 * for shareability. Default tab is #predict.
 *
 * Cache policy: marketing-flavoured, identical for every visitor →
 * `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`. Per
 * docs/22-deployment-and-tunnels.md the pre-match window is staleness-
 * tolerant (we update once a minute).
 *
 * TODO(live-data):
 *   - replace the H2H, Form, Lineup, Stats stub data in
 *     `apps/web/data/{head-to-head,team-formations,team-stats}.json`.
 *   - wire the Predict tab's odds chip to `/api/odds/snapshot` for the
 *     specific match on first paint (currently the `MatchPredictionRow`
 *     fetches via the parent BracketBuilder; here we ship a single-match
 *     fetch instead to avoid loading the full tournament's odds).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

import { TeamFlag } from "@/components/bracket/TeamFlag";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

import { MatchPreviewTabs } from "./_components/MatchPreviewTabs";
import {
  canonicalTeam,
  expectedScoreline,
  headToHead,
  lineupFor,
  resolveMatch,
  statsFor,
} from "./_lib/match-data";
import { recentForm } from "../../../team/[code]/_lib/team-data";
import "./match-preview.css";

export const dynamic = "force-static";

interface MatchPreviewPageProps {
  params: { id: string };
}

export function generateMetadata({ params }: MatchPreviewPageProps): Metadata {
  const tournament = enrichTournamentTeams(
    loadFixtures2026(),
    canonicalTeamsRaw as CanonicalTeamsFile,
  );
  const match = resolveMatch(tournament, params.id);
  if (!match) {
    return { title: "Match not found - VTourn" };
  }
  const home =
    match.homeCode && (canonicalTeam(match.homeCode)?.name ?? match.homeCode);
  const away =
    match.awayCode && (canonicalTeam(match.awayCode)?.name ?? match.awayCode);
  const title =
    home && away
      ? `${home} vs ${away} - ${match.stageLabel} | VTourn`
      : `${match.stageLabel} - VTourn match preview`;
  const description = home && away
    ? `Predict ${home} vs ${away} - head-to-head, form, predicted XI and pre-match stats. Make your pick on VTourn.`
    : `${match.stageLabel} preview on VTourn.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

export default function MatchPreviewPage({ params }: MatchPreviewPageProps) {
  const baseTournament = loadFixtures2026();
  const tournament = enrichTournamentTeams(
    baseTournament,
    canonicalTeamsRaw as CanonicalTeamsFile,
  );

  const match = resolveMatch(tournament, params.id);
  if (!match) notFound();

  const home = match.homeCode ? canonicalTeam(match.homeCode) : undefined;
  const away = match.awayCode ? canonicalTeam(match.awayCode) : undefined;

  const homePrimary = home?.kit?.primary ?? "#fbbf24";
  const homeSecondary = home?.kit?.secondary ?? "#0f172a";
  const awayPrimary = away?.kit?.primary ?? "#3b82f6";
  const awaySecondary = away?.kit?.secondary ?? "#0f172a";

  // Pre-compute everything the tabs need on the server so the client
  // bundle stays tiny (the tabs themselves are pure presentation).
  const h2h =
    match.homeCode && match.awayCode
      ? headToHead(match.homeCode, match.awayCode)
      : null;
  const homeForm = match.homeCode ? [...recentForm(match.homeCode)] : [];
  const awayForm = match.awayCode ? [...recentForm(match.awayCode)] : [];
  const homeLineup = match.homeCode ? lineupFor(match.homeCode) : null;
  const awayLineup = match.awayCode ? lineupFor(match.awayCode) : null;
  const homeStats = match.homeCode ? statsFor(match.homeCode) : null;
  const awayStats = match.awayCode ? statsFor(match.awayCode) : null;
  const expected =
    match.homeCode && match.awayCode
      ? expectedScoreline(match.homeCode, match.awayCode)
      : null;

  // Bracket-engine team objects for the Predict tab's MatchPredictionRow
  // (which expects engine `Team`s with `kit.primary` etc.).
  const teamMap = new Map(tournament.teams.map((t) => [t.id, t]));
  const homeEngine = match.homeCode ? teamMap.get(match.homeCode) ?? null : null;
  const awayEngine = match.awayCode ? teamMap.get(match.awayCode) ?? null : null;

  const heroStyle = {
    "--mp-home-primary": homePrimary,
    "--mp-home-secondary": homeSecondary,
    "--mp-away-primary": awayPrimary,
    "--mp-away-secondary": awaySecondary,
  } as React.CSSProperties;

  const kickoff = new Date(match.kickoffUtc);
  const kickoffLabel = formatKickoff(kickoff);

  return (
    <main className="mp-page" style={heroStyle}>
      <Link href="/world-cup-2026" className="mp-back" aria-label="Back to bracket">
        &larr; Bracket
      </Link>

      <header className="mp-hero">
        <div className="mp-hero-bleed" aria-hidden="true" />
        <div className="mp-hero-meta">
          <span className="mp-stage" data-testid="mp-stage-label">
            {match.stageLabel}
          </span>
          <time className="mp-kickoff" dateTime={match.kickoffUtc}>
            {kickoffLabel}
          </time>
          {match.venue && (
            <span className="mp-venue" aria-label="Venue">{match.venue}</span>
          )}
        </div>

        <div className="mp-hero-row">
          <SideHero
            code={match.homeCode}
            name={home?.name}
            slotLabel={match.homeSlotLabel}
            primary={homePrimary}
            isHome
          />
          <Centerpiece kickoff={kickoff} />
          <SideHero
            code={match.awayCode}
            name={away?.name}
            slotLabel={match.awaySlotLabel}
            primary={awayPrimary}
          />
        </div>
      </header>

      <MatchPreviewTabs
        match={match}
        homeTeam={homeEngine}
        awayTeam={awayEngine}
        homeName={home?.name ?? match.homeCode ?? ""}
        awayName={away?.name ?? match.awayCode ?? ""}
        homeForm={homeForm}
        awayForm={awayForm}
        h2h={h2h}
        homeLineup={homeLineup}
        awayLineup={awayLineup}
        homeStats={homeStats}
        awayStats={awayStats}
        expected={expected}
      />

      <footer className="mp-footer">
        <Link href="/world-cup-2026" className="mp-footer-link">
          &larr; Back to the bracket
        </Link>
      </footer>
    </main>
  );
}

interface SideHeroProps {
  readonly code?: string;
  readonly name?: string;
  readonly slotLabel?: string;
  readonly primary: string;
  readonly isHome?: boolean;
}

function SideHero({ code, name, slotLabel, primary, isHome }: SideHeroProps) {
  return (
    <div className={`mp-side ${isHome ? "mp-side-home" : "mp-side-away"}`}>
      {code ? (
        <>
          <Link
            href={`/team/${code}`}
            className="mp-side-flag-link"
            aria-label={`Open ${name ?? code} team page`}
          >
            <span className="mp-side-flag">
              <TeamFlag
                code={code}
                name={name ?? code}
                accentColor={primary}
                size="xl"
                shape="circle"
                sparkle={false}
              />
            </span>
          </Link>
          <span className="mp-side-name">{name ?? code}</span>
          <span className="mp-side-code">{code}</span>
        </>
      ) : (
        <>
          <span className="mp-side-flag mp-side-flag-tbd" aria-hidden="true">
            ?
          </span>
          <span className="mp-side-name mp-side-tbd">TBD</span>
          {slotLabel && <span className="mp-side-slot">{slotLabel}</span>}
        </>
      )}
    </div>
  );
}

interface CenterpieceProps {
  readonly kickoff: Date;
}

function Centerpiece({ kickoff }: CenterpieceProps) {
  const nowMs = Date.now();
  const diffMs = kickoff.getTime() - nowMs;
  if (diffMs <= 0) {
    return (
      <div className="mp-centre" aria-label="Score placeholder">
        <span className="mp-score-placeholder">- vs -</span>
        <span className="mp-centre-sub">Match scheduled or in progress</span>
      </div>
    );
  }
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(hours / 24);
  let label: string;
  if (days >= 2) label = `Kicks off in ${days} days`;
  else if (hours >= 2) label = `Kicks off in ${hours} hours`;
  else label = `Kicks off soon`;
  return (
    <div className="mp-centre" aria-label="Kickoff countdown">
      <span className="mp-vs">VS</span>
      <span className="mp-centre-sub" data-testid="mp-countdown">
        {label}
      </span>
    </div>
  );
}

function formatKickoff(d: Date): string {
  return d.toLocaleString("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
