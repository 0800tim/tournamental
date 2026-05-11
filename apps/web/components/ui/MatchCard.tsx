/**
 * MatchCard, TVNZ FIFA-app inspired fixture card.
 *
 * Layout (mobile, 375 px viewport):
 *
 *   ┌─────────────────────────┬─────────────────────────┐
 *   │ [UPCOMING/LIVE/FINAL]   │                         │
 *   │ flag-bg (home)          │ flag-bg (away)          │
 *   │                  CODE   │ CODE                    │
 *   └───────────── vs ────────┴─────────────────────────┘
 *      FRI 12 JUN  •  6:30 AM
 *      Mexico v Canada
 *      Group A  •  Estadio Azteca, Mexico City
 *
 * The flag-band is a 2-column grid where each cell renders the
 * country's flag SVG as a CSS `background-image`, faded with a dark
 * gradient so the 3-letter code stays legible even on white-heavy
 * flags (Argentina, Croatia, Japan).
 *
 * A small "vs" or trophy badge sits centred at the boundary of the
 * two halves; for live and final states the centre swaps to the
 * scoreline so the card reads at a glance.
 *
 * API is backwards compatible: the original `MatchCardProps` shape
 * is preserved 1:1, so existing call sites (home feed, watch page,
 * world-cup-2026 fixture list) keep working without prop changes.
 * New props (`flagSrc`, `pillLabel`) are optional and default to
 * sensible values derived from `code` and `state`.
 */

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import "./ui.css";

export type MatchCardState = "pre" | "live" | "final";

export interface MatchCardTeam {
  readonly code: string;
  readonly name: string;
  readonly score?: number;
  readonly flag?: ReactNode;
  /** Override the default `/flags/<CODE>.svg` background-image URL. */
  readonly flagSrc?: string;
}

export interface MatchCardProps {
  readonly home: MatchCardTeam;
  readonly away: MatchCardTeam;
  readonly state?: MatchCardState;
  /** ISO-8601 UTC kickoff timestamp. Required for "pre". */
  readonly kickoffUtc?: string;
  /** "12'", "HT", "FT", "90+3'", for "live". */
  readonly clockLabel?: string;
  readonly stage?: string;
  readonly groupId?: string;
  readonly venue?: string;
  readonly href?: string;
  /** Override the pill text. Defaults: UPCOMING / LIVE / FINAL. */
  readonly pillLabel?: string;
}

function defaultPillLabel(state: MatchCardState): string {
  if (state === "live") return "LIVE";
  if (state === "final") return "FINAL";
  return "UPCOMING";
}

function flagBackground(team: MatchCardTeam): string {
  const url = team.flagSrc ?? `/flags/${team.code}.svg`;
  return `url(${JSON.stringify(url)})`;
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
  pillLabel,
}: MatchCardProps) {
  const date = kickoffUtc ? new Date(kickoffUtc) : null;
  const validDate = date && !Number.isNaN(date.valueOf()) ? date : null;

  const dateLine = (() => {
    if (state === "live") return clockLabel ?? "LIVE";
    if (state === "final") return "FULL TIME";
    if (!validDate) return "TBD";
    const dayPart = validDate.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const timePart = validDate.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${dayPart} • ${timePart}`;
  })();

  const groupLine = (() => {
    const parts: string[] = [];
    if (groupId) parts.push(`Group ${groupId}`);
    else if (stage) parts.push(stage);
    if (venue) parts.push(venue);
    return parts.join(" • ");
  })();

  const centreBadge = (() => {
    if (state === "live") {
      return (
        <span
          className="vt-match-card-centre is-score"
          data-testid="vt-match-card-centre"
        >
          {home.score ?? 0}
          <span className="vt-match-card-centre-sep">:</span>
          {away.score ?? 0}
        </span>
      );
    }
    if (state === "final") {
      return (
        <span
          className="vt-match-card-centre is-score"
          data-testid="vt-match-card-centre"
        >
          {home.score ?? 0}
          <span className="vt-match-card-centre-sep">-</span>
          {away.score ?? 0}
        </span>
      );
    }
    return (
      <span
        className="vt-match-card-centre is-vs"
        data-testid="vt-match-card-centre"
        aria-hidden="true"
      >
        vs
      </span>
    );
  })();

  const homeStyle: CSSProperties = {
    backgroundImage: flagBackground(home),
  };
  const awayStyle: CSSProperties = {
    backgroundImage: flagBackground(away),
  };

  const pillText = pillLabel ?? defaultPillLabel(state);

  const body = (
    <>
      <div className="vt-match-card-flagband" data-state={state}>
        <div
          className="vt-match-card-half"
          data-side="home"
          data-testid="vt-match-card-flag-home"
          style={homeStyle}
          aria-hidden="true"
        >
          <span className="vt-match-card-half-grad" aria-hidden="true" />
          <span
            className="vt-match-card-code"
            data-side="home"
            data-testid="vt-match-card-code-home"
          >
            {home.code}
          </span>
        </div>
        <div
          className="vt-match-card-half"
          data-side="away"
          data-testid="vt-match-card-flag-away"
          style={awayStyle}
          aria-hidden="true"
        >
          <span className="vt-match-card-half-grad" aria-hidden="true" />
          <span
            className="vt-match-card-code"
            data-side="away"
            data-testid="vt-match-card-code-away"
          >
            {away.code}
          </span>
        </div>
        <span
          className="vt-match-card-pill"
          data-state={state}
          data-testid="vt-match-card-pill"
        >
          {state === "live" ? (
            <span className="vt-match-card-pill-dot" aria-hidden="true" />
          ) : null}
          {pillText}
        </span>
        <span className="vt-match-card-centre-wrap" aria-hidden="true">
          {centreBadge}
        </span>
      </div>
      <div className="vt-match-card-meta">
        <span className="vt-match-card-date" data-testid="vt-match-card-date">
          {dateLine}
        </span>
        <span className="vt-match-card-teams">
          {home.name} <span className="vt-match-card-teams-sep">v</span>{" "}
          {away.name}
        </span>
        {groupLine ? (
          <span className="vt-match-card-group">{groupLine}</span>
        ) : null}
      </div>
    </>
  );

  const aria = `${home.name} versus ${away.name}${
    groupId ? `, Group ${groupId}` : stage ? `, ${stage}` : ""
  }${state === "live" ? ", currently live" : ""}`;

  if (href) {
    return (
      <Link href={href} className="vt-match-card" aria-label={aria}>
        {body}
      </Link>
    );
  }
  return (
    <div className="vt-match-card" aria-label={aria}>
      {body}
    </div>
  );
}
