/**
 * <PlayerHero />, top-of-page banner for `/player/[id]`.
 *
 * Renders:
 *   - hero portrait (Wikimedia headshot) with a 10-pt-style attribution
 *     overlay across the bottom edge
 *   - full name + shirt number
 *   - quick chips: position, team flag (links to /team/[code]),
 *     captain badge (when applicable)
 *
 * Pure presentation; the data is the `PlayerRecord` plus an optional
 * `teamName` (the canonical full team name).
 */

import Link from "next/link";

import type { PlayerRecord } from "@/lib/players";
import { POSITION_LABEL } from "@/lib/players";

export interface PlayerHeroProps {
  readonly player: PlayerRecord;
  readonly teamName?: string;
  readonly teamFlagEmoji?: string;
  /** Group letter (e.g. "A") if the team is in a drawn group. */
  readonly groupId?: string;
}

export function PlayerHero({
  player,
  teamName,
  teamFlagEmoji,
  groupId,
}: PlayerHeroProps) {
  const initials = (player.name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <header className="player-hero" data-testid="player-hero">
      <div className="player-hero-bleed" aria-hidden="true" />
      <div className="player-hero-inner">
        <div className="player-hero-portrait">
          {player.imageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={player.imageUrl}
                alt={`Headshot of ${player.name}`}
                loading="eager"
                referrerPolicy="no-referrer"
              />
              {player.imageCredit && (
                <p className="player-hero-credit" data-testid="player-hero-credit">
                  {player.imageCredit}
                </p>
              )}
            </>
          ) : (
            <div className="player-hero-portrait-placeholder" aria-hidden="true">
              {initials}
            </div>
          )}
        </div>

        <div className="player-hero-title">
          <h1>
            {player.name}
            {typeof player.shirtNumber === "number" && (
              <span className="player-hero-shirt" data-testid="player-hero-shirt">
                #{player.shirtNumber}
              </span>
            )}
          </h1>
          {player.fullName && player.fullName !== player.name && (
            <p className="player-hero-fullname">{player.fullName}</p>
          )}
          <div className="player-hero-chips">
            <span className="player-hero-chip" data-testid="chip-position">
              {POSITION_LABEL[player.position]}
            </span>
            <Link
              href={`/team/${player.code}`}
              className="player-hero-chip player-hero-chip-link"
              data-testid="chip-team"
            >
              {teamFlagEmoji ? <span aria-hidden="true">{teamFlagEmoji}</span> : null}
              {teamName ?? player.code}
              {groupId && <span aria-label={`Group ${groupId}`}> · Group {groupId}</span>}
            </Link>
            {player.captain && (
              <span className="player-hero-chip player-hero-captain" data-testid="chip-captain">
                Captain
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
