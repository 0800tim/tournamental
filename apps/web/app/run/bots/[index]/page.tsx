/**
 * /run/bots/[index], a single bot's full bracket detail view.
 *
 * Regenerates the bot's 104 FIFA WC 2026 picks deterministically from
 * its index. Each match row shows the bot's pick alongside the
 * matchup and, only when it carries genuine signal (probability above
 * 15%), a subdued alternative line for the second-place outcome.
 *
 * Pure browser. No network. ~3ms regen per bot makes this render
 * instant even on a billion-bot swarm because we only ever look at
 * one bot at a time.
 *
 * Tim 2026-06-08: trimmed the silver/bronze columns (mathematically
 * redundant once the chalk pick dominates) and gated the darling-team
 * label so it only appears when the favoured team is genuinely a
 * top-16 contender, avoiding the "darling: Cape Verde" longshot
 * noise that made the persona header feel uncredible.
 */

"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";

import { AppShell } from "@/components/shell";
import {
  MASTER_SEED,
  buildDemoMatches,
  botIdFromIndex,
  chalkScoreForBot,
  darlingTeamForBot,
  regenerateBotBracketUnique,
  teamMeta,
} from "@/components/browser-swarm/regenerate";
import { personaForBot } from "@/components/browser-swarm/personas";
import {
  resolveBotBracket,
  resolvedKnockoutSlots,
} from "@/components/browser-swarm/cascade";

import "../bots.css";

/**
 * Probability threshold for surfacing the second-place outcome as a
 * subdued "or X 18%" line below the dominant pick. Below this, the
 * silver is noise (typically a 5%-7% sliver next to an 89% favourite)
 * and is hidden. Above it, the matchup is genuinely tight and the
 * alternative carries real signal.
 */
const ALT_THRESHOLD = 0.15;

function outcomeLabel(
  outcome: "home_win" | "draw" | "away_win",
  match: { home_team: string; away_team: string },
): string {
  if (outcome === "home_win") return teamDisplay(match.home_team);
  if (outcome === "away_win") return teamDisplay(match.away_team);
  return "Draw";
}

function teamDisplay(code: string): string {
  return teamMeta(code)?.name ?? code;
}

