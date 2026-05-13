/**
 * HeadToHeadPill, compact W-D-L summary between two teams.
 *
 * Per [doc 36 §HeadToHeadPill](../../../../docs/36-tournamental-ux-spec.md), used
 * inside the `MatchPredictionRow` (compact variant) and on the upcoming-match
 * preview / team-detail "Coming up" sections (wide variant).
 *
 * The data source is the stub at `apps/web/data/head-to-head.json` for now -
 * the file is a deterministic placeholder (TODO: live H2H feed).
 *
 * Pure presentational. Counts are explicit props so the same pill can be fed
 * from any future live source without reaching into JSON.
 */

"use client";

export interface HeadToHeadCounts {
  /** Home team's wins in the head-to-head record. */
  readonly homeWins: number;
  /** Draws in the head-to-head record. */
  readonly draws: number;
  /** Away team's wins in the head-to-head record. */
  readonly awayWins: number;
}

export interface HeadToHeadPillProps {
  readonly homeCode: string;
  readonly awayCode: string;
  readonly counts: HeadToHeadCounts;
  /**
   * compact = "ARG 4-3-2 FRA"; wide = "[ARG] 4 W • 3 D • 2 W [FRA]".
   * Default: "compact".
   */
  readonly variant?: "compact" | "wide";
  readonly className?: string;
}

export function HeadToHeadPill(props: HeadToHeadPillProps) {
  const { homeCode, awayCode, counts, variant = "compact", className = "" } = props;
  const { homeWins, draws, awayWins } = counts;
  const total = homeWins + draws + awayWins;

  // Empty record (no matches between sides), show a neutral hint rather
  // than a misleading "0-0-0".
  if (total === 0) {
    const ariaLabel = `No previous meetings between ${homeCode} and ${awayCode}`;
    return (
      <span
        className={`h2h-pill h2h-pill-empty ${className}`}
        role="note"
        aria-label={ariaLabel}
        data-variant={variant}
      >
        <span className="h2h-pill-label">H2H</span>
        <span className="h2h-pill-empty-text">no previous meetings</span>
      </span>
    );
  }

  const ariaLabel =
    variant === "wide"
      ? `Head-to-head record: ${homeCode} ${homeWins} wins, ${draws} draws, ${awayCode} ${awayWins} wins`
      : `Head-to-head record ${homeCode} ${homeWins}, draws ${draws}, ${awayCode} ${awayWins}`;

  if (variant === "wide") {
    return (
      <span
        className={`h2h-pill h2h-pill-wide ${className}`}
        role="note"
        aria-label={ariaLabel}
        data-variant="wide"
      >
        <span className="h2h-pill-label">H2H</span>
        <span className="h2h-pill-side h2h-pill-home">
          <span className="h2h-pill-code">{homeCode}</span>
          <span className="h2h-pill-count">{homeWins}</span>
          <span className="h2h-pill-suffix">W</span>
        </span>
        <span className="h2h-pill-sep" aria-hidden="true">
          •
        </span>
        <span className="h2h-pill-draw">
          <span className="h2h-pill-count">{draws}</span>
          <span className="h2h-pill-suffix">D</span>
        </span>
        <span className="h2h-pill-sep" aria-hidden="true">
          •
        </span>
        <span className="h2h-pill-side h2h-pill-away">
          <span className="h2h-pill-count">{awayWins}</span>
          <span className="h2h-pill-suffix">W</span>
          <span className="h2h-pill-code">{awayCode}</span>
        </span>
      </span>
    );
  }

  // compact: "H2H ARG 4-3-2 FRA"
  return (
    <span
      className={`h2h-pill h2h-pill-compact ${className}`}
      role="note"
      aria-label={ariaLabel}
      data-variant="compact"
    >
      <span className="h2h-pill-label">H2H</span>
      <span className="h2h-pill-code">{homeCode}</span>
      <span className="h2h-pill-record" data-testid="h2h-record">
        {homeWins}-{draws}-{awayWins}
      </span>
      <span className="h2h-pill-code">{awayCode}</span>
    </span>
  );
}
