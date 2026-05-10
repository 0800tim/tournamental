/**
 * <PlayerCard /> — square-ish player tile used by the /players index and
 * the team-page squad grid. Pure presentation; no data fetching.
 *
 * Renders:
 *   - circular thumbnail (Wikimedia headshot, or initials fallback)
 *   - player name
 *   - shirt number + position badge
 *
 * The whole card is a link to `/player/<id>`.
 */

import Link from "next/link";

import type { PlayerRecord } from "@/lib/players";

export interface PlayerCardProps {
  readonly player: PlayerRecord;
  /** Override link target (e.g. tests). Defaults to `/player/<id>`. */
  readonly href?: string;
}

export function PlayerCard({ player, href }: PlayerCardProps) {
  const target = href ?? `/player/${player.id}`;
  const initials = (player.name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <Link
      href={target}
      className="player-card"
      data-testid="player-card"
      data-player-id={player.id}
    >
      <div className="player-card-thumb" aria-hidden="true">
        {player.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={player.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="player-card-thumb-placeholder">{initials}</div>
        )}
      </div>
      <p className="player-card-name">{player.name}</p>
      <div className="player-card-meta">
        <span className="player-card-team-chip">{player.code}</span>
        <span className="player-card-pos-badge">{player.position}</span>
      </div>
    </Link>
  );
}
