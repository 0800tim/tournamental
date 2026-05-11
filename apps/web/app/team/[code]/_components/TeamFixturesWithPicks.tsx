/**
 * TeamFixturesWithPicks, client component that owns the popup state
 * for the team page. Each fixture row in the team's tournament fixtures
 * list becomes tappable; tapping opens MatchPickPopup as a bottom-sheet
 * (mobile) / centered modal (desktop).
 *
 * Why a separate component: the team-detail page is a server component
 * (force-static for cache-friendliness). Popup state has to live on the
 * client, so we extract just the fixtures-list section.
 *
 * Deep-link contract:
 *   - URL `/team/[code]?pick=<matchId>` opens the popup pre-focused on
 *     `<matchId>`.
 *   - Opening writes `?pick=<matchId>` via history.pushState.
 *   - Closing pops a history entry (preserving back-button semantics).
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { Team } from "@vtorn/bracket-engine";

import { TeamFlag } from "@/components/bracket/TeamFlag";
import { MatchPickPopup } from "@/components/match-pick/MatchPickPopup";

import type { TeamFixtureRow } from "../_lib/team-data";

export interface TeamFixturesWithPicksProps {
  /** All fixtures involving this team, in chronological order. */
  readonly fixtures: readonly TeamFixtureRow[];
  /** Lookup of opponent metadata so we can display their flag + name. */
  readonly canonicalByCode: ReadonlyMap<
    string,
    { name: string; kit?: { primary?: string; secondary?: string } }
  >;
  /** This team, for the popup header. */
  readonly selfTeam: Team;
  /** All Tournament teams for opponent flag rendering. */
  readonly teamsById: ReadonlyMap<string, Team>;
}

function readPickFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("pick");
}

function pushPickUrl(matchId: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("pick", matchId);
  window.history.pushState({ pick: matchId }, "", url.toString());
}

function popPickUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("pick")) return;
  url.searchParams.delete("pick");
  window.history.pushState({}, "", url.toString());
}

export function TeamFixturesWithPicks(props: TeamFixturesWithPicksProps) {
  const { fixtures, canonicalByCode, selfTeam, teamsById } = props;

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);

  // Hydrate from URL on mount + when popstate fires (back/forward).
  useEffect(() => {
    setActiveMatchId(readPickFromUrl());
    const onPop = () => setActiveMatchId(readPickFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = (matchId: string) => {
    pushPickUrl(matchId);
    setActiveMatchId(matchId);
  };
  const close = () => {
    setActiveMatchId(null);
    popPickUrl();
  };

  // Resolve the active fixture so the popup can render the right teams.
  const activeFixture = useMemo(() => {
    if (!activeMatchId) return null;
    return fixtures.find((f) => f.matchId === activeMatchId) ?? null;
  }, [activeMatchId, fixtures]);

  return (
    <>
      <ol className="td-fixtures-list">
        {fixtures.map((f) => {
          const opp = canonicalByCode.get(f.opponentCode);
          const date = new Date(f.kickoffUtc);
          return (
            <li key={f.matchId} className="td-fixture">
              <span className="td-fixture-stage">
                {f.groupId ? `Grp ${f.groupId}` : f.stage.toUpperCase()}
              </span>
              <span className="td-fixture-date">
                {date.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <Link href={`/team/${f.opponentCode}`} className="td-fixture-opponent">
                <TeamFlag
                  code={f.opponentCode}
                  name={opp?.name ?? f.opponentCode}
                  accentColor={opp?.kit?.primary}
                  size="sm"
                  shape="circle"
                  sparkle={false}
                />
                <span>
                  {f.home ? "vs" : "at"} {opp?.name ?? f.opponentCode}
                </span>
              </Link>
              <button
                type="button"
                className="td-fixture-predict td-fixture-predict-btn"
                onClick={() => open(f.matchId)}
                aria-label={`Pick the ${f.opponentCode} match`}
                data-testid={`td-pick-${f.matchId}`}
              >
                Pick
              </button>
            </li>
          );
        })}
      </ol>

      {activeFixture && (
        <MatchPickPopup
          matchId={activeFixture.matchId}
          homeTeam={
            activeFixture.home
              ? selfTeam
              : teamsById.get(activeFixture.opponentCode) ?? fallbackTeam(activeFixture.opponentCode)
          }
          awayTeam={
            activeFixture.home
              ? teamsById.get(activeFixture.opponentCode) ?? fallbackTeam(activeFixture.opponentCode)
              : selfTeam
          }
          kickoffIso={activeFixture.kickoffUtc}
          venue={activeFixture.venue ?? null}
          presentation="sheet"
          noDraw={!activeFixture.groupId}
          onClose={close}
        />
      )}
    </>
  );
}

/**
 * Last-resort placeholder when the bracket-engine team list is missing
 * an entry (mostly during dev with stub data). Keeps the popup
 * rendering a sensible flag instead of crashing.
 */
function fallbackTeam(code: string): Team {
  return {
    id: code,
    name: code,
    country: code,
    fifa_rank: 99,
    pre_tournament_implied_win: 0.25,
    kit: { primary: "#94a3b8", secondary: "#0f172a" },
  } as Team;
}
