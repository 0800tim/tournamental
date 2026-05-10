/**
 * TeamOverlay — bottom-sheet card that embeds team detail content.
 *
 * Pulls a compact set of fields from the canonical teams JSON + the
 * tournament fixture data so the overlay is light enough to open
 * instantly. The "View full team page" CTA in the header navigates to
 * the real `/team/[code]` route for the deeper detail view.
 *
 * Note: we deliberately don't import the full team page component —
 * it's a server component with its own data dependencies. Instead we
 * hand-roll a compact card view here that mirrors the same data
 * surface (flag, name, FIFA rank, group, manager, fixtures).
 */

"use client";

import Link from "next/link";
import { useMemo } from "react";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

import { TeamFlag } from "@/components/bracket/TeamFlag";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

import {
  canonicalTeamByCode,
  groupForTeam,
  nextFixture,
  teamFixtures,
} from "@/app/team/[code]/_lib/team-data";

import { Sheet } from "./Sheet";
import { useOverlay } from "./OverlayProvider";

interface TeamOverlayProps {
  readonly code: string;
  readonly depth?: number;
}

export function TeamOverlay(props: TeamOverlayProps) {
  const { code, depth = 0 } = props;
  const upper = code.toUpperCase();
  const overlay = useOverlay();

  // Resolve canonical + tournament data once per render. The enrich
  // step is cheap (small map merge) and these helpers are pure, so we
  // memoise on `upper` only.
  const data = useMemo(() => {
    const canonical = canonicalTeamByCode(upper);
    const baseTournament = loadFixtures2026();
    const tournament = enrichTournamentTeams(
      baseTournament,
      canonicalTeamsRaw as CanonicalTeamsFile,
    );
    const engineTeam = tournament.teams.find((t) => t.id === upper);
    const groupId = groupForTeam(tournament, upper);
    const fixtures = teamFixtures(upper);
    const upcoming = nextFixture(upper);
    return { canonical, engineTeam, groupId, fixtures, upcoming };
  }, [upper]);

  const { canonical, engineTeam, groupId, fixtures, upcoming } = data;

  if (!canonical || !engineTeam) {
    return (
      <Sheet
        title="Team not found"
        depth={depth}
        onClose={overlay.close}
        idHint={`team-${upper}`}
      >
        <p>We couldn&apos;t find a team with code &ldquo;{upper}&rdquo;.</p>
        <p>
          <Link href="/world-cup-2026" onClick={overlay.closeAll}>
            Back to the bracket
          </Link>
        </p>
      </Sheet>
    );
  }

  const primary = canonical.kit?.primary ?? "#fbbf24";

  const fullPageHref = `/team/${upper}`;
  const headerSlot = (
    <Link
      href={fullPageHref}
      className="vt-overlay-fullpage-cta"
      onClick={() => overlay.closeAll()}
      aria-label={`Open the full ${canonical.name} team page`}
    >
      Full page →
    </Link>
  );

  return (
    <Sheet
      title={canonical.name}
      headerSlot={headerSlot}
      depth={depth}
      onClose={overlay.close}
      idHint={`team-${upper}`}
    >
      <div
        className="vt-team-overlay"
        style={{ "--vt-team-primary": primary } as React.CSSProperties}
      >
        <header className="vt-team-overlay-hero">
          <TeamFlag
            code={upper}
            name={canonical.name}
            accentColor={primary}
            size="lg"
            shape="circle"
            sparkle={false}
          />
          <div className="vt-team-overlay-meta">
            <h3>{canonical.name}</h3>
            <ul className="vt-team-overlay-chips">
              <li>FIFA #{canonical.fifa_ranking_at_2026}</li>
              {groupId && <li>Group {groupId}</li>}
              <li>{canonical.confederation}</li>
            </ul>
            {canonical.manager && (
              <p className="vt-team-overlay-manager">
                Manager: {canonical.manager}
              </p>
            )}
          </div>
        </header>

        {upcoming && (
          <section aria-label="Next match" className="vt-team-overlay-section">
            <h4>Next match</h4>
            <p>
              {upcoming.home ? "vs" : "at"}{" "}
              {canonicalTeamByCode(upcoming.opponentCode)?.name ??
                upcoming.opponentCode}{" "}
              —{" "}
              <time dateTime={upcoming.kickoffUtc}>
                {new Date(upcoming.kickoffUtc).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </time>
              {upcoming.venue && <span>, {upcoming.venue}</span>}
            </p>
            <button
              type="button"
              className="vt-overlay-fullpage-cta"
              onClick={() =>
                overlay.replace("match", { id: upcoming.matchId })
              }
              aria-label="Open match preview"
            >
              View match preview
            </button>
          </section>
        )}

        {fixtures.length > 0 && (
          <section
            aria-label="Tournament fixtures"
            className="vt-team-overlay-section"
          >
            <h4>Fixtures ({fixtures.length})</h4>
            <ul className="vt-team-overlay-fixtures">
              {fixtures.map((f) => (
                <li key={f.matchId}>
                  <button
                    type="button"
                    className="vt-team-overlay-fixture-btn"
                    onClick={() =>
                      overlay.replace("match", { id: f.matchId })
                    }
                  >
                    <span className="vt-team-overlay-fixture-vs">
                      {f.home ? "vs" : "at"}{" "}
                      {canonicalTeamByCode(f.opponentCode)?.name ??
                        f.opponentCode}
                    </span>
                    <time
                      dateTime={f.kickoffUtc}
                      className="vt-team-overlay-fixture-date"
                    >
                      {new Date(f.kickoffUtc).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="vt-team-overlay-actions">
          <Link
            href={fullPageHref}
            className="vt-overlay-fullpage-cta"
            onClick={() => overlay.closeAll()}
          >
            Open full team page →
          </Link>
        </footer>
      </div>
    </Sheet>
  );
}
