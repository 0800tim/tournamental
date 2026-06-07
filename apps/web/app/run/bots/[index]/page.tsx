/**
 * /run/bots/[index], a single bot's full bracket detail view.
 *
 * Regenerates the bot's 64 demo-match picks deterministically from its
 * index. Each match row shows the bot's pick (gold), the second-most
 * likely outcome (silver), and, for group matches, the third (bronze).
 *
 * Pure browser. No network. ~3ms regen per bot makes this render
 * instant even on a billion-bot swarm because we only ever look at
 * one bot at a time.
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
  regenerateBotBracket,
} from "@/components/browser-swarm/regenerate";

import "../bots.css";

function outcomeLabel(
  outcome: "home_win" | "draw" | "away_win",
  match: { home_team: string; away_team: string },
): string {
  if (outcome === "home_win") return match.home_team;
  if (outcome === "away_win") return match.away_team;
  return "Draw";
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
              <code className="vt-bots-bot-id">{botId}</code>
              <span style={{ marginLeft: 12, color: "#98a0b7" }}>
                chalk score <strong>{chalkScore.toFixed(3)}</strong>
              </span>
            </p>
            <p style={{ color: "#c7d0e6", fontSize: 14 }}>
              This bracket was just regenerated in your browser from the
              bot&apos;s index using the same chalk-weighted algorithm
              the worker uses at generation time. Identical inputs,
              identical picks, no storage required. Gold flag is the
              bot&apos;s chosen outcome. Silver is the second-most
              likely. Bronze (group matches only) is the third.
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
                    <span style={{ color: "#e7ecf7" }}>{match.home_team}</span>{" "}
                    <span style={{ color: "#98a0b7" }}>vs</span>{" "}
                    <span style={{ color: "#e7ecf7" }}>{match.away_team}</span>
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
                    <span style={{ color: "#e7ecf7" }}>{match.home_team}</span>{" "}
                    <span style={{ color: "#98a0b7" }}>vs</span>{" "}
                    <span style={{ color: "#e7ecf7" }}>{match.away_team}</span>
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
