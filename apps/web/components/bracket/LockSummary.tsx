/**
 * LockSummary — the running "Locked-in: 23 of 48 teams" banner with
 * countdown to the tournament deadline. Pure render, takes the cascade
 * output as input.
 */

"use client";

import { useEffect, useState } from "react";

import type { CascadedBracket, Tournament } from "@vtorn/bracket-engine";

export interface LockSummaryProps {
  readonly cascaded: CascadedBracket;
  readonly tournament: Tournament;
  readonly deadline_utc: string;
}

function formatCountdown(now: number, deadline: number): string {
  const diff = Math.max(0, deadline - now);
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m`;
}

export function LockSummary(props: LockSummaryProps) {
  const { cascaded, tournament, deadline_utc } = props;
  const [now, setNow] = useState<number>(() => Date.parse(tournament.start_utc) - 1000);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const deadline = Date.parse(deadline_utc);
  const total = cascaded.committed_total_required;
  const committed = cascaded.committed_teams.length + cascaded.knockouts.filter((k) => k.predicted_winner).length;
  const lockedCount = cascaded.locked_keys.length;
  return (
    <aside className="bracket-lock-summary">
      <div>
        <strong>Locked-in:</strong> {committed} of {total} picks committed; {lockedCount} individually locked.
      </div>
      <div>
        Lock the rest before {new Date(deadline_utc).toUTCString().replace("GMT", "UTC")} for max points.
      </div>
      <div className="bracket-countdown">
        <span aria-label="time-to-deadline">{formatCountdown(now, deadline)}</span> remaining
      </div>
    </aside>
  );
}
