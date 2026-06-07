/**
 * /run/bots/[index], a single bot's full bracket detail view.
 *
 * Regenerates the bot's 104 FIFA WC 2026 picks deterministically from
 * its index. Each match row shows the bot's pick (gold), the second-
 * most likely outcome (silver), and, for group matches, the third
 * (bronze).
 *
 * Pure browser. No network. ~3ms regen per bot makes this render
 * instant even on a billion-bot swarm because we only ever look at
 * one bot at a time.
 *
 * Tim 2026-06-07: rewired onto real fixtures from
 * `@tournamental/bracket-engine`. Group matches show real team names
 * (France, Argentina, ...); knockout matches show slot labels
 * pre-tournament (winner_grpA, annex_third_vs_grpB) because the
 * cascade isn't resolved until results land. The bot's "darling team"
 * is also surfaced at the top so the user can see why this bot's
 * cup-winner pick differs from the next bot's, even when chalk scores
 * are similar.
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
  regenerateBotBracket,
  teamMeta,
} from "@/components/browser-swarm/regenerate";
import { personaForBot } from "@/components/browser-swarm/personas";

import "../bots.css";

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
  const bracket = useMemo(
    () => regenerateBotBracket(MASTER_SEED, botIndex, matches),
    [botIndex, matches],
  );

  const botId = botIdFromIndex(MASTER_SEED, botIndex);
  const chalkScore = chalkScoreForBot(MASTER_SEED, botIndex);
  const persona = useMemo(() => personaForBot(MASTER_SEED, botIndex), [botIndex]);
  const darling = useMemo(() => darlingTeamForBot(MASTER_SEED, botIndex), [botIndex]);
  const darlingName = teamDisplay(darling);

  const groupMatches = bracket.filter((b) => b.match.allows_draw);
  const knockoutMatches = bracket.filter((b) => !b.match.allows_draw);

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
              <span style={{ marginLeft: 12, color: "#f6c64f" }}>
                darling team <strong>{darlingName}</strong>
              </span>
            </p>
            <p style={{ color: "#c7d0e6", fontSize: 14 }}>
              This bracket was just regenerated in your browser from the
              bot&apos;s index using the same chalk-weighted algorithm
              the worker uses at generation time. Identical inputs,
              identical picks, no storage required. Gold flag is the
              bot&apos;s chosen outcome. Silver is the second-most
              likely. Bronze (group matches only) is the third. The
              <strong> darling team</strong> nudges this bot toward a
              long-shot sentimental pick so cup-winner distributions
              spread out across the 48-team field instead of clustering
              on the rank-1 favourite.
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
                <th>🥇 Pick</th>
                <th>🥈 2nd</th>
                <th>🥉 3rd</th>
              </tr>
            </thead>
            <tbody>
              {groupMatches.map(({ match, pick }) => (
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
                  {pick.ranking.slice(0, 3).map((r, idx) => (
                    <td key={idx}>
                      <span className="vt-bots-pick">
                        <strong>{outcomeLabel(r.outcome, match)}</strong>{" "}
                        <span className="vt-bots-prob">
                          {Math.round(r.probability * 100)}%
                        </span>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="vt-bots-h2">Knockouts ({knockoutMatches.length} matches)</h2>
          <p style={{ color: "#98a0b7", fontSize: 13, marginBottom: 12 }}>
            Pre-tournament: knockout slots show their cascade label
            (winner of group X, best-third paired with group Y) until
            results resolve them to real teams.
          </p>
          <table className="vt-bots-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Matchup</th>
                <th>🥇 Pick</th>
                <th>🥈 2nd</th>
              </tr>
            </thead>
            <tbody>
              {knockoutMatches.map(({ match, pick }) => (
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
                  {pick.ranking.slice(0, 2).map((r, idx) => (
                    <td key={idx}>
                      <span className="vt-bots-pick">
                        <strong>{outcomeLabel(r.outcome, match)}</strong>{" "}
                        <span className="vt-bots-prob">
                          {Math.round(r.probability * 100)}%
                        </span>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

        </article>
      </main>
    </AppShell>
  );
}
