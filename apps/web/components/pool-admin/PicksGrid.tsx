"use client";

/**
 * PicksGrid, pool-admin-only correctness grid.
 *
 * Renders a horizontally-scrolling table with one row per pool member
 * and one column per resulted match. Each cell is a ✓ (correct) or ✗
 * (wrong) glyph; "no pick" cells render as a dim dash so the eye
 * doesn't confuse them with misses. The first column (member handle +
 * flag) is sticky on the left; the last columns (current streak, best
 * streak, total correct) are sticky on the right.
 *
 * Column headers carry both the match number and the kickoff date so
 * the admin can read consecutive correct picks as a chronological
 * streak (Tim 2026-06-18 follow-up).
 *
 * Owner-gated server-side via /api/v1/syndicates/<slug>/picks-grid;
 * this component just renders whatever the BFF returns. A non-owner
 * who somehow loads the manage page (impossible today) would get an
 * "unauthorised" empty state from the BFF, and we'd hide the section.
 */

import { useEffect, useState } from "react";

interface MatchRow {
  match_no: string;
  kickoff_utc: string;
  home_code: string | null;
  away_code: string | null;
  outcome: "home_win" | "draw" | "away_win";
}

interface MemberRow {
  user_id: string | null;
  handle: string;
  display_name: string | null;
  flag_emoji: string;
  picks: Array<"correct" | "wrong" | "no_pick">;
  correct_total: number;
  current_streak: number;
  best_streak: number;
}

interface GridPayload {
  slug: string;
  fetched_at: number;
  tournament_id: string;
  matches: MatchRow[];
  members: MemberRow[];
}

interface PicksGridProps {
  readonly slug: string;
  /**
   * Poll the BFF every N ms after the first fetch. Used on the public
   * `/s/<guid>` surface so viewers see new resulted-match columns land
   * within ~30s without pull-to-refresh. Pool-admin manage view leaves
   * this undefined (one fetch on mount is fine there). Tab-hide pauses
   * the polling.
   */
  readonly pollIntervalMs?: number;
}

function formatHeaderDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  // "17 Jun" — short and locale-agnostic; pool admins are mostly NZ/AU
  // but the format works globally without timezone surprises.
  const day = String(d.getUTCDate());
  const month = d.toLocaleString("en-NZ", {
    month: "short",
    timeZone: "UTC",
  });
  return `${day} ${month}`;
}

