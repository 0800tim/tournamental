/**
 * GroupCard — the per-group pick UI.
 *
 * Shows the 6 teams in a group; user assigns 1st / 2nd / 3rd / 4th etc.
 * Reorder by clicking up/down arrows (mobile-first, no drag library
 * required for v0.1; desktop drag is a follow-up). Per-pick lock toggle
 * locks the group's standings at the current odds for higher-on-correct
 * scoring.
 */

"use client";

import type { Group, Team } from "@vtorn/bracket-engine";

export interface GroupCardProps {
  readonly group: Group;
  readonly teams: ReadonlyMap<string, Team>;
  readonly order: readonly string[]; // user's predicted finishing order
  readonly locked: boolean;
  readonly onReorder: (group_id: string, next: readonly string[]) => void;
  readonly onToggleLock: (group_id: string) => void;
}

export function GroupCard(props: GroupCardProps) {
  const { group, teams, order, locked, onReorder, onToggleLock } = props;
  const fullOrder = order.length === group.team_ids.length ? order : group.team_ids;

  const move = (idx: number, dir: -1 | 1): void => {
    const j = idx + dir;
    if (j < 0 || j >= fullOrder.length) return;
    const next = [...fullOrder];
    [next[idx], next[j]] = [next[j], next[idx]];
    onReorder(group.id, next);
  };

  return (
    <div className={`bracket-group ${locked ? "is-locked" : ""}`} data-group-id={group.id}>
      <div className="bracket-group-head">
        <h3>Group {group.id}</h3>
        <button
          type="button"
          className="bracket-lock-btn"
          aria-pressed={locked}
          onClick={() => onToggleLock(group.id)}
          aria-label={locked ? "Unlock group" : "Lock group at current odds"}
        >
          {locked ? "Locked" : "Lock"}
        </button>
      </div>
      <ol className="bracket-group-list">
        {fullOrder.map((teamId, idx) => {
          const team = teams.get(teamId);
          // 4-team group: top 2 advance automatically, 3rd is in the
          // best-thirds wildcard pool, 4th is eliminated.
          // (Older 6-team layout had two wildcard spots; the engine still
          // accepts that, but the FIFA 2026 format is 4-team groups.)
          const groupSize = group.team_ids.length;
          const advancing = idx < 2;
          const wildcard = groupSize === 4 ? idx === 2 : idx === 2 || idx === 3;
          return (
            <li
              key={teamId}
              className={`bracket-group-row ${advancing ? "is-advance" : wildcard ? "is-wildcard" : "is-out"}`}
            >
              <span className="bracket-pos">{idx + 1}</span>
              <span className="bracket-team">{team?.name ?? teamId}</span>
              <span className="bracket-fifa-rank">#{team?.fifa_rank ?? "-"}</span>
              <span className="bracket-controls" aria-hidden="true">
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0 || locked}
                  aria-label={`Move ${team?.name ?? teamId} up`}
                >
                  &uarr;
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, +1)}
                  disabled={idx === fullOrder.length - 1 || locked}
                  aria-label={`Move ${team?.name ?? teamId} down`}
                >
                  &darr;
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="bracket-group-legend">
        <span className="dot dot-advance" /> Advance &middot;
        <span className="dot dot-wildcard" /> Wildcard pool &middot;
        <span className="dot dot-out" /> Eliminated
      </p>
    </div>
  );
}
