/**
 * PointsSparkline, a 60×20 inline SVG sparkline showing the last
 * N points-stamps for a leaderboard member.
 *
 * Pure SVG (no canvas, no chart-lib) for two reasons:
 *  1. Tiny, adds zero KB to the bundle.
 *  2. Renders in SSR so the leaderboard never flashes empty rows.
 *
 * The line is drawn through the points; the area under the line is
 * filled with a soft gradient so the sparkline reads at a glance.
 */

import type { PointsStamp } from "@/lib/mock/points-history";

export interface PointsSparklineProps {
  readonly stamps: readonly PointsStamp[];
  readonly width?: number;
  readonly height?: number;
  /** Stroke + fill hue. Default tournamental sky-blue. */
  readonly stroke?: string;
  readonly ariaLabel?: string;
}

export function PointsSparkline({
  stamps,
  width = 60,
  height = 20,
  stroke = "#7eb6e8",
  ariaLabel = "Recent points history",
}: PointsSparklineProps) {
  if (stamps.length === 0) {
    return (
      <svg
        className="vt-lb-sparkline"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      />
    );
  }

  const min = Math.min(...stamps.map((s) => s.points));
  const max = Math.max(...stamps.map((s) => s.points));
  const range = max - min || 1;

  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const xStep = stamps.length > 1 ? innerW / (stamps.length - 1) : 0;
  const pts = stamps.map((s, i) => {
    const x = pad + i * xStep;
    const y = pad + (1 - (s.points - min) / range) * innerH;
    return [x, y] as const;
  });

  const linePath = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const areaPath = `${linePath} L${pts[pts.length - 1]![0].toFixed(1)},${height - pad} L${pts[0]![0].toFixed(1)},${height - pad} Z`;

  const gradId = `vt-spark-grad-${Math.abs(hashStr(stroke + stamps.length))}`;

  return (
    <svg
      className="vt-lb-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
