"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";
import { MatchScoreboard } from "./MatchScoreboard";
import { MatchPanelsStack } from "./MatchPanelsStack";

interface MatchStatsHUDProps {
  store: StoreApi<MatchStore>;
}

/**
 * Thin orchestration shell for the broadcast HUD overlay.
 *
 * Composes the two pieces that together cover the old `MatchStatsHUD`
 * surface:
 *
 *   - `<MatchScoreboard />`, top-centre score pill.
 *   - `<MatchPanelsStack />`, right-edge collapsible cards (scorers,
 *     match stats, substitutions) plus the goal-celebration burst.
 *
 * Sits inside `.match-stats-hud` so the broader pointer-events-none
 * overlay behaviour and z-index stacking from the previous component
 * remain intact. Returns null entirely until `match.init` has arrived
 * so SSR + first-paint don't ship empty scaffolding.
 */
export function MatchStatsHUD({ store }: MatchStatsHUDProps) {
  const init = useStore(store, (s) => s.init);
  if (!init) return null;
  return (
    <div className="match-stats-hud" data-testid="match-stats-hud">
      <MatchScoreboard store={store} />
      <MatchPanelsStack store={store} />
    </div>
  );
}
