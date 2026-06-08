/**
 * Shared anchor-mode <-> weight reverse mapping.
 *
 * Extracted from BrowserSwarm.tsx so the /run/bots list + detail pages
 * can restore the user's saved anchor mode from the persisted
 * `swarm_state.anchor_weight` and apply the SAME anchor the swarm was
 * generated with. Keeping this in one place means the list, detail, and
 * builder surfaces never disagree on what a stored weight means.
 */

import {
  ANCHOR_WEIGHT_BY_MODE,
  DEFAULT_ANCHOR_MODE,
  type AnchorMode,
} from "./anchor";

/**
 * Reverse-map a stored anchor_weight (0 / 0.4 / 0.75 / 1) back to its
 * AnchorMode enum value. Anything in between snaps to the closest preset
 * so the slider is robust to future tweaks of the weight constants.
 */
export function modeFromWeight(weight: number): AnchorMode {
  const entries = Object.entries(ANCHOR_WEIGHT_BY_MODE) as ReadonlyArray<
    [AnchorMode, number]
  >;
  let best: AnchorMode = DEFAULT_ANCHOR_MODE;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [mode, w] of entries) {
    const d = Math.abs(w - weight);
    if (d < bestDist) {
      bestDist = d;
      best = mode;
    }
  }
  return best;
}
