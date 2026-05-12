/**
 * GroupWinnerChips, small bar of "team-code · 38%" pills shown above
 * the match list in `<GroupCard>`. Each pill is a live mini-chip; on
 * hover it reveals a compact card showing "team, group winner: X% on
 * Polymarket / source attribution / view market on Polymarket" link.
 *
 * The data source for these is `/v1/odds/team/:code/group` (or the
 * deterministic mock).
 */

"use client";

import { useEffect, useState } from "react";

import type { Team } from "@tournamental/bracket-engine";

import { fetchTeamGroupSummary } from "@/lib/odds/client";
import { affiliateCtaMode, buildPolymarketDeepLink } from "@/lib/odds/geo";
import type { TeamGroupSummary } from "@/lib/odds/types";

import styles from "./OddsChip.module.css";

export interface GroupWinnerChipsProps {
  readonly groupId: string;
  readonly teamCodes: readonly string[];
  readonly teams: ReadonlyMap<string, Team>;
  readonly country?: string | null;
}

export function GroupWinnerChips(props: GroupWinnerChipsProps) {
  const { groupId, teamCodes, teams, country } = props;
  const [summaries, setSummaries] = useState<readonly TeamGroupSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      teamCodes.map((code) =>
        fetchTeamGroupSummary({
          teamCode: code,
          groupId,
          groupTeamCodes: teamCodes,
        }),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const ok: TeamGroupSummary[] = [];
        for (const r of results) {
          if (r.ok) ok.push(r.data);
        }
        // Only show these chips when at least one backing market is
        // real Polymarket data. Placeholder estimates from the mock
        // or fallback default to a uniform split across all four
        // teams (~25% each), which is meaningless noise — hide it
        // until we wire real markets in. Once the odds-api proxy is
        // live for WC 2026 group-winner markets, this gate flips.
        const hasRealMarket = ok.some((s) => s.source === "polymarket");
        if (!hasRealMarket) {
          setSummaries([]);
          return;
        }
        // Normalise to sum to 1 (mock guarantees this; real data should
        // too but be defensive).
        const total = ok.reduce((a, s) => a + s.groupWinnerProb, 0);
        const normalised = total > 0
          ? ok.map((s) => ({ ...s, groupWinnerProb: s.groupWinnerProb / total }))
          : ok;
        // Sort by probability descending so the favourite is on the
        // left.
        normalised.sort((a, b) => b.groupWinnerProb - a.groupWinnerProb);
        setSummaries(normalised);
      })
      .catch(() => {
        if (cancelled) return;
        setSummaries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, teamCodes]);

  if (summaries.length === 0) return null;

  const ctaMode = affiliateCtaMode(country ?? null);

  return (
    <div className="bracket-group-winner-chips" data-group-id={groupId}>
      {summaries.map((s) => {
        const team = teams.get(s.teamCode);
        const pct = `${Math.round(s.groupWinnerProb * 100)}%`;
        return (
          <span key={s.teamCode} className={styles.wrap}>
            <span
              role="button"
              tabIndex={0}
              className={styles.chip}
              data-state="ok"
              data-team-code={s.teamCode}
              aria-label={`${team?.name ?? s.teamCode} ${pct} to win Group ${groupId}`}
            >
              <span className={styles.chipPart}>
                <span className={styles.chipPartHome}>{s.teamCode}</span>
                <span className={styles.chipPct}>{pct}</span>
              </span>
            </span>
            <div className={styles.card} role="tooltip">
              <div className={styles.cardHeader}>
                <span className={styles.cardTitle}>
                  {team?.name ?? s.teamCode} · Group {groupId}
                </span>
              </div>
              <div className={styles.cardRow} data-side="home">
                <span className={styles.cardRowLabel}>To win</span>
                <span className={styles.cardRowBar} aria-hidden="true">
                  <span
                    className={styles.cardRowBarFill}
                    style={{ width: `${Math.round(s.groupWinnerProb * 100)}%` }}
                  />
                </span>
                <span className={styles.cardRowPct}>{pct}</span>
              </div>
              <div className={styles.cardFooter}>
                <div className={styles.cardSource}>
                  <span>
                    Source: {s.source === "polymarket" ? "Polymarket" : "Estimate"}
                  </span>
                </div>
                {ctaMode === "full" && (
                  <a
                    className={styles.cta}
                    href={buildPolymarketDeepLink({
                      source: "group-winner-chip",
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-affiliate-cta="polymarket"
                  >
                    Back this on Polymarket →
                  </a>
                )}
                {ctaMode === "softened" && (
                  <a
                    className={`${styles.cta} ${styles.ctaSoftened}`}
                    href={buildPolymarketDeepLink({
                      source: "group-winner-chip-softened",
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-affiliate-cta="polymarket-view"
                  >
                    View market on Polymarket →
                  </a>
                )}
              </div>
            </div>
          </span>
        );
      })}
    </div>
  );
}