export function PicksGrid({
  slug,
  pollIntervalMs,
}: PicksGridProps): JSX.Element {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: GridPayload }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function load(initial: boolean): Promise<void> {
      try {
        const r = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug)}/picks-grid`,
          { method: "GET", credentials: "include", cache: "no-store" },
        );
        if (r.status === 401 || r.status === 403) {
          if (!cancelled && initial) {
            setState({ kind: "error", message: "Owner sign-in required." });
          }
          return;
        }
        if (!r.ok) {
          if (!cancelled && initial) {
            setState({
              kind: "error",
              message: `Could not load picks grid (HTTP ${r.status}).`,
            });
          }
          return;
        }
        const data = (await r.json()) as GridPayload;
        if (!cancelled) setState({ kind: "ready", data });
      } catch {
        if (!cancelled && initial) {
          setState({ kind: "error", message: "Network error loading grid." });
        }
      }
    }

    void load(true);

    if (pollIntervalMs && pollIntervalMs > 0) {
      const tick = (): void => {
        // Skip polling while the tab is hidden; saves the BFF (and edge
        // cache) from pointless work for background tabs.
        if (cancelled) return;
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "visible"
        ) {
          void load(false);
        }
      };
      timer = window.setInterval(tick, pollIntervalMs);
    }

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [slug, pollIntervalMs]);

  if (state.kind === "loading") {
    return (
      <section className="vt-picks-grid-section" aria-label="Picks grid">
        <h2 className="vt-picks-grid-title">Picks grid</h2>
        <p className="vt-picks-grid-lede">Loading per-match picks…</p>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section className="vt-picks-grid-section" aria-label="Picks grid">
        <h2 className="vt-picks-grid-title">Picks grid</h2>
        <p className="vt-picks-grid-lede">{state.message}</p>
      </section>
    );
  }

  const { matches, members } = state.data;
  if (matches.length === 0) {
    return (
      <section className="vt-picks-grid-section" aria-label="Picks grid">
        <h2 className="vt-picks-grid-title">Picks grid</h2>
        <p className="vt-picks-grid-lede">
          No resulted matches yet. The grid populates once admins record
          the first results.
        </p>
      </section>
    );
  }
  if (members.length === 0) {
    return (
      <section className="vt-picks-grid-section" aria-label="Picks grid">
        <h2 className="vt-picks-grid-title">Picks grid</h2>
        <p className="vt-picks-grid-lede">
          No members in this pool yet.
        </p>
      </section>
    );
  }

  return (
    <section className="vt-picks-grid-section" aria-label="Picks grid">
      <header className="vt-picks-grid-header">
        <h2 className="vt-picks-grid-title">Picks grid</h2>
        <p className="vt-picks-grid-lede">
          {members.length} {members.length === 1 ? "member" : "members"} ·{" "}
          {matches.length} resulted{" "}
          {matches.length === 1 ? "match" : "matches"}. Sorted by current
          winning streak. Scroll sideways to see every match.
        </p>
      </header>
      <div
        className="vt-picks-grid-scroll"
        role="region"
        aria-label="Per-match picks, scrollable"
        tabIndex={0}
      >
        <table className="vt-picks-grid">
          <thead>
            <tr>
              <th className="vt-picks-grid-th vt-picks-grid-th-name">
                Member
              </th>
              {matches.map((m) => (
                <th
                  key={m.match_no}
                  className="vt-picks-grid-th vt-picks-grid-th-match"
                  title={
                    m.home_code && m.away_code
                      ? `Match ${m.match_no}, ${m.home_code} v ${m.away_code}`
                      : `Match ${m.match_no}`
                  }
                >
                  <div className="vt-picks-grid-th-no">M{m.match_no}</div>
                  <div className="vt-picks-grid-th-date">
                    {formatHeaderDate(m.kickoff_utc)}
                  </div>
                </th>
              ))}
              <th className="vt-picks-grid-th vt-picks-grid-th-streak">
                Streak
              </th>
              <th className="vt-picks-grid-th vt-picks-grid-th-streak">
                Best
              </th>
              <th className="vt-picks-grid-th vt-picks-grid-th-total">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.handle}>
                <th
                  scope="row"
                  className="vt-picks-grid-cell vt-picks-grid-cell-name"
                >
                  <span
                    className="vt-picks-grid-flag"
                    aria-hidden="true"
                  >
                    {member.flag_emoji}
                  </span>
                  <span className="vt-picks-grid-handle">
                    {member.display_name ?? member.handle}
                  </span>
                  {member.display_name &&
                    member.display_name !== member.handle && (
                      <span className="vt-picks-grid-subhandle">
                        @{member.handle}
                      </span>
                    )}
                </th>
                {member.picks.map((p, i) => (
                  <td
                    key={matches[i]!.match_no}
                    className="vt-picks-grid-cell vt-picks-grid-cell-pick"
                    data-pick={p}
                    aria-label={
                      p === "correct"
                        ? "Correct"
                        : p === "wrong"
                          ? "Wrong"
                          : "No pick"
                    }
                  >
                    {p === "correct" ? "✓" : p === "wrong" ? "✗" : "·"}
                  </td>
                ))}
                <td
                  className="vt-picks-grid-cell vt-picks-grid-cell-streak"
                  data-current-streak={member.current_streak}
                >
                  {member.current_streak}
                </td>
                <td className="vt-picks-grid-cell vt-picks-grid-cell-streak">
                  {member.best_streak}
                </td>
                <td className="vt-picks-grid-cell vt-picks-grid-cell-total">
                  {member.correct_total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
