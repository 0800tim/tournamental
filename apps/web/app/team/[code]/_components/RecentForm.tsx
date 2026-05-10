/**
 * RecentForm — five W/D/L dots for the most-recent five matches.
 *
 * Pure presentational. Server-rendered safe but kept as a client component
 * so a future "tap to expand" interaction (e.g. xG sparkline) can be added
 * without converting it back.
 *
 * TODO(live-data): the five entries are fed from
 * `apps/web/data/team-form.json`, currently a deterministic stub. Replace
 * with the live-results API once wired (see _lib/team-data.ts header).
 */

"use client";

import type { FormGame } from "../_lib/team-data";

export interface RecentFormProps {
  readonly games: readonly FormGame[];
}

const RESULT_LABEL: Record<FormGame["result"], string> = {
  W: "Win",
  D: "Draw",
  L: "Loss",
};

const RESULT_CLASS: Record<FormGame["result"], string> = {
  W: "td-form-dot td-form-w",
  D: "td-form-dot td-form-d",
  L: "td-form-dot td-form-l",
};

export function RecentForm({ games }: RecentFormProps) {
  if (games.length === 0) {
    return (
      <p className="td-form-empty">No recent results available.</p>
    );
  }
  // Show oldest -> newest left to right.
  const ordered = [...games].reverse();
  return (
    <div className="td-form" role="group" aria-label="Recent form (last 5 results)">
      <ol className="td-form-row">
        {ordered.map((g, i) => {
          const score = g.home
            ? `${g.goals_for}-${g.goals_against}`
            : `${g.goals_against}-${g.goals_for}`;
          const verb = g.home ? "vs" : "at";
          const date = new Date(g.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          const title = `${RESULT_LABEL[g.result]} ${verb} ${g.opponent} ${score} (${date}, ${g.competition})`;
          return (
            <li key={`${g.date}-${i}`} className="td-form-cell">
              <span
                className={RESULT_CLASS[g.result]}
                aria-label={title}
                title={title}
              >
                {g.result}
              </span>
              <span className="td-form-meta" aria-hidden="true">
                {verb} {g.opponent}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
