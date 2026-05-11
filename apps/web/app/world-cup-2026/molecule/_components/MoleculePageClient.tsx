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
import { mockLeaderboardMembers } from "@/lib/mock/leaderboard";

import "@/components/molecule/molecule.css";

export interface MoleculePageClientProps {
  readonly tournament: Tournament;
}

type Mode = "mine" | "consensus";

/**
 * Build a "consensus / favourite per match" bracket on the fly. We don't
 * have a server-side consensus dataset for v1, so this is the simplest
 * defensible thing: predict every group outcome and every knockout
 * outcome based on FIFA rank (lower = better). Whoever's ranked higher
 * wins; draws are picked when ranks are within 3 of each other (the
 * "competitive" band).
 *
 * This matches the same fallback the BracketBuilder uses when no live
 * odds are available, so the molecule lines up with what the user would
 * see if they hit "Auto-pick" with no odds source.
 *
 * Note: this is deliberately *not* a Polymarket consensus, that'd
 * require an API call and a non-trivial mapping. Tim asked for "your
 * picks vs consensus / odds-favourite"; the rank-based proxy is honest
 * about being a proxy, and a v2 enhancement can swap it out without
 * touching this component.
 */
function buildFavouriteBracket(tournament: Tournament): Bracket {
  const rankOf = (code: string): number =>
    tournament.teams.find((t) => t.id === code)?.fifa_rank ?? 99;
  const ts = new Date().toISOString();

  const matchPredictions: Bracket["matchPredictions"] = {};
  for (const f of tournament.group_fixtures) {
    const g = tournament.groups.find((x) => x.id === f.group_id);
    if (!g) continue;
    const home = g.team_ids[f.home_idx];
    const away = g.team_ids[f.away_idx];
    if (!home || !away) continue;
    const hr = rankOf(home);
    const ar = rankOf(away);
    let outcome: "home_win" | "draw" | "away_win";
    if (Math.abs(hr - ar) <= 3) outcome = "draw";
    else outcome = hr < ar ? "home_win" : "away_win";
    const id = String(f.match_no);
    matchPredictions[id] = {
      matchId: id,
      outcome,
      lockedAt: ts,
    };
  }

  // Group tiebreakers: rank-sort each group. The cascade-bridge needs
  // these so every group resolves a finishing order, which lets the
  // knockout slots populate.
  const groupTiebreakers: Bracket["groupTiebreakers"] = {};
  for (const g of tournament.groups) {
    if (g.team_ids.length !== 4) continue;
    const ranked = [...g.team_ids].sort((a, b) => rankOf(a) - rankOf(b)) as
      [string, string, string, string];
    groupTiebreakers[g.id] = {
      groupId: g.id,
      rankedTeams: ranked,
      setAt: ts,
    };
  }

  // Knockouts: we leave knockoutPredictions empty here. The MoleculeScene
  // runs the same multi-pass cascade resolver and will produce slot
  // occupants, but no "winners", which means the knockout bonds will
  // appear without a champion. To get a meaningful champion in
  // consensus mode we'd need to pick winners; do that here using the
  // same rank-based tiebreak.
  //
  // We approximate by picking knockoutPredictions iteratively after
  // running an initial cascade. Doing the full multi-pass thing inside
  // here would be a near-duplicate of MoleculeScene's resolveCascade -
  // simpler v1 approach: trust the cascade to walk in order and pick
  // home_win for every knockout (the cascade slots are then determined
  // by the group rankings, and any knockout where home is ranked
  // higher than away will be a "favourite picks home" result).
  //
  // BracketBuilder does the per-stage iterative resolve. For consensus
  // mode in v1 we accept a partial molecule (group bonds present;
  // knockout chain visible but champion may be null). When/if we want
  // a polished consensus mode, we copy the per-stage loop from
  // BracketBuilder.handleAutoPick.
  const knockoutPredictions: Bracket["knockoutPredictions"] = {};
  for (const k of tournament.knockouts) {
    knockoutPredictions[k.id] = {
      matchId: k.id,
      outcome: "home_win", // cascade will resolve "home" to the rank-favoured side
      lockedAt: ts,
    };
  }

  return {
    bracketId: "consensus-rank-v1",
    matchPredictions,
    groupTiebreakers,
    knockoutPredictions,
    version: 2,
  };
}

export function MoleculePageClient({ tournament }: MoleculePageClientProps) {
  const [mode, setMode] = useState<Mode>("mine");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const consensus = useMemo(
    () => buildFavouriteBracket(tournament),
    [tournament],
  );

  const override = mode === "consensus" ? consensus : null;

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
            {mode === "mine" ? "Your picks" : "Rank favourites"}
          </span>
          <button
            type="button"
            className="molecule-page-toggle"
            data-active={mode === "consensus" ? "true" : "false"}
            onClick={() =>
              setMode((m) => (m === "mine" ? "consensus" : "mine"))
            }
            aria-pressed={mode === "consensus"}
          >
            🎲 {mode === "mine" ? "Show favourites" : "Back to my picks"}
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
        />
      </aside>
    </div>
  );
}
