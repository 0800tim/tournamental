/**
 * /run/bots, the paginated list of every bot the user has generated.
 *
 * Reads the cumulative count from IndexedDB (swarm_state.total_bots_
 * generated). For each page, regenerates the 1,000 bots on demand
 * via the deterministic chalk strategy and shows a one-line summary
 * with gold / silver / bronze flags for the three most-likely cup
 * winners according to each bot's tuned strategy.
 *
 * All in-browser. No network. The list scales from zero to billions
 * because we never materialise the picks, we just enumerate indices.
 *
 * Tim 2026-06-07: rewired onto the real WC 2026 fixtures
 * (`@tournamental/bracket-engine`'s `loadFixtures2026()`). Each row
 * now shows a deterministic FIFA-flag persona, the bot's sentimental
 * "darling team" as the gold pick (which is what drives variety
 * across the list, without which the chalk strategy clusters every
 * confident bot onto the rank-1 favourite), and the bot's two
 * next-highest-confidence real-team picks across the 72 group
 * matches as silver/bronze. Knockouts use slot labels pre-tournament
 * so they're excluded from the medal columns.
 */

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/shell";
import { indexedDbPersistence, noopPersistence } from "@/components/browser-swarm/persistence";
import {
  MASTER_SEED,
  buildDemoMatches,
  botIdFromIndex,
  chalkScoreForBot,
  darlingTeamForBot,
  regenerateBotPick,
  teamMeta,
} from "@/components/browser-swarm/regenerate";
import { personaForBot } from "@/components/browser-swarm/personas";
import { debug } from "@/components/browser-swarm/debug-log";

import "./bots.css";

const PAGE_SIZE = 1000;

interface BotRowSummary {
  readonly index: number;
  readonly bot_id: string;
  readonly chalk_score: number;
  readonly persona_name: string;
  readonly persona_handle: string;
  readonly persona_flag: string;
  readonly persona_country: string;
  /** Champion pick (gold): the bot's sentimental darling team. */
  readonly champion: { team: string; team_name: string };
  /** Silver/bronze: the bot's next two highest-confidence real-team
   *  picks across the group stage. */
  readonly top_supporting: ReadonlyArray<{ team: string; team_name: string; probability: number }>;
}

function teamDisplayName(code: string): string {
  return teamMeta(code)?.name ?? code;
}

