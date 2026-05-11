/**
 * SyndicateTrophyShelf — "if we ran the tournament today" virtual
 * trophies: the pool's most-popular champion / runner-up / third.
 *
 * Pure visual: three cup tiles (gold/silver/bronze) with the team's
 * flag, code, and the share-of-pool that agrees.
 */

import "./syndicate.css";

export interface VirtualPodiumPlace {
  /** "Champion" / "Runner-up" / "Third". */
  readonly label: string;
  /** Team code, e.g. "ARG". */
  readonly team: string;
  /** Emoji flag for the team. */
  readonly flag: string;
  /** Percent of the pool whose bracket has this team in this slot. */
  readonly poolShare: number;
}

export interface SyndicateTrophyShelfProps {
  readonly title?: string;
  readonly podium: readonly [VirtualPodiumPlace, VirtualPodiumPlace, VirtualPodiumPlace];
}

const DEFAULT_PODIUM: readonly [VirtualPodiumPlace, VirtualPodiumPlace, VirtualPodiumPlace] = [
  { label: "Champion", team: "ARG", flag: "🇦🇷", poolShare: 47 },
  { label: "Runner-up", team: "FRA", flag: "🇫🇷", poolShare: 22 },
  { label: "Third", team: "BRA", flag: "🇧🇷", poolShare: 18 },
];

export function SyndicateTrophyShelf({
  title = "If we ran the tournament today",
  podium = DEFAULT_PODIUM,
}: SyndicateTrophyShelfProps) {
  const medals = ["gold", "silver", "bronze"] as const;
  return (
    <section className="vt-syn-section">
      <h3 className="vt-syn-section-title">
        {title}
        <span className="vt-syn-section-title-meta">Pool consensus</span>
      </h3>
      <div className="vt-syn-trophies" role="list">
        {podium.map((p, idx) => (
          <article
            className="vt-syn-trophy"
            data-medal={medals[idx]}
            key={p.label}
            role="listitem"
          >
            <span className="vt-syn-trophy-cup" aria-hidden="true">
              🏆
            </span>
            <span className="vt-syn-trophy-label">{p.label}</span>
            <span className="vt-syn-trophy-flag" aria-hidden="true">
              {p.flag}
            </span>
            <span className="vt-syn-trophy-team">{p.team}</span>
            <span className="vt-syn-trophy-pct">
              {p.poolShare}% of this pool agrees
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
