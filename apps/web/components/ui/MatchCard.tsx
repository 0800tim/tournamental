/**
 * MatchCard — date-stamped fixture card with side-by-side flag rows
 * and a centre column that swaps between kickoff time, live clock, and
 * final score depending on `state`.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { PinIcon } from "../shell/icons";

import "./ui.css";

export type MatchCardState = "pre" | "live" | "final";

export interface MatchCardTeam {
  readonly code: string;
  readonly name: string;
  readonly score?: number;
  readonly flag?: ReactNode;
}

export interface MatchCardProps {
  readonly home: MatchCardTeam;
  readonly away: MatchCardTeam;
  readonly state?: MatchCardState;
  /** ISO-8601 UTC kickoff timestamp. Required for "pre". */
  readonly kickoffUtc?: string;
  /** "12'", "HT", "FT", "90+3'" — for "live". */
  readonly clockLabel?: string;
  readonly stage?: string;
  readonly groupId?: string;
  readonly venue?: string;
  readonly href?: string;
}

export function MatchCard({
  home,
  away,
  state = "pre",
  kickoffUtc,
  clockLabel,
  stage,
  groupId,
  venue,
  href,
}: MatchCardProps) {
  const eyebrowParts: string[] = [];
  if (groupId) eyebrowParts.push(`Group ${groupId}`);
  else if (stage) eyebrowParts.push(stage);
  if (kickoffUtc && state === "pre") {
    const date = new Date(kickoffUtc);
    if (!Number.isNaN(date.valueOf())) {
      eyebrowParts.push(
        date.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      );
    }
  }

  const middle = (() => {
    if (state === "live") {
      return (
        <>
          <span className="vt-match-card-score">
            {home.score ?? 0} : {away.score ?? 0}
          </span>
          <span className="vt-match-card-date">{clockLabel ?? "LIVE"}</span>
        </>
      );
    }
    if (state === "final") {
      return (
        <>
          <span className="vt-match-card-score">
            {home.score ?? 0} - {away.score ?? 0}
          </span>
          <span className="vt-match-card-date">FT</span>
        </>
      );
    }
    const date = kickoffUtc ? new Date(kickoffUtc) : null;
    return (
      <>
        <span className="vt-match-card-time">
          {date && !Number.isNaN(date.valueOf())
            ? date.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "TBD"}
        </span>
        <span className="vt-match-card-date">
          {date && !Number.isNaN(date.valueOf())
            ? date.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            : ""}
        </span>
      </>
    );
  })();

  const body = (
    <>
      <div className="vt-match-card-eyebrow">
        {state === "live" ? (
          <span className="vt-match-card-state-live">LIVE</span>
        ) : null}
        <span>{eyebrowParts.join(" - ")}</span>
      </div>
      <div className="vt-match-card-row">
        <div className="vt-match-card-team" data-side="home">
          <span className="vt-match-card-team-name">{home.name}</span>
          <span className="vt-match-card-flag" aria-hidden="true">
            {home.flag ?? home.code.slice(0, 3)}
          </span>
        </div>
        <div className="vt-match-card-mid">{middle}</div>
        <div className="vt-match-card-team" data-side="away">
          <span className="vt-match-card-flag" aria-hidden="true">
            {away.flag ?? away.code.slice(0, 3)}
          </span>
          <span className="vt-match-card-team-name">{away.name}</span>
        </div>
      </div>
      {venue ? (
        <div className="vt-match-card-loc">
          <PinIcon />
          <span>{venue}</span>
        </div>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="vt-match-card">
        {body}
      </Link>
    );
  }
  return <div className="vt-match-card">{body}</div>;
}
