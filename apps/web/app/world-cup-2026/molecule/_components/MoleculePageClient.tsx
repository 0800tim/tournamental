"use client";

/**
 * MoleculePageClient, the client-side wrapper that owns the
 * "your picks vs consensus favourites" toggle, plus the page header.
 *
 * Why split it out from page.tsx: the page.tsx is a server component
 * (so we can ship OG meta + dynamic params). State + window/document
 * access has to be in a client child.
 */

import { useEffect, useMemo, useState } from "react";

import type { Bracket, Tournament } from "@tournamental/bracket-engine";

import { MoleculeCaptureButton } from "@/components/molecule/MoleculeCaptureButton";
import { MoleculeScene } from "@/components/molecule/MoleculeScene";
import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { DraftPreviewBanner } from "@/components/mock/DraftPreviewBanner";
import { useMoleculeCaptureInput } from "@/lib/molecule/use-capture-input";
import {
  buildOddsConsensusBracket,
  fetchOddsSnapshotMap,
} from "@/lib/molecule/odds-consensus";
import type { MatchOdds } from "@/lib/odds/types";
import { mockLeaderboardMembers, DEMO_MATCHES_PLAYED } from "@/lib/mock/leaderboard";

import "@/components/molecule/molecule.css";

export interface MoleculePageClientProps {
  readonly tournament: Tournament;
}

type Mode = "mine" | "consensus";

export function MoleculePageClient({ tournament }: MoleculePageClientProps) {
  const [mode, setMode] = useState<Mode>("mine");
  const [mounted, setMounted] = useState(false);
  const [oddsByMatch, setOddsByMatch] = useState<Map<string, MatchOdds> | null>(
    null,
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Pull the odds snapshot once on mount. The endpoint has its own
  // mock fallback so this resolves with a usable map either way.
  // `null` means "not loaded yet"; an empty Map means "loaded, but no
  // live odds available — fall back to world-rank proxy inside the
  // builder".
  useEffect(() => {
    const ac = new AbortController();
    fetchOddsSnapshotMap(fetch, ac.signal).then((m) => {
      if (!ac.signal.aborted) setOddsByMatch(m);
    });
    return () => ac.abort();
  }, []);

  // Build the global-prediction Bracket from the snapshot. The
  // builder mirrors BracketBuilder.handleAutoPick: highest-probability
  // outcome per match, world rank for group tiebreakers, stage-by-stage
  // re-cascade through the knockouts.
  const consensus: Bracket | null = useMemo(() => {
    if (!oddsByMatch) return null;
    return buildOddsConsensusBracket(tournament, oddsByMatch);
  }, [tournament, oddsByMatch]);

  // While the snapshot is still loading we keep the toggle visible
  // but disable it — flipping to consensus before consensus is ready
  // would render an empty molecule.
  const consensusReady = consensus !== null;
  const override = mode === "consensus" && consensus ? consensus : null;

  // Mock pundit picks shown in the side panel. Deterministic across
  // renders so the snapshot stays stable. Filtered to badge="pundit"
  // by the Leaderboard component.
  const pundits = useMemo(() => mockLeaderboardMembers(null, 50), []);

  // Capture-and-share overlay: derive the user's prediction-card payload
  // (champion + path + share guid) so the floating button can POST it
  // alongside the captured WebGL pose. Hidden in consensus mode — that
  // view is the rank-based proxy, not the user's own picks, so sharing
  // it would mislabel the share-card. Hook is also no-op until the
  // bracket hydrates from localStorage on the client.
  const capture = useMoleculeCaptureInput({ tournament });
  const captureHidden = mode !== "mine" || !capture.ready || !capture.hasChampion;

  return (
    <div className="molecule-page" data-compact-header="true">
      {/* v4: header is compact (single-line title) so the canvas claims
       * more vertical space. The mode subtitle moves to a small caption
       * pill on the right rail, alongside the toggle. */}
      <header className="molecule-page-header molecule-page-header--compact">
        <h1 className="molecule-page-title">Molecule</h1>
        <div className="molecule-page-header-right">
          <span
            className="molecule-page-mode-caption"
            data-mode={mode}
            aria-live="polite"
          >
            {mode === "mine" ? "Your picks" : "Global prediction"}
          </span>
          <button
            type="button"
            className="molecule-page-toggle"
            data-active={mode === "consensus" ? "true" : "false"}
            onClick={() =>
              setMode((m) => (m === "mine" ? "consensus" : "mine"))
            }
            aria-pressed={mode === "consensus"}
            disabled={mode === "mine" && !consensusReady}
            aria-busy={mode === "mine" && !consensusReady}
            title={
              mode === "mine" && !consensusReady
                ? "Loading global prediction…"
                : undefined
            }
          >
            🌍{" "}
            {mode === "mine"
              ? consensusReady
                ? "Show global prediction"
                : "Loading prediction…"
              : "Back to my picks"}
          </button>
        </div>
      </header>
      {mounted ? (
        <div className="molecule-page-canvas-pane">
          <MoleculeScene
            tournament={tournament}
            bracketOverride={override}
            layoutMode={mode === "consensus" ? "rank-sorted" : "stable"}
          />
          {/* Capture & share floats over the top-right of the canvas.
           * It's a sibling of MoleculeScene so we don't have to touch
           * the scene's internals — `.molecule-page-canvas-pane` is the
           * shared positioning context. */}
          <MoleculeCaptureButton
            shareGuid={capture.shareGuid}
            handle={capture.handle}
            input={capture.captureInput}
            hidden={captureHidden}
          />
        </div>
      ) : (
        <div style={{ height: "calc(100vh - 96px)", display: "grid", placeItems: "center", color: "#cdd5e7" }}>
          Loading molecule…
        </div>
      )}
      <aside className="molecule-pundits-panel" aria-label="Pundit predictions">
        <DraftPreviewBanner />
        <Leaderboard
          title="Pundit predictions"
          members={pundits}
          badgeFilter="pundit"
          density="compact"
          showMovementColumn={false}
          showCountryColumn={false}
          showSparkline={false}
          tabs={[]}
          matchesPlayed={DEMO_MATCHES_PLAYED}
        />
      </aside>
    </div>
  );
}