export default function BotDetailPage(): JSX.Element {
  const params = useParams<{ index: string }>();
  const botIndex = Number.parseInt(params.index ?? "0", 10);

  const matches = useMemo(() => buildDemoMatches(), []);
  // A11 Phase 2: render the bracket from the within-swarm-unique
  // perturbation. The chosen outcomes here match exactly what the
  // worker committed for this bot index, so the detail page shows
  // the same picks that landed on the leaderboard.
  const bracket = useMemo(
    () => regenerateBotBracketUnique(MASTER_SEED, botIndex, matches),
    [botIndex, matches],
  );
  // Resolve every knockout slot to a concrete team id (winner of group
  // A becomes "France" when this bot's group A standings put France
  // first, etc.). Powers the real-team-name rendering in the knockout
  // table below.
  const resolved = useMemo(
    () => resolveBotBracket(MASTER_SEED, botIndex, matches),
    [botIndex, matches],
  );

  const botId = botIdFromIndex(MASTER_SEED, botIndex);
  const chalkScore = chalkScoreForBot(MASTER_SEED, botIndex);
  const persona = useMemo(() => personaForBot(MASTER_SEED, botIndex), [botIndex]);
  const darling = useMemo(() => darlingTeamForBot(MASTER_SEED, botIndex), [botIndex]);
  const darlingMeta = teamMeta(darling);
  const darlingName = darlingMeta?.name ?? darling;
  // Only surface the "darling team" label when it actually adds
  // information: the team has to be a real FIFA top-16 side. Below
  // that threshold the label feels uncredible (Iraq, Cape Verde) and
  // is hidden entirely.
  const TOP_RANK_THRESHOLD = 16;
  const showDarling =
    darlingMeta !== null && darlingMeta.fifa_rank <= TOP_RANK_THRESHOLD;

  const groupMatches = bracket.filter((b) => b.match.allows_draw);
  const knockoutMatches = bracket.filter((b) => !b.match.allows_draw);

  // Look up the resolved (home, away) team ids for a knockout match,
  // falling back to the raw slot label if the cascade left the slot
  // unresolved (e.g. mid-build or pre-Annex-C).
  function resolvedTeams(matchId: string, rawHome: string, rawAway: string): {
    home: string;
    away: string;
  } {
    const lookup = resolvedKnockoutSlots(resolved.cascaded, matchId);
    return {
      home: lookup?.home ?? rawHome,
      away: lookup?.away ?? rawAway,
    };
  }

  return (
    <AppShell title={`Bot #${botIndex}`}>
      <main className="vt-bots">
        <article className="vt-bots-article">

          <header className="vt-bots-header">
            <p className="vt-bots-dateline">
              Your swarm · single bot · regenerated from index
            </p>
            <h1 className="vt-bots-title">
              Bot #{botIndex.toLocaleString("en-NZ")}
            </h1>
            <p className="vt-bots-lede">
              <span aria-hidden="true">{persona.flag}</span>{" "}
              <strong>{persona.name}</strong>{" "}
              <span style={{ color: "#98a0b7" }}>({persona.country})</span>{" "}
              <code className="vt-bots-bot-id" style={{ marginLeft: 12 }}>{botId}</code>
              <span style={{ marginLeft: 12, color: "#98a0b7" }}>
                chalk score <strong>{chalkScore.toFixed(3)}</strong>
              </span>
              {showDarling ? (
                <span style={{ marginLeft: 12, color: "#f6c64f" }}>
                  darling team <strong>{darlingName}</strong>
                </span>
              ) : null}
            </p>
            <p style={{ color: "#c7d0e6", fontSize: 14 }}>
              This bracket was just regenerated in your browser from the
              bot&apos;s index using the same chalk-weighted algorithm
              the worker uses at generation time. Identical inputs,
              identical picks, no storage required. Pick is what this
              bot expects to happen. A subdued alternative shows only
              when the second-place outcome carries genuine signal
              (probability above 15%).
            </p>
            <div className="vt-bots-summary-actions" style={{ marginTop: 18 }}>
              <Link href="/run/bots" className="vt-bots-button">
                ← All bots
              </Link>
              <Link href="/run" className="vt-bots-button">
                Builder →
              </Link>
            </div>
          </header>

          <h2 className="vt-bots-h2">Group stage ({groupMatches.length} matches)</h2>
          <table className="vt-bots-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Matchup</th>
                <th>Pick</th>
              </tr>
            </thead>
            <tbody>
              {groupMatches.map(({ match, pick }) => {
                const top = pick.ranking[0];
                const alt = pick.ranking[1];
                const showAlt = alt !== undefined && alt.probability > ALT_THRESHOLD;
                return (
                  <tr key={match.match_id}>
                    <td>
                      <code style={{ fontSize: 12, color: "#98a0b7" }}>
                        {match.match_id}
                      </code>
                    </td>
                    <td>
                      <span style={{ color: "#e7ecf7" }}>{teamDisplay(match.home_team)}</span>{" "}
                      <span style={{ color: "#98a0b7" }}>vs</span>{" "}
                      <span style={{ color: "#e7ecf7" }}>{teamDisplay(match.away_team)}</span>
                    </td>
                    <td>
                      {top !== undefined ? (
                        <span className="vt-bots-pick">
                          <strong>{outcomeLabel(top.outcome, match)}</strong>{" "}
                          <span className="vt-bots-prob">
                            {Math.round(top.probability * 100)}%
                          </span>
                        </span>
                      ) : null}
                      {showAlt ? (
                        <div className="vt-bots-pick-alt">
                          or {outcomeLabel(alt.outcome, match)}{" "}
                          {Math.round(alt.probability * 100)}%
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h2 className="vt-bots-h2">Knockouts ({knockoutMatches.length} matches)</h2>
          <p style={{ color: "#98a0b7", fontSize: 13, marginBottom: 12 }}>
            Cascade resolved: every knockout slot is projected onto a
            concrete team using this bot&apos;s group standings and the
            FIFA Annex C routing table. Click through the rounds to see
            how the bot expects each tie to play out.
          </p>
          <table className="vt-bots-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Matchup</th>
                <th>Pick</th>
              </tr>
            </thead>
            <tbody>
              {knockoutMatches.map(({ match, pick }) => {
                const teams = resolvedTeams(
                  match.match_id,
                  match.home_team,
                  match.away_team,
                );
                const resolvedMatch = {
                  ...match,
                  home_team: teams.home,
                  away_team: teams.away,
                };
                const top = pick.ranking[0];
                const alt = pick.ranking[1];
                const showAlt = alt !== undefined && alt.probability > ALT_THRESHOLD;
                return (
                  <tr key={match.match_id}>
                    <td>
                      <code style={{ fontSize: 12, color: "#98a0b7" }}>
                        {match.match_id}
                      </code>
                    </td>
                    <td>
                      <span style={{ color: "#e7ecf7" }}>
                        {teamDisplay(teams.home)}
                      </span>{" "}
                      <span style={{ color: "#98a0b7" }}>vs</span>{" "}
                      <span style={{ color: "#e7ecf7" }}>
                        {teamDisplay(teams.away)}
                      </span>
                    </td>
                    <td>
                      {top !== undefined ? (
                        <span className="vt-bots-pick">
                          <strong>{outcomeLabel(top.outcome, resolvedMatch)}</strong>{" "}
                          <span className="vt-bots-prob">
                            {Math.round(top.probability * 100)}%
                          </span>
                        </span>
                      ) : null}
                      {showAlt ? (
                        <div className="vt-bots-pick-alt">
                          or {outcomeLabel(alt.outcome, resolvedMatch)}{" "}
                          {Math.round(alt.probability * 100)}%
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

        </article>
      </main>
    </AppShell>
  );
}
