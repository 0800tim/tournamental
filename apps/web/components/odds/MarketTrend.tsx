/**
 * MarketTrend, 14-day sparkline showing how the W/D/L probabilities
 * have moved over time. Pure SVG, no chart lib.
 *
 * Inputs are an array of `OddsHistoryPoint`. We draw three polylines
 * (home, draw if present, away) at the same vertical scale so a user
 * can see the lines crossing.
 *
 * Uses `apps/odds-ingest`'s `/v1/odds/markets/:slug/history` if
 * available; otherwise the mock generator's `mockOddsHistory`.
 */

"use client";

import styles from "./OddsChip.module.css";
import type { OddsHistoryPoint } from "@/lib/odds/types";

export interface MarketTrendProps {
  readonly points: readonly OddsHistoryPoint[];
  readonly height?: number;
  readonly showDraw?: boolean;
  /** Accessible label for the sparkline. */
  readonly title?: string;
}

const VIEW_W = 320;

export function MarketTrend(props: MarketTrendProps) {
  const { points, height = 36, showDraw = true, title = "14-day market trend" } = props;
  if (!points || points.length < 2) {
    // Not enough data: render an empty placeholder so layout is stable.
    return (
      <svg
        className={styles.trend}
        viewBox={`0 0 ${VIEW_W} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={title}
        aria-hidden={!title}
      >
        <line
          x1={0}
          x2={VIEW_W}
          y1={height / 2}
          y2={height / 2}
          className={styles.trendBaseline}
        />
      </svg>
    );
  }

  const stepX = VIEW_W / (points.length - 1);
  const yFor = (p: number): number => {
    // p in [0, 1]; map so 0 is at the bottom and 1 at the top, with a
    // 2px margin top/bottom.
    const margin = 2;
    return margin + (1 - p) * (height - margin * 2);
  };

  const homePath = points
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(2)} ${yFor(pt.homeWin).toFixed(2)}`)
    .join(" ");
  const awayPath = points
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(2)} ${yFor(pt.awayWin).toFixed(2)}`)
    .join(" ");
  const drawPath = showDraw
    ? points
        .map((pt, i) => {
          if (pt.draw === null) return "";
          return `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(2)} ${yFor(pt.draw).toFixed(2)}`;
        })
        .filter(Boolean)
        .join(" ")
    : "";

  return (
    <svg
      className={styles.trend}
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={title}
    >
      <line
        x1={0}
        x2={VIEW_W}
        y1={yFor(0.5)}
        y2={yFor(0.5)}
        className={styles.trendBaseline}
      />
      <path d={homePath} className={`${styles.trendLine} ${styles.trendLineHome}`} />
      {drawPath && <path d={drawPath} className={`${styles.trendLine} ${styles.trendLineDraw}`} />}
      <path d={awayPath} className={`${styles.trendLine} ${styles.trendLineAway}`} />
    </svg>
  );
}
