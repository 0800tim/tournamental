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
  regenerateBotPick,
} from "@/components/browser-swarm/regenerate";
import { debug } from "@/components/browser-swarm/debug-log";

import "./bots.css";

const PAGE_SIZE = 1000;

interface BotRowSummary {
  readonly index: number;
  readonly bot_id: string;
  readonly chalk_score: number;
  /** Top 3 cup-winner candidates for this bot, ranked gold/silver/bronze. */
  readonly top3: ReadonlyArray<{ team: string; probability: number }>;
}

export default function BotsListPage(): JSX.Element {
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [rows, setRows] = useState<readonly BotRowSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const matches = useMemo(() => buildDemoMatches(), []);

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
        // The "cup-winner candidates" for the demo are the home_win
        // teams of the first 3 matches the bot has highest confidence
        // on. We pick by the bot's blended-probability on its chosen
        // outcome, then take the home team.
        const sorted = matches
          .map((m) => {
            const pick = regenerateBotPick(MASTER_SEED, i, m);
            return { match: m, pick };
          })
          .sort((a, b) => b.pick.chosenProbability - a.pick.chosenProbability)
          .slice(0, 3);
        const top3 = sorted.map((s) => ({
          team:
            s.pick.chosen === "home_win"
              ? s.match.home_team
              : s.pick.chosen === "away_win"
                ? s.match.away_team
                : "draw",
          probability: s.pick.chosenProbability,
        }));
        computed.push({ index: i, bot_id, chalk_score, top3 });
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
  }, [page, total, matches]);

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
                    <th>Bot ID</th>
                    <th>Chalk score</th>
                    <th>
                      <span className="vt-bots-medal vt-bots-medal--gold" aria-label="gold">🥇</span>{" "}
                      Highest-confidence pick
                    </th>
                    <th>
                      <span className="vt-bots-medal vt-bots-medal--silver" aria-label="silver">🥈</span>{" "}
                      2nd pick
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
                        <code className="vt-bots-bot-id">{row.bot_id}</code>
                      </td>
                      <td>{row.chalk_score.toFixed(3)}</td>
                      {[0, 1, 2].map((medalIdx) => (
                        <td key={medalIdx}>
                          {row.top3[medalIdx] ? (
                            <span className="vt-bots-pick">
                              <strong>{row.top3[medalIdx]!.team}</strong>{" "}
                              <span className="vt-bots-prob">
                                {Math.round(row.top3[medalIdx]!.probability * 100)}%
                              </span>
                            </span>
                          ) : (
                            <span className="vt-bots-pick-empty">,</span>
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