export default function BotsListPage(): JSX.Element {
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [rows, setRows] = useState<readonly BotRowSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const matches = useMemo(() => buildDemoMatches(), []);
  // Only group fixtures carry real team codes pre-tournament; knockout
  // slot labels are placeholders until the cascade resolves. The
  // silver/bronze "high-confidence pick" columns therefore look at
  // group matches only so they always render a recognisable team.
  const groupMatches = useMemo(
    () => matches.filter((m) => m.allows_draw),
    [matches],
  );

  // Load cumulative count once.
  useEffect(() => {
    const persist =
      typeof indexedDB !== "undefined" ? indexedDbPersistence : noopPersistence;
    persist
      .loadSwarmState()
      .then((s) => {
        setTotal(s.total_bots_generated);
        debug("loaded swarm_state.total_bots_generated", s.total_bots_generated);
      })
      .catch((e) => {
        debug("loadSwarmState failed", e);
      });
  }, []);

  // Regenerate the current page's rows whenever page or total changes.
  useEffect(() => {
    if (total <= 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const startIdx = (page - 1) * PAGE_SIZE;
    const endIdx = Math.min(total, startIdx + PAGE_SIZE);
    // Use rAF chunking so the UI doesn't lock for 3 seconds on a
    // 1000-bot page. We yield every 100 bots.
    const computed: BotRowSummary[] = [];
    let cancelled = false;
    let i = startIdx;
    function tick(): void {
      if (cancelled) return;
      const chunkEnd = Math.min(endIdx, i + 100);
      for (; i < chunkEnd; i++) {
        const bot_id = botIdFromIndex(MASTER_SEED, i);
        const chalk_score = chalkScoreForBot(MASTER_SEED, i);
        const persona = personaForBot(MASTER_SEED, i);
        const darling = darlingTeamForBot(MASTER_SEED, i);

        // Silver/bronze: scan group matches, pick the two highest-
        // confidence non-draw outcomes that land on a real team code.
        const picks = groupMatches
          .map((m) => {
            const pick = regenerateBotPick(MASTER_SEED, i, m);
            const team =
              pick.chosen === "home_win"
                ? m.home_team
                : pick.chosen === "away_win"
                  ? m.away_team
                  : null;
            return { team, probability: pick.chosenProbability };
          })
          .filter((p): p is { team: string; probability: number } => p.team !== null)
          .sort((a, b) => b.probability - a.probability);

        // De-dup so we don't show the same team three times. The
        // chalk strategy concentrates probability on the favourite
        // across all of that team's three group games.
        const seen = new Set<string>([darling]);
        const top_supporting: Array<{ team: string; team_name: string; probability: number }> = [];
        for (const p of picks) {
          if (seen.has(p.team)) continue;
          seen.add(p.team);
          top_supporting.push({
            team: p.team,
            team_name: teamDisplayName(p.team),
            probability: p.probability,
          });
          if (top_supporting.length >= 2) break;
        }

        computed.push({
          index: i,
          bot_id,
          chalk_score,
          persona_name: persona.name,
          persona_handle: persona.handle,
          persona_flag: persona.flag,
          persona_country: persona.country,
          champion: { team: darling, team_name: teamDisplayName(darling) },
          top_supporting,
        });
      }
      if (i < endIdx) {
        requestAnimationFrame(tick);
      } else {
        setRows(computed.slice());
        setLoading(false);
        debug("page", page, "rendered", computed.length, "rows");
      }
    }
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [page, total, groupMatches]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell title="Your bots">
      <main className="vt-bots">
        <article className="vt-bots-article">

          <header className="vt-bots-header">
            <p className="vt-bots-dateline">Your swarm · all bots · this device</p>
            <h1 className="vt-bots-title">Your bot swarm</h1>
            <p className="vt-bots-lede">
              Every bot you have generated on this device, in IndexedDB.
              Pagination is 1,000 bots per page. Click any row to view
              that bot&apos;s full bracket. Picks are regenerated
              deterministically from the bot&apos;s index in roughly 3
              milliseconds, so we do not store the picks themselves,
              which is how this scales to a billion bots in your tab.
              Brackets cover the full 104-match FIFA 2026 schedule (72
              group + 32 knockout) loaded from{" "}
              <code>@tournamental/bracket-engine</code>.
            </p>
            <div className="vt-bots-summary">
              <div>
                <p className="vt-bots-summary-label">Bots in IndexedDB</p>
                <p className="vt-bots-summary-value">{total.toLocaleString("en-NZ")}</p>
              </div>
              <div>
                <p className="vt-bots-summary-label">Pages</p>
                <p className="vt-bots-summary-value">{pageCount.toLocaleString("en-NZ")}</p>
              </div>
              <div>
                <p className="vt-bots-summary-label">Page size</p>
                <p className="vt-bots-summary-value">{PAGE_SIZE.toLocaleString("en-NZ")}</p>
              </div>
              <div className="vt-bots-summary-actions">
                <Link href="/run" className="vt-bots-button">
                  Back to builder →
                </Link>
              </div>
            </div>
          </header>

          {total === 0 ? (
            <div className="vt-bots-empty">
              <p>
                No bots yet. Head to{" "}
                <Link href="/run#builder">/run</Link> and tap{" "}
                <strong>Start swarm</strong> to generate your first
                batch. Then come back here and click any bot to view
                its bracket.
              </p>
            </div>
          ) : loading ? (
            <div className="vt-bots-empty">
              <p>Regenerating page {page} of {pageCount} (1,000 bots, ~3s)...</p>
            </div>
          ) : (
            <>
              <table className="vt-bots-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Persona</th>
                    <th>Bot ID</th>
                    <th>Chalk score</th>
                    <th>
                      <span className="vt-bots-medal vt-bots-medal--gold" aria-label="gold">🥇</span>{" "}
                      Champion pick
                    </th>
                    <th>
                      <span className="vt-bots-medal vt-bots-medal--silver" aria-label="silver">🥈</span>{" "}
                      Next pick
                    </th>
                    <th>
                      <span className="vt-bots-medal vt-bots-medal--bronze" aria-label="bronze">🥉</span>{" "}
                      3rd pick
                    </th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.index}>
                      <td>{row.index.toLocaleString("en-NZ")}</td>
                      <td>
                        <span className="vt-bots-pick">
                          <span aria-hidden="true">{row.persona_flag}</span>{" "}
                          <strong>{row.persona_name}</strong>{" "}
                          <span className="vt-bots-prob">{row.persona_country}</span>
                        </span>
                      </td>
                      <td>
                        <code className="vt-bots-bot-id">{row.bot_id}</code>
                      </td>
                      <td>{row.chalk_score.toFixed(3)}</td>
                      <td>
                        <span className="vt-bots-pick">
                          <strong>{row.champion.team_name}</strong>{" "}
                          <span className="vt-bots-prob">darling</span>
                        </span>
                      </td>
                      {[0, 1].map((medalIdx) => (
                        <td key={medalIdx}>
                          {row.top_supporting[medalIdx] ? (
                            <span className="vt-bots-pick">
                              <strong>{row.top_supporting[medalIdx]!.team_name}</strong>{" "}
                              <span className="vt-bots-prob">
                                {Math.round(row.top_supporting[medalIdx]!.probability * 100)}%
                              </span>
                            </span>
                          ) : (
                            <span className="vt-bots-pick-empty">-</span>
                          )}
                        </td>
                      ))}
                      <td>
                        <Link
                          href={`/run/bots/${row.index}`}
                          className="vt-bots-row-link"
                        >
                          View bracket →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <nav className="vt-bots-pagination" aria-label="Pagination">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                >
                  «
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  ←
                </button>
                <span className="vt-bots-pagination-meta">
                  Page <strong>{page.toLocaleString("en-NZ")}</strong> of{" "}
                  <strong>{pageCount.toLocaleString("en-NZ")}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => setPage(pageCount)}
                  disabled={page >= pageCount}
                >
                  »
                </button>
              </nav>
            </>
          )}
        </article>
      </main>
    </AppShell>
  );
}
