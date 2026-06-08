/**
 * /run/bots, the paginated list of every bot the user has generated.
 *
 * Reads the cumulative count from IndexedDB (swarm_state.total_bots_
 * generated). For each page, regenerates the 1,000 bots on demand
 * via the deterministic chalk strategy and shows a one-line summary
 * with the bot's champion pick. The full bracket lives behind the
 * "view bracket" link, so the list stays scannable.
 *
 * All in-browser. No network. The list scales from zero to billions
 * because we never materialise the picks, we just enumerate indices.
 *
 * Tim 2026-06-08: dropped the silver/bronze "next pick / 3rd pick"
 * columns; they always landed on the same two FIFA favourites and
 * added no information. Also gated the "darling" label on the
 * champion being a real top-16 contender, so longshots like Iraq or
 * Cape Verde no longer carry the label.
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
  teamMeta,
} from "@/components/browser-swarm/regenerate";
import { championForBot } from "@/components/browser-swarm/cascade";
import { personaForBot } from "@/components/browser-swarm/personas";
import { debug } from "@/components/browser-swarm/debug-log";
import {
  ANCHOR_TOURNAMENT_ID,
  captureAnchorSnapshotAsync,
  DEFAULT_ANCHOR_MODE,
  type AnchorMode,
  type AnchorSnapshot,
} from "@/components/browser-swarm/anchor";
import { modeFromWeight } from "@/components/browser-swarm/anchor-mode";

import "./bots.css";

const PAGE_SIZE = 1000;

/**
 * Only flag a champion as a "darling" pick when the team is a real
 * FIFA top-16 contender. Below that, the label is uncredible noise
 * (longshots like Iraq or Cape Verde) and we suppress it.
 */
const DARLING_RANK_THRESHOLD = 16;

interface BotRowSummary {
  readonly index: number;
  readonly bot_id: string;
  readonly chalk_score: number;
  readonly persona_name: string;
  readonly persona_handle: string;
  readonly persona_flag: string;
  readonly persona_country: string;
  /** Champion pick: the bot's sentimental darling team. The
   *  `is_darling` flag is true only when the team is in the FIFA
   *  top-16, so the badge is only shown when it adds signal. */
  readonly champion: { team: string; team_name: string; is_darling: boolean };
}

function teamDisplayName(code: string): string {
  return teamMeta(code)?.name ?? code;
}

export default function BotsListPage(): JSX.Element {
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [rows, setRows] = useState<readonly BotRowSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Build the fixture set once so cached team metadata is warmed for
  // teamMeta() lookups in the row loop below AND so championForBot can
  // cascade each bot's bracket to a concrete champion team.
  const matches = useMemo(() => buildDemoMatches(), []);

  // A11 Phase 2 anchor fix: the champion column now reflects the
  // user-bracket anchor (Strong by default). We restore the saved anchor
  // weight and async-capture the snapshot (local draft -> server
  // fallback) once, then cascade each bot's bracket through it.
  const [anchor, setAnchor] = useState<AnchorSnapshot | undefined>(undefined);

  // Load cumulative count + anchor snapshot once.
  useEffect(() => {
    let cancelled = false;
    const persist =
      typeof indexedDB !== "undefined" ? indexedDbPersistence : noopPersistence;
    void (async () => {
      try {
        const load = await persist.loadSwarmState();
        if (cancelled) return;
        // A6 wraps state under `.state` and flags fixture-version wipes
        // via `reset_for_version_change`. We don't surface the toast on
        // this list page (BrowserSwarm.tsx handles it), but the rows
        // here should now be empty after a wipe rather than dangling.
        const s = load.state;
        setTotal(s.total_bots_generated);
        debug("loaded swarm_state.total_bots_generated", s.total_bots_generated);
        const mode: AnchorMode = modeFromWeight(s.anchor_weight ?? 0);
        if (mode === "off") {
          if (!cancelled) setAnchor(undefined);
        } else {
          const snap = await captureAnchorSnapshotAsync(
            ANCHOR_TOURNAMENT_ID,
            mode,
          );
          if (!cancelled) setAnchor(snap);
        }
      } catch (e) {
        debug("loadSwarmState failed", e);
        // Default-anchor fallback so a load failure still biases picks.
        if (DEFAULT_ANCHOR_MODE !== "off") {
          try {
            const snap = await captureAnchorSnapshotAsync(
              ANCHOR_TOURNAMENT_ID,
              DEFAULT_ANCHOR_MODE,
            );
            if (!cancelled) setAnchor(snap);
          } catch {
            // give up; pure chalk
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
      // Smaller chunk when an anchor is active: championForBot runs a
      // full cascade (~3ms) per bot, vs the old O(1) darling lookup. 40
      // per frame keeps each rAF tick well under one 60fps frame budget.
      const chunkSize = anchor ? 40 : 100;
      const chunkEnd = Math.min(endIdx, i + chunkSize);
      for (; i < chunkEnd; i++) {
        const bot_id = botIdFromIndex(MASTER_SEED, i);
        const chalk_score = chalkScoreForBot(MASTER_SEED, i);
        const persona = personaForBot(MASTER_SEED, i);
        const darling = darlingTeamForBot(MASTER_SEED, i);
        const darling_meta = teamMeta(darling);

        // Champion pick: when an anchor is active the bot's REAL champion
        // (from its cascaded, user-biased bracket) is what we show, which
        // is what makes the column visibly cluster on the user's pick.
        // Without an anchor we keep the cheap darling label so the
        // unanchored list stays O(1) per row.
        let championTeam = darling;
        if (anchor) {
          championTeam = championForBot(MASTER_SEED, i, matches, anchor) ?? darling;
        }
        const champion_meta = teamMeta(championTeam);
        const is_darling =
          champion_meta !== null &&
          champion_meta.fifa_rank <= DARLING_RANK_THRESHOLD &&
          championTeam === darling;

        computed.push({
          index: i,
          bot_id,
          chalk_score,
          persona_name: persona.name,
          persona_handle: persona.handle,
          persona_flag: persona.flag,
          persona_country: persona.country,
          champion: {
            team: championTeam,
            team_name: teamDisplayName(championTeam),
            is_darling,
          },
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
  }, [page, total, anchor, matches]);

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
                    <th>Champion pick</th>
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
                          <strong>{row.champion.team_name}</strong>
                          {row.champion.is_darling ? (
                            <span className="vt-bots-prob">darling</span>
                          ) : null}
                        </span>
                      </td>
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
