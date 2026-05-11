/**
 * OddsHoverCard, the popover that appears on chip hover/focus.
 *
 * Shows three rows (Home / Draw / Away, Draw hidden in knockouts), an
 * implied-probability bar per row, source attribution + age, and the
 * geo-gated affiliate CTA.
 *
 * The card itself is rendered as a sibling of the chip inside a
 * `.wrap` container; CSS positioning + `:hover` / `:focus-within`
 * handles open/close. For touch devices the parent component sets
 * `data-open="true"` on long-press to keep it sticky.
 */

"use client";

import { useEffect, useState } from "react";

import { MarketTrend } from "./MarketTrend";
import { affiliateCtaMode, buildPolymarketDeepLink } from "@/lib/odds/geo";
import type { MatchOdds, OddsHistoryPoint } from "@/lib/odds/types";

import styles from "./OddsChip.module.css";

export interface OddsHoverCardProps {
  readonly odds: MatchOdds;
  /** Display label for the home team (full name preferred). */
  readonly homeLabel: string;
  /** Display label for the away team (full name preferred). */
  readonly awayLabel: string;
  /** ISO kickoff string, optional, shown in the card header if given. */
  readonly kickoffIso?: string;
  /** Group label, e.g. "Group A", optional. */
  readonly groupLabel?: string;
  /** Cloudflare-derived 2-letter country code; gates the affiliate CTA. */
  readonly country?: string | null;
  /** When true, force the popover to stay open (used on touch). */
  readonly open?: boolean;
  /** Optional `id` so the chip can `aria-describedby` this. */
  readonly id?: string;
  /** Optional history points for the sparkline. */
  readonly history?: readonly OddsHistoryPoint[];
  /** Optional source surface tag for affiliate-click analytics. */
  readonly source?: string;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatKickoff(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Locale-friendly but compact, e.g. "11 Jun 20:00".
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sourceLabel(s: MatchOdds["source"]): string {
  switch (s) {
    case "polymarket":
      return "Polymarket";
    case "kalshi":
      return "Kalshi";
    case "mock-fifa-rank":
      return "Estimate (FIFA rank)";
    case "mock-stub":
      return "Estimate";
  }
}

export function OddsHoverCard(props: OddsHoverCardProps) {
  const {
    odds,
    homeLabel,
    awayLabel,
    kickoffIso,
    groupLabel,
    country,
    open,
    id,
    history,
    source,
  } = props;

  // Live "Xs ago", recompute every 15s while the card is mounted.
  const [, tick] = useState<number>(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const ctaMode = affiliateCtaMode(country ?? null);
  const showSparkline = !!history && history.length > 1;

  const kickoff = formatKickoff(kickoffIso);
  const isKnockout = odds.draw === null;
  const headerTitle = `${homeLabel} vs ${awayLabel}${groupLabel ? ` · ${groupLabel}` : ""}`;

  return (
    <div
      className={styles.card}
      role="tooltip"
      id={id}
      data-open={open ? "true" : undefined}
      aria-live="polite"
    >
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle} title={headerTitle}>{headerTitle}</span>
        {kickoff && <span className={styles.cardKickoff}>{kickoff}</span>}
      </div>

      <div className={styles.cardRow} data-side="home">
        <span className={styles.cardRowLabel} title={homeLabel}>{homeLabel}</span>
        <span className={styles.cardRowBar} aria-hidden="true">
          <span
            className={styles.cardRowBarFill}
            style={{ width: `${Math.round(odds.homeWin * 100)}%` }}
          />
        </span>
        <span className={styles.cardRowPct}>{pct(odds.homeWin)}</span>
      </div>

      {!isKnockout && odds.draw !== null && (
        <div className={styles.cardRow} data-side="draw">
          <span className={styles.cardRowLabel}>Draw</span>
          <span className={styles.cardRowBar} aria-hidden="true">
            <span
              className={styles.cardRowBarFill}
              style={{ width: `${Math.round(odds.draw * 100)}%` }}
            />
          </span>
          <span className={styles.cardRowPct}>{pct(odds.draw)}</span>
        </div>
      )}

      <div className={styles.cardRow} data-side="away">
        <span className={styles.cardRowLabel} title={awayLabel}>{awayLabel}</span>
        <span className={styles.cardRowBar} aria-hidden="true">
          <span
            className={styles.cardRowBarFill}
            style={{ width: `${Math.round(odds.awayWin * 100)}%` }}
          />
        </span>
        <span className={styles.cardRowPct}>{pct(odds.awayWin)}</span>
      </div>

      {showSparkline && (
        <MarketTrend
          points={history!}
          showDraw={!isKnockout}
          title={`14-day trend for ${homeLabel} vs ${awayLabel}`}
        />
      )}

      <div className={styles.cardFooter}>
        <div className={styles.cardSource}>
          <span>Source: {sourceLabel(odds.source)}</span>
          <span>{formatAge(odds.updatedAt)}</span>
        </div>

        {ctaMode === "full" && (
          <a
            className={styles.cta}
            href={buildPolymarketDeepLink({
              marketId: odds.marketId,
              outcomeToken: odds.homeOutcomeToken ?? odds.awayOutcomeToken,
              source: source ?? "odds-hover-card",
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
              marketId: odds.marketId,
              outcomeToken: odds.homeOutcomeToken ?? odds.awayOutcomeToken,
              source: source ?? "odds-hover-card-softened",
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
  );
}
