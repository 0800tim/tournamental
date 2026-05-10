/**
 * Lineup tab — predicted XI per team rendered on a vertical pitch.
 *
 * Players are positioned via the formation's normalised x/y (0..100)
 * which we map to CSS percentages on a green pitch background. Mobile-
 * first: pitch is portrait, players are circular avatars with jersey #
 * inside, name below, position label above on hover.
 *
 * Goalkeepers render at the bottom of their half (closest to their own
 * goal), so the home team's GK is at the bottom of the pitch and the
 * away team's GK is at the top, mirroring how a TV broadcast lineup
 * graphic is usually drawn.
 */

"use client";

import type { TeamFormation } from "../_lib/match-data";

export interface LineupTabProps {
  readonly homeName: string;
  readonly awayName: string;
  readonly homeCode?: string;
  readonly awayCode?: string;
  readonly homeLineup: TeamFormation | null;
  readonly awayLineup: TeamFormation | null;
}

export function LineupTab(props: LineupTabProps) {
  const { homeName, awayName, homeCode, awayCode, homeLineup, awayLineup } = props;

  if (!homeCode || !awayCode || !homeLineup || !awayLineup) {
    return (
      <div className="mp-tab-content mp-lineup-empty">
        <p className="mp-empty-headline">
          Predicted lineups unlock once both teams are confirmed.
        </p>
      </div>
    );
  }

  return (
    <div className="mp-tab-content mp-lineup">
      <header className="mp-lineup-head">
        <span>
          {homeName}
          <span className="mp-lineup-formation">{homeLineup.formation}</span>
        </span>
        <span>
          {awayName}
          <span className="mp-lineup-formation">{awayLineup.formation}</span>
        </span>
      </header>
      {(homeLineup.stub || awayLineup.stub) && (
        <p className="mp-lineup-stub-note">
          Predicted XI - real lineups confirm one hour before kickoff.
        </p>
      )}

      <div className="mp-pitch" aria-label="Predicted lineups on a pitch">
        <div className="mp-pitch-half mp-pitch-home">
          {homeLineup.xi.map((p, i) => (
            <PlayerDot key={`h-${i}`} player={p} side="home" />
          ))}
        </div>
        <div className="mp-pitch-mid" aria-hidden="true" />
        <div className="mp-pitch-half mp-pitch-away">
          {awayLineup.xi.map((p, i) => (
            <PlayerDot key={`a-${i}`} player={p} side="away" />
          ))}
        </div>
      </div>
    </div>
  );
}

interface PlayerDotProps {
  readonly player: {
    readonly jersey: number;
    readonly name: string;
    readonly position: string;
    readonly x: number;
    readonly y: number;
  };
  readonly side: "home" | "away";
}

function PlayerDot({ player, side }: PlayerDotProps) {
  // Position the player. The formation's x is 0..100 along the long axis
  // (0 = own goal-line, 100 = halfway). The y is 0..100 along the wide
  // axis. For the away half we flip x so 0 still means "own goal-line"
  // — i.e. visually at the top of the pitch.
  const longAxis = side === "home" ? `${player.x}%` : `${player.x}%`;
  const wideAxis = `${player.y}%`;
  const style = {
    left: wideAxis,
    bottom: side === "home" ? longAxis : undefined,
    top: side === "away" ? longAxis : undefined,
  } as React.CSSProperties;

  return (
    <div
      className={`mp-player mp-player-${side}`}
      style={style}
      data-position={player.position}
    >
      <span className="mp-player-jersey" aria-hidden="true">
        {player.jersey}
      </span>
      <span className="mp-player-name">{player.name}</span>
      <span className="mp-player-pos" aria-label={`Position: ${player.position}`}>
        {player.position}
      </span>
    </div>
  );
}
