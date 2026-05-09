/**
 * LockSummary — running "X of 104 picks committed" + countdown + predicted
 * champion + lock-multiplier table + (placeholder) "back your boldest pick"
 * CTA. Pure render; takes per-match bracket + cascade output.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

import {
  type Bracket,
  type CascadedBracket,
  type Tournament,
  lockMultiplier,
} from "@vtorn/bracket-engine";

export interface LockSummaryProps {
  readonly bracket: Bracket;
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

function teamName(tournament: Tournament, code: string | null | undefined): string {
  if (!code) return "—";
  return tournament.teams.find((t) => t.id === code)?.name ?? code;
}

export function LockSummary(props: LockSummaryProps) {
  const { bracket, cascaded, tournament, deadline_utc } = props;
  const [now, setNow] = useState<number>(() => Date.parse(tournament.start_utc) - 1000);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const deadline = Date.parse(deadline_utc);

  // Per-match counts (group + knockout = up to 104 for FIFA 2026).
  const totalGroup = tournament.group_fixtures.length;
  const totalKnockout = tournament.knockouts.length;
  const totalPicks = totalGroup + totalKnockout;
  const groupPicks = Object.keys(bracket.matchPredictions).length;
  const knockoutPicks = Object.keys(bracket.knockoutPredictions).length;
  const committed = groupPicks + knockoutPicks;

  // Predicted champion: cascade's effective_winner of the Final.
  const final = cascaded.knockouts.find((k) => k.stage === "f");
  const champion = teamName(tournament, final?.effective_winner ?? final?.predicted_winner ?? null);

  // Lock-multiplier rows: each pick's multiplier from its lockedAt timestamp
  // against the bracket's window-to-tournament-start.
  const tableRows = useMemo(() => {
    const tournamentStart = Date.parse(tournament.start_utc);
    const windowSeconds = Math.max(1, (tournamentStart - Date.parse(bracket.lockedAt ?? new Date().toISOString())) / 1000);
    const all = [
      ...Object.values(bracket.matchPredictions).map((p) => ({
        kind: "group" as const,
        matchId: p.matchId,
        outcome: p.outcome,
        lockedAt: p.lockedAt,
      })),
      ...Object.values(bracket.knockoutPredictions).map((p) => ({
        kind: "knockout" as const,
        matchId: p.matchId,
        outcome: p.outcome,
        lockedAt: p.lockedAt,
      })),
    ];
    const nowMs = Date.now();
    const enriched = all.map((p) => {
      const sinceLock = (nowMs - Date.parse(p.lockedAt)) / 1000;
      const mult = lockMultiplier(Math.max(0, sinceLock), windowSeconds);
      return { ...p, multiplier: mult };
    });
    enriched.sort((a, b) => b.multiplier - a.multiplier);
    return enriched;
  }, [bracket, tournament]);

  const topMultRows = tableRows.slice(0, 5);
  const boldestPick = tableRows.find((r) => r.multiplier > 2.5);

  return (
    <aside className="bracket-lock-summary" data-testid="lock-summary">
      <div data-testid="lock-summary-headline">
        <strong>{committed}</strong> of {totalPicks} picks committed
        <span aria-hidden="true"> — {groupPicks}/{totalGroup} group, {knockoutPicks}/{totalKnockout} knockout.</span>
      </div>
      <div>
        Lock the rest before {new Date(deadline_utc).toUTCString().replace("GMT", "UTC")} for max points.
      </div>
      <div className="bracket-countdown">
        <span aria-label="time-to-deadline">{formatCountdown(now, deadline)}</span> remaining
      </div>

      <hr className="bracket-lock-divider" />

      <div className="bracket-predicted-champion" data-testid="predicted-champion">
        <span className="bracket-predicted-champion__label">Your predicted champion</span>
        <strong className="bracket-predicted-champion__team">{champion}</strong>
      </div>

      {topMultRows.length > 0 && (
        <div className="bracket-multiplier-table" data-testid="lock-multiplier-table">
          <h4>Top lock multipliers</h4>
          <table>
            <thead>
              <tr><th>Pick</th><th>Stage</th><th>Multiplier</th></tr>
            </thead>
            <tbody>
              {topMultRows.map((r) => (
                <tr key={`${r.kind}:${r.matchId}`}>
                  <td>{r.matchId}</td>
                  <td>{r.kind === "group" ? "Group" : "KO"}</td>
                  <td><strong>{r.multiplier.toFixed(2)}×</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {boldestPick && (
        <a
          className="btn-primary bracket-affiliate-cta"
          data-testid="boldest-pick-cta"
          href={`https://2026wc.vtourn.com/odds/${boldestPick.matchId}`}
        >
          Back your boldest pick →
        </a>
      )}
    </aside>
  );
}
