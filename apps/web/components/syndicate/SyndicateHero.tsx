/**
 * SyndicateHero, big-feeling pool intro at the top of the syndicate
 * landing. Hosts the "JOIN THIS POOL" gold CTA.
 *
 * Vibe palette is per-syndicate; we set CSS variables on the root so
 * the radial-gradient background paints from the syndicate's own
 * colours. No new global hues introduced, palette values come from
 * `MockSyndicate.vibePalette`.
 */

import type { CSSProperties } from "react";

import { pickAvatar } from "@/lib/mock/avatar";
import type { MockSyndicate } from "@/lib/mock/syndicate";

import "./syndicate.css";

export interface SyndicateHeroProps {
  readonly syndicate: MockSyndicate;
  readonly onJoin?: () => void;
  readonly ctaLabel?: string;
}

export function SyndicateHero({
  syndicate,
  onJoin,
  ctaLabel = "Join this pool",
}: SyndicateHeroProps) {
  const style = {
    "--vt-syn-primary": syndicate.vibePalette.primary,
    "--vt-syn-accent": syndicate.vibePalette.accent,
  } as CSSProperties;

  return (
    <header className="vt-syn-hero" style={style}>
      <div className="vt-syn-hero-grid">
        <div className="vt-syn-hero-meta">
          <span className="vt-syn-hero-eyebrow">
            <span aria-hidden="true">🏆</span> Syndicate · {syndicate.region}
          </span>
          <h1 className="vt-syn-hero-title">{syndicate.name}</h1>
          <p className="vt-syn-hero-tagline">{syndicate.tagline}</p>
          <div className="vt-syn-hero-owner">
            <img
              className="vt-syn-owner-avatar"
              src={pickAvatar(syndicate.ownerHandle)}
              alt=""
              width={28}
              height={28}
            />
            <span>
              Owned by <strong>{syndicate.ownerHandle}</strong>
            </span>
          </div>
          <div className="vt-syn-hero-stats">
            <div>
              <strong>{syndicate.memberCount.toLocaleString()}</strong>
              members
            </div>
            <div>
              <strong>{syndicate.picksPlaced.toLocaleString()}</strong>
              picks placed
            </div>
            <div>
              <strong>{syndicate.daysToKickoff}</strong>
              days to kickoff
            </div>
          </div>
        </div>
        <div>
          <button
            type="button"
            className="vt-syn-hero-cta"
            onClick={onJoin}
            aria-label={`${ctaLabel}, ${syndicate.name}`}
          >
            {ctaLabel} →
          </button>
        </div>
      </div>
    </header>
  );
}
