"use client";

/**
 * ShareMoleculeEmbed, read-only 3D molecule for the public share landing.
 *
 * Tim asked 2026-05-11 that `/s/<guid>` show the bracket owner's actual
 * predicted molecule alongside the podium card, not just a static
 * preview image. The viewer can rotate / zoom, but cannot edit picks
 * (the share landing renders a stranger's prediction; edits make no
 * sense here).
 *
 * Reuses the canonical `MoleculeScene` so the geometry, gold-path
 * highlight, stage labels, and "vs <opponent>" pills (PR #157) match
 * exactly what the bracket owner sees on `/world-cup-2026/molecule`.
 * We suppress the "Show favourites" toggle and the bracket-edit panel
 * by withholding any local-storage draft — the only bracket the scene
 * ever renders is the persisted one passed via `bracketOverride`.
 *
 * Sizing: the scene fills 100% of its container width and claims at
 * least 70vh on mobile / 600px on desktop. The canvas is intrinsically
 * square-ish via `aspect-ratio`, so portrait phones get a tall column
 * and landscape laptops get a near-square viewport. The molecule's
 * own OrbitControls keep the whole pyramid in frame.
 */

import { useEffect, useState } from "react";

import type { Bracket, Tournament } from "@tournamental/bracket-engine";
import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { MoleculeScene } from "@/components/molecule/MoleculeScene";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";
import {
  enrichTournamentTeams,
  type CanonicalTeamsFile,
} from "@/lib/bracket/enrich";

import "@/components/molecule/molecule.css";

export interface ShareMoleculeEmbedProps {
  readonly bracket: Bracket;
}

/**
 * Build the enriched tournament once per mount. `loadFixtures2026()`
 * returns the same JSON object every call (it's a static import), so
 * we memoise via `useState` to avoid re-running `enrichTournamentTeams`
 * on every re-render.
 */
function useEnrichedTournament(): Tournament {
  const [tournament] = useState<Tournament>(() => {
    const base = loadFixtures2026();
    return enrichTournamentTeams(base, canonicalTeamsRaw as CanonicalTeamsFile);
  });
  return tournament;
}

export function ShareMoleculeEmbed({ bracket }: ShareMoleculeEmbedProps) {
  const tournament = useEnrichedTournament();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      className="vt-share-molecule"
      data-testid="share-molecule-embed"
      aria-label="3D bracket molecule"
    >
      {mounted ? (
        <MoleculeScene
          tournament={tournament}
          bracketOverride={bracket}
          layoutMode="stable"
          /* readOnly hides the panel close + highlight-toggle so the
           * stranger viewing the share landing can't fake-edit the
           * bracket. The auto-select-the-champion behaviour from PR
           * #159 is unchanged. */
          readOnly
        />
      ) : (
        <div className="vt-share-molecule-placeholder" role="status">
          Loading molecule&hellip;
        </div>
      )}
    </div>
  );
}
