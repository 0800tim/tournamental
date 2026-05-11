/**
 * StageProgressChart — two-series native SVG line chart showing the
 * member's cumulative points across the tournament's match-days vs
 * the pool average.
 *
 * 480×220, no chart-lib. Two lines + a soft area fill under each;
 * axis labels at top/bottom; subtle horizontal gridlines.
 */

import type { PointsStamp } from "@/lib/mock/points-history";

export interface StageProgressChartProps {
  readonly memberSeries: readonly PointsStamp[];
  readonly poolSeries: readonly PointsStamp[];
  readonly width?: number;
  readonly height?: number;
  readonly memberLabel?: string;
  readonly poolLabel?: string;
}

export function StageProgressChart({
  memberSeries,
  poolSeries,
  width = 480,
  height = 220,
  memberLabel = "You",
  poolLabel = "Pool average",
}: StageProgressChartProps) {
  const padL = 32;
  const padR = 12;
  const padT = 28;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const allPoints = [...memberSeries, ...poolSeries];
  const maxY = Math.max(10, ...allPoints.map((s) => s.points));
  const maxT = Math.max(1, ...allPoints.map((s) => s.t));

  const toX = (t: number) => padL + (t / maxT) * innerW;
  const toY = (p: number) => padT + (1 - p / maxY) * innerH;

  const memberPath = pathFrom(memberSeries, toX, toY);
  const poolPath = pathFrom(poolSeries, toX, toY);

  const memberArea = `${memberPath} L${toX(maxT).toFixed(1)},${padT + innerH} L${toX(0).toFixed(1)},${padT + innerH} Z`;

  const memberFinal = memberSeries[memberSeries.length - 1]?.points ?? 0;
  const poolFinal = poolSeries[poolSeries.length - 1]?.points ?? 0;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Stage progress chart"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="vt-spc-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f5c542" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f5c542" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Gridlines */}
      {[0.25, 0.5, 0.75, 1].map((frac) => {
        const y = padT + frac * innerH;
        return (
          <line
            key={frac}
            x1={padL}
            x2={padL + innerW}
            y1={y}
            y2={y}
            stroke="rgba(125, 145, 200, 0.12)"
            strokeWidth={1}
          />
        );
      })}

      {/* Y-axis ticks */}
      {[0, 0.5, 1].map((frac) => {
        const y = padT + (1 - frac) * innerH;
        const val = Math.round(maxY * frac);
        return (
          <text
            key={frac}
            x={padL - 6}
            y={y}
            textAnchor="end"
            dominantBaseline="central"
            fontFamily="Inter, system-ui, sans-serif"
            fontSize="10"
            fill="#7a8597"
          >
            {val}
          </text>
        );
      })}

      {/* Pool line (back) */}
      <path
        d={poolPath}
        fill="none"
        stroke="#7eb6e8"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="3 4"
        opacity={0.85}
      />

      {/* Member fill + line (front) */}
      <path d={memberArea} fill="url(#vt-spc-grad)" />
      <path
        d={memberPath}
        fill="none"
        stroke="#f5c542"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Legend */}
      <g transform={`translate(${padL}, ${12})`}>
        <circle cx={4} cy={6} r={4} fill="#f5c542" />
        <text
          x={14}
          y={6}
          dominantBaseline="central"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="11"
          fontWeight={700}
          fill="#f0f3fa"
        >
          {memberLabel} · {memberFinal} pts
        </text>
        <circle cx={120} cy={6} r={4} fill="#7eb6e8" />
        <text
          x={130}
          y={6}
          dominantBaseline="central"
          fontFamily="Inter, system-ui, sans-serif"
          fontSize="11"
          fontWeight={600}
          fill="#cdd5e7"
        >
          {poolLabel} · {poolFinal} pts
        </text>
      </g>

      {/* X-axis label */}
      <text
        x={padL + innerW / 2}
        y={height - 6}
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="10"
        fill="#7a8597"
      >
        Match-day
      </text>
    </svg>
  );
}

function pathFrom(
  series: readonly PointsStamp[],
  toX: (t: number) => number,
  toY: (p: number) => number,
): string {
  if (series.length === 0) return "";
  return series
    .map((s, i) => `${i === 0 ? "M" : "L"}${toX(s.t).toFixed(1)},${toY(s.points).toFixed(1)}`)
    .join(" ");
}
