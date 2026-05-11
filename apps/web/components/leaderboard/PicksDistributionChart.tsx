/**
 * PicksDistributionChart — a horizontal stacked bar showing what
 * % of the pool picked each team for a given match.
 *
 * Used on the syndicate landing's "what the pool thinks" section.
 *
 * Pure SVG (no chart-lib) — the segment widths are computed in JS,
 * each rect renders the team's kit primary, and a small percentage
 * label inside each segment.
 */

import "./leaderboard.css";

export interface PicksDistributionSegment {
  /** Team code, e.g. "ARG". */
  readonly code: string;
  /** Display label inside the bar; usually the team's 3-letter code. */
  readonly label: string;
  /** Percentage of the pool that picked this team (0-100). */
  readonly percent: number;
  /** Bar segment colour — pass the team's kit primary. */
  readonly colour: string;
}

export interface PicksDistributionChartProps {
  readonly title?: string;
  readonly subtitle?: string;
  readonly segments: readonly PicksDistributionSegment[];
  readonly width?: number;
  readonly height?: number;
}

export function PicksDistributionChart({
  title,
  subtitle,
  segments,
  width = 360,
  height = 40,
}: PicksDistributionChartProps) {
  const total = segments.reduce((sum, s) => sum + s.percent, 0) || 1;
  let x = 0;

  return (
    <div className="vt-pdc">
      {title && <div className="vt-pdc-title">{title}</div>}
      <svg
        className="vt-pdc-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title ?? "Picks distribution"}
      >
        {segments.map((s) => {
          const w = (s.percent / total) * width;
          const rect = (
            <g key={s.code}>
              <rect
                x={x}
                y={0}
                width={w}
                height={height}
                fill={s.colour}
                rx={6}
                ry={6}
              />
              {w > 36 && (
                <text
                  x={x + w / 2}
                  y={height / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="Inter, system-ui, sans-serif"
                  fontWeight="700"
                  fontSize="11"
                  fill="#0a0e1a"
                >
                  {s.label} {Math.round(s.percent)}%
                </text>
              )}
            </g>
          );
          x += w;
          return rect;
        })}
      </svg>
      {subtitle && <div className="vt-pdc-subtitle">{subtitle}</div>}
      <style>{`
        .vt-pdc { display: flex; flex-direction: column; gap: 6px; }
        .vt-pdc-title {
          font-size: 13px; font-weight: 700; color: #f0f3fa;
          display: flex; justify-content: space-between;
        }
        .vt-pdc-subtitle {
          font-size: 11px; color: #7a8597;
        }
        .vt-pdc-svg {
          border-radius: 6px;
          background: rgba(125, 145, 200, 0.06);
        }
      `}</style>
    </div>
  );
}
