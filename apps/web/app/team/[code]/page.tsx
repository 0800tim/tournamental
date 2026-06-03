/**
 * /team/[code], team detail page for a single tournament team.
 *
 * Server component: loads the tournament + canonical-team data once at
 * build / request time, finds the team by 3-letter FIFA code, and renders:
 *   - Hero: oversized circular flag, kit-colour gradient strip, world rank
 *     chip, group letter chip, country name, manager line.
 *   - Quick-pick CTA: deep-link into the bracket pre-scrolled to the team's
 *     next fixture.
 *   - Group standing context strip (when the team is in a drawn group).
 *   - Recent form (5 W/D/L dots, stub data).
 *   - Upcoming fixture card.
 *   - Head-to-head (stub) for likely group opponents.
 *   - 23-player squad grid (stub names + jersey #).
 *
 * Cache policy: this is a marketing-flavoured surface, identical for every
 * unauthenticated visitor, `Cache-Control: public, s-maxage=300,
 * stale-while-revalidate=86400` per the standing rule in CLAUDE.md.
 *
 * Mobile-first: hero looks great at 375px width; tap targets >= 44px.
 *
 * TODO(live-data):
 *   - replace `apps/web/data/team-form.json` with live results API
 *   - replace `apps/web/data/team-squads.json` with FIFA squad-list API
 *   - swap stubbed head-to-head with a historic-meetings data source
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { TeamFlag } from "@/components/bracket/TeamFlag";
import { PlayerCard } from "@/components/player/PlayerCard";
import { AppShell } from "@/components/shell";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import { playersForTeam } from "@/lib/players";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

import "@/components/player/player.css";

import { RecentForm } from "./_components/RecentForm";
import { TeamFixturesWithPicks } from "./_components/TeamFixturesWithPicks";
import {
  bracketEngineTeam,
  canonicalTeamByCode,
  groupForTeam,
  groupOpponents,
  nextFixture,
  recentForm,
  squadForTeam,
  teamFixtures,
} from "./_lib/team-data";
import "./team-detail.css";

export const dynamic = "force-static";

// Pre-render every team's page at build. Falls back to dynamic for unknown
// codes, which then 404 via `notFound()`.
export function generateStaticParams() {
  const tournament = loadFixtures2026();
  return tournament.teams
    .filter((t) => !t.placeholder)
    .map((t) => ({ code: t.id }));
}

interface TeamPageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata(props: TeamPageProps): Promise<Metadata> {
  const params = await props.params;
  const upper = params.code.toUpperCase();
  const c = canonicalTeamByCode(upper);
  if (!c) {
    return { title: "Team not found - Tournamental" };
  }
  return {
    title: `${c.name} - Football World Cup 2026 | Tournamental`,
    description: `${c.name} squad, world rank #${c.fifa_ranking_at_2026}, recent form, and upcoming fixtures at the Football World Cup 2026. Predict their next match on Tournamental.`,
    openGraph: {
      title: `${c.name} - Football World Cup 2026`,
      description: `${c.name} squad and fixtures. Predict their bracket on Tournamental.`,
      type: "website",
    },
  };
}

export default async function TeamPage(props: TeamPageProps) {
  const params = await props.params;
  const upper = params.code.toUpperCase();
  const baseTournament = loadFixtures2026();
  const tournament = enrichTournamentTeams(
    baseTournament,
    canonicalTeamsRaw as CanonicalTeamsFile,
  );

  const canonical = canonicalTeamByCode(upper);
  const engineTeam = bracketEngineTeam(tournament, upper);
  if (!canonical || !engineTeam) {
    notFound();
  }

  const primary = canonical.kit?.primary ?? "#fbbf24";
  const secondary = canonical.kit?.secondary ?? "#1c1c22";

  const gid = groupForTeam(tournament, upper);
  const opponents = groupOpponents(tournament, upper);
  const fixtures = teamFixtures(upper);
  const upcoming = nextFixture(upper);
  const form = recentForm(upper);
  const squad = squadForTeam(upper);
  // Real player records (from `apps/web/data/players-2026.json`) take
  // priority. Falls back to the placeholder squad below when the dataset
  // doesn't yet include this team.
  const realPlayers = playersForTeam(upper);

  // Prior fixtures (already played, kickoff in past). The 2026 tournament
  // is in the future, so this will normally be empty; included so the
  // section is future-proof against running the page mid-tournament.
  const nowMs = Date.now();
  const priorFixtures = fixtures.filter(
    (f) => Date.parse(f.kickoffUtc) < nowMs,
  );
  const futureFixtures = fixtures.filter(
    (f) => Date.parse(f.kickoffUtc) >= nowMs,
  );

  // Quick-pick deep link: bracket page anchored to the team's next match
  // by match-id hash. The bracket page already accepts URL hashes for
  // anchor-scrolling; if the anchor doesn't match anything the page just
  // opens at the top.
  const quickPickHref = upcoming
    ? `/world-cup-2026#match-${upcoming.matchId}`
    : "/world-cup-2026";

  // Style hero with kit-colour gradient.
  const heroStyle = {
    "--td-primary": primary,
    "--td-secondary": secondary,
  } as React.CSSProperties;

  return (
    <AppShell title={canonical.short_name ?? canonical.name}>
    <main className="td-page" style={heroStyle}>
      <Link href="/world-cup-2026" className="td-back" aria-label="Back to bracket">
        &larr; Bracket
      </Link>

      <header className="td-hero">
        <div className="td-hero-bleed" aria-hidden="true" />
        <div className="td-hero-inner">
          <div className="td-hero-flag">
            <TeamFlag
              code={upper}
              name={canonical.name}
              accentColor={primary}
              size="xl"
              shape="circle"
              sparkle
            />
          </div>
          <div className="td-hero-title">
            <h1 className="td-hero-name">
              {canonical.flag_emoji && (
                <span aria-hidden="true" className="td-hero-emoji">
                  {canonical.flag_emoji}
                </span>
              )}
              {canonical.name}
            </h1>
            <div className="td-hero-chips">
              <span className="td-chip td-chip-rank">
                World #{canonical.fifa_ranking_at_2026}
              </span>
              {gid && (
                <span className="td-chip td-chip-group">Group {gid}</span>
              )}
              <span className="td-chip td-chip-conf">
                {canonical.confederation}
              </span>
            </div>
            {canonical.manager && (
              <p className="td-hero-meta">Manager: {canonical.manager}</p>
            )}
          </div>
        </div>

        {upcoming ? (
          <Link
            href={quickPickHref}
            className="td-cta-primary"
            data-testid="td-quick-pick"
          >
            Pick {canonical.short_name ?? upper} to win their next match
          </Link>
        ) : (
          <Link href="/world-cup-2026" className="td-cta-primary">
            Open the bracket
          </Link>
        )}
      </header>

      {gid && opponents.length > 0 && (
        <section className="td-section td-group-strip" aria-label={`Group ${gid} standing context`}>
          <h2>Group {gid}</h2>
          <ol className="td-group-list">
            <li className="td-group-row td-group-self">
              <span className="td-group-pos" aria-hidden="true">*</span>
              <TeamFlag
                code={upper}
                name={canonical.name}
                accentColor={primary}
                size="sm"
                shape="circle"
                sparkle={false}
              />
              <span className="td-group-name">{canonical.name}</span>
              <span className="td-group-rank">#{canonical.fifa_ranking_at_2026}</span>
            </li>
            {opponents.map((o) => (
              <li key={o.code} className="td-group-row">
                <Link
                  href={`/team/${o.code}`}
                  className="td-group-link"
                  aria-label={`Open ${o.name} team page`}
                >
                  <TeamFlag
                    code={o.code}
                    name={o.name}
                    accentColor={o.kit?.primary}
                    size="sm"
                    shape="circle"
                    sparkle={false}
                  />
                  <span className="td-group-name">{o.name}</span>
                  <span className="td-group-rank">#{o.fifaRank}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="td-section-hint">
            Standings update once group-stage matches kick off. Until then the
            order shown is world-rank ascending.
          </p>
        </section>
      )}

      <section className="td-section td-form-section" aria-label="Recent form">
        <h2>Recent form</h2>
        <RecentForm games={form} />
        <p className="td-section-hint">
          Last 5 international results (oldest left, newest right). Live data
          coming soon.
        </p>
      </section>

      {upcoming && (
        <section className="td-section td-upcoming" aria-label="Next match">
          <h2>Next match</h2>
          <UpcomingCard
            row={upcoming}
            home={upcoming.home}
            tournamentLabel={
              upcoming.groupId ? `Group ${upcoming.groupId}` : upcoming.stage.toUpperCase()
            }
            opponentName={
              canonicalTeamByCode(upcoming.opponentCode)?.name ?? upcoming.opponentCode
            }
            opponentCode={upcoming.opponentCode}
            href={quickPickHref}
            selfPrimary={primary}
          />
        </section>
      )}

      <section className="td-section td-h2h" aria-label="Head to head">
        <h2>Head-to-head</h2>
        <p className="td-section-hint">
          Recent meetings vs likely group opponents. Stub data; replace with a
          historic-meetings data source (FIFA / ELO / soccer-data).
        </p>
        {opponents.length === 0 ? (
          <p className="td-section-hint">
            Group not yet drawn for this team.
          </p>
        ) : (
          <ul className="td-h2h-list">
            {/* TODO: real head-to-head meetings. The "last meeting" line below
                is synthetic per opponent code so the layout is reviewable. */}
            {opponents.slice(0, 3).map((o) => (
              <li key={o.code} className="td-h2h-row">
                <Link href={`/team/${o.code}`} className="td-h2h-team">
                  <TeamFlag
                    code={o.code}
                    name={o.name}
                    accentColor={o.kit?.primary}
                    size="sm"
                    shape="circle"
                    sparkle={false}
                  />
                  <span>{o.name}</span>
                </Link>
                <span className="td-h2h-line">
                  Last meeting: data coming soon
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="td-section td-squad" aria-label="Squad">
        <h2>Squad</h2>
        <p className="td-section-hint">
          {realPlayers.length > 0
            ? `${realPlayers.length}-player squad. Tap any player for their profile.`
            : "23-player provisional squad. Final squad lists lock 1 June 2026."}
        </p>
        {realPlayers.length > 0 ? (
          <ul
            className="player-grid"
            data-testid="td-squad-real"
            aria-label={`${canonical.name} squad`}
          >
            {realPlayers.map((p) => (
              <li key={p.id}>
                <PlayerCard player={p} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="td-squad-grid">
            {squad.map((p) => (
              <li
                key={`${p.position}-${p.jersey}`}
                className="td-squad-card"
                data-position={p.position}
              >
                <span className="td-squad-num">{p.jersey}</span>
                <span className="td-squad-name">
                  {p.name}
                  {p.captain && (
                    <span className="td-squad-captain" aria-label="Captain" title="Captain">
                      {" "}(C)
                    </span>
                  )}
                </span>
                <span className="td-squad-pos">{p.position}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(priorFixtures.length > 0 || futureFixtures.length > 1) && (
        <section className="td-section td-all-fixtures" aria-label="All tournament fixtures">
          <h2>Tournament fixtures</h2>
          <p className="td-section-hint">
            Tap any match to pick it without leaving the page.
          </p>
          <TeamFixturesWithPicks
            fixtures={fixtures}
            canonicalByCode={
              new Map(
                tournament.teams.map((t) => {
                  const c = canonicalTeamByCode(t.id);
                  return [
                    t.id,
                    {
                      name: c?.name ?? t.name,
                      kit: c?.kit ?? t.kit,
                    },
                  ];
                }),
              )
            }
            selfTeam={engineTeam}
            teamsById={new Map(tournament.teams.map((t) => [t.id, t]))}
          />
        </section>
      )}

      <footer className="td-footer">
        <Link href="/world-cup-2026" className="td-footer-link">
          &larr; Back to the bracket
        </Link>
      </footer>
    </main>
    </AppShell>
  );
}

interface UpcomingCardProps {
  readonly row: ReturnType<typeof teamFixtures>[number];
  readonly home: boolean;
  readonly tournamentLabel: string;
  readonly opponentName: string;
  readonly opponentCode: string;
  readonly href: string;
  readonly selfPrimary: string;
}

function UpcomingCard({
  row,
  home,
  tournamentLabel,
  opponentName,
  opponentCode,
  href,
}: UpcomingCardProps) {
  const date = new Date(row.kickoffUtc);
  const opp = canonicalTeamByCode(opponentCode);
  return (
    <div className="td-upcoming-card">
      <span className="td-upcoming-stage">{tournamentLabel}</span>
      <div className="td-upcoming-meta">
        <time dateTime={row.kickoffUtc}>
          {date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
          {" - "}
          {date.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        {row.venue && <span className="td-upcoming-venue">{row.venue}</span>}
      </div>
      <div className="td-upcoming-opponent">
        <span className="td-upcoming-vs">{home ? "vs" : "at"}</span>
        <Link href={`/team/${opponentCode}`} className="td-upcoming-opp-link">
          <TeamFlag
            code={opponentCode}
            name={opponentName}
            accentColor={opp?.kit?.primary}
            size="md"
            shape="circle"
            sparkle={false}
          />
          <span>{opponentName}</span>
        </Link>
      </div>
      <Link href={href} className="td-cta-primary td-cta-predict">
        Predict this match
      </Link>
    </div>
  );
}
