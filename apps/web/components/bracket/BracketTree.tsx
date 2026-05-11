/**
 * BracketTree — SVG visualisation of the user's predicted knockout path.
 *
 * Scales to any viewport (the SVG viewBox handles it). Updates instantly
 * as group standings change because the cascade calculator is pure and
 * runs on every state change. No API calls.
 *
 * Layout: left-to-right tree, R32 on the left through Final on the right.
 * Each round halves the slot count; each match is a card with two team
 * lines + a winner toggle.
 */

"use client";

import type {
  CascadedKnockout,
  Team,
  Tournament,
} from "@vtorn/bracket-engine";

export interface BracketTreeProps {
  readonly tournament: Tournament;
  readonly knockouts: readonly CascadedKnockout[];
  readonly teams: ReadonlyMap<string, Team>;
  readonly onPickWinner: (match_id: string, team_id: string) => void;
  readonly onToggleLock: (match_id: string) => void;
  readonly lockedKeys: readonly string[];
}

const STAGE_ORDER = ["r32", "r16", "qf", "sf", "f"] as const;

const COL_W = 220;
const ROW_H = 78;
const PAD_X = 24;
const PAD_Y = 24;

export function BracketTree(props: BracketTreeProps) {
  const { knockouts, teams, onPickWinner, onToggleLock, lockedKeys } = props;

  // Group knockouts by stage. Skip the 3rd-place play-off ("tp_01") in
  // the main tree — render it as a sidebar below.
  const byStage = STAGE_ORDER.map((stage) =>
    knockouts.filter((k) => k.stage === stage && k.id !== "tp_01"),
  );

  const maxRows = byStage[0]?.length ?? 16;
  const width = COL_W * STAGE_ORDER.length + PAD_X * 2;
  const height = ROW_H * maxRows + PAD_Y * 2;

  const matchPosition = (stageIdx: number, rowIdx: number, totalRows: number): { x: number; y: number } => {
    const x = PAD_X + stageIdx * COL_W;
    // Spread evenly within the column
    const slotH = (height - PAD_Y * 2) / totalRows;
    const y = PAD_Y + rowIdx * slotH + slotH / 2 - 28;
    return { x, y };
  };

  return (
    <div className="bracket-tree">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Predicted knockout tree"
        preserveAspectRatio="xMinYMin meet"
      >
        {/* connector lines (back layer) */}
        {byStage.flatMap((stage, stageIdx) =>
          stage.map((k, rowIdx) => {
            if (stageIdx === 0) return null;
            const { x, y } = matchPosition(stageIdx, rowIdx, stage.length);
            const prev = byStage[stageIdx - 1] ?? [];
            const a = matchPosition(stageIdx - 1, rowIdx * 2, prev.length);
            const b = matchPosition(stageIdx - 1, rowIdx * 2 + 1, prev.length);
            return (
              <g key={`${k.id}-line`} className="bracket-line" stroke="rgba(108,171,221,0.45)" fill="none">
                <path d={`M ${a.x + COL_W - 24} ${a.y + 28} H ${x - 12} V ${y + 28}`} />
                <path d={`M ${b.x + COL_W - 24} ${b.y + 28} H ${x - 12} V ${y + 28}`} />
              </g>
            );
          }),
        )}
        {/* match cards (front layer) */}
        {byStage.flatMap((stage, stageIdx) =>
          stage.map((k, rowIdx) => {
            const { x, y } = matchPosition(stageIdx, rowIdx, stage.length);
            const homeName = teams.get(k.home.team ?? "")?.name ?? "—";
            const awayName = teams.get(k.away.team ?? "")?.name ?? "—";
            const winner = k.predicted_winner;
            const isHomeWin = winner !== null && winner === k.home.team;
            const isAwayWin = winner !== null && winner === k.away.team;
            const locked = lockedKeys.includes(`knockout:${k.id}`);
            return (
              <g key={k.id} className={`bracket-card ${locked ? "is-locked" : ""}`} transform={`translate(${x},${y})`}>
                <rect width={COL_W - 32} height={56} rx={6} className="bracket-card-bg" />
                <text x={8} y={14} className="bracket-card-stage">{k.stage.toUpperCase()} #{k.match_no}</text>
                <g
                  className={`bracket-card-row ${isHomeWin ? "is-winner" : ""} ${k.home.from_actual ? "is-actual" : ""}`}
                  onClick={() => k.home.team && onPickWinner(k.id, k.home.team)}
                  style={{ cursor: k.home.team ? "pointer" : "default" }}
                >
                  <rect y={20} width={COL_W - 32} height={16} rx={3} />
                  <text x={8} y={32}>{homeName}</text>
                </g>
                <g
                  className={`bracket-card-row ${isAwayWin ? "is-winner" : ""} ${k.away.from_actual ? "is-actual" : ""}`}
                  onClick={() => k.away.team && onPickWinner(k.id, k.away.team)}
                  style={{ cursor: k.away.team ? "pointer" : "default" }}
                >
                  <rect y={38} width={COL_W - 32} height={16} rx={3} />
                  <text x={8} y={50}>{awayName}</text>
                </g>
                {/* save indicator (top-right) */}
                <g
                  onClick={() => onToggleLock(k.id)}
                  style={{ cursor: "pointer" }}
                  aria-label={locked ? "Remove save" : "Save pick at current odds"}
                >
                  <circle cx={COL_W - 44} cy={10} r={6} className="bracket-card-lock" fill={locked ? "#facc15" : "rgba(255,255,255,0.18)"} />
                </g>
              </g>
            );
          }),
        )}
      </svg>
      {props.knockouts.find((k) => k.id === "tp_01") && (
        <div className="bracket-third-place" aria-label="Third-place play-off">
          <h4>3rd-place play-off</h4>
          {(() => {
            const tp = props.knockouts.find((k) => k.id === "tp_01")!;
            const homeName = teams.get(tp.home.team ?? "")?.name ?? "—";
            const awayName = teams.get(tp.away.team ?? "")?.name ?? "—";
            const winner = tp.predicted_winner;
            return (
              <div className="bracket-card-mini">
                <button
                  type="button"
                  className={winner === tp.home.team ? "is-winner" : ""}
                  onClick={() => tp.home.team && onPickWinner(tp.id, tp.home.team)}
                  disabled={!tp.home.team}
                >
                  {homeName}
                </button>
                <span className="vs">vs</span>
                <button
                  type="button"
                  className={winner === tp.away.team ? "is-winner" : ""}
                  onClick={() => tp.away.team && onPickWinner(tp.id, tp.away.team)}
                  disabled={!tp.away.team}
                >
                  {awayName}
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
