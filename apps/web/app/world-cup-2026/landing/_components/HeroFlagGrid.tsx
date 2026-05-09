/**
 * Animated 48-flag background grid for the hero. Low-opacity, slow drift,
 * no JS animation loops (pure CSS). Each flag uses the existing TeamFlag
 * component with sparkle on. Flag SVGs lazy-load so they don't block LCP.
 */

import { TeamFlag } from "@/components/bracket/TeamFlag";
import { allTeams } from "../_lib/groups";

export function HeroFlagGrid() {
  const teams = allTeams();
  return (
    <div className="wc-hero-bg" aria-hidden="true">
      {teams.map((t, i) => (
        <span
          key={t.code}
          className="wc-hero-bg-cell"
          style={{ ["--wc-delay" as string]: `${(i * 0.4) % 6}s` }}
        >
          <TeamFlag
            code={t.code}
            name={t.name}
            accentColor={t.kit.primary}
            size="md"
            sparkle
          />
        </span>
      ))}
    </div>
  );
}
