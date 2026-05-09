/**
 * Phase-4 replay-HUD bus.
 *
 * The auto-director (Phase 2) writes to `camera.userData` per frame.
 * The Phase-4 ReplayHUD overlay needs a sibling subscription channel
 * so a DOM-side React tree can fade the "REPLAY" badge in/out
 * without polling Three internals.
 *
 * Pattern follows `crowdEnergyBus` — module-level singleton.
 */
import type { DirectorCamName } from "./director-policy";

export interface ReplayHudState {
  cam: DirectorCamName;
  slowMoRate: number;
  /** Real-time seconds since the active phase was entered. */
  secsSinceCut: number;
  /** Configured replay-window length (seconds). */
  replaySec: number;
  scorerId: string | null;
  scorerName: string | null;
  scorerTeam: string | null;
  goalAtMatchSec: number;
  scoreHome: number;
  scoreAway: number;
}

type Subscriber = (state: ReplayHudState) => void;

const subs: Set<Subscriber> = new Set();

const initial: ReplayHudState = {
  cam: "broadcast",
  slowMoRate: 1,
  secsSinceCut: 0,
  replaySec: 4,
  scorerId: null,
  scorerName: null,
  scorerTeam: null,
  goalAtMatchSec: 0,
  scoreHome: 0,
  scoreAway: 0,
};

let last: ReplayHudState = { ...initial };

export const replayHudBus = {
  publish(next: Partial<ReplayHudState>): void {
    const merged: ReplayHudState = { ...last, ...next };
    last = merged;
    for (const fn of subs) fn(merged);
  },
  subscribe(cb: Subscriber): () => void {
    subs.add(cb);
    cb(last);
    return () => {
      subs.delete(cb);
    };
  },
  current(): ReplayHudState {
    return last;
  },
  reset(): void {
    last = { ...initial };
    subs.clear();
  },
};

/** True while the goal-replay or celebration cuts are active. */
export function replayBadgeVisible(state: ReplayHudState): boolean {
  return state.cam === "goal-replay" || state.cam === "player-track";
}

/** Scorer plate fades in over 0.4 s after the cut. */
export function scorerOpacity(state: ReplayHudState): number {
  if (!replayBadgeVisible(state)) return 0;
  return Math.max(0, Math.min(1, state.secsSinceCut / 0.4));
}

/** Format slow-mo rate as e.g. "0.25×". Returns null at normal speed. */
export function slowMoLabel(rate: number): string | null {
  if (rate >= 0.999) return null;
  const r = Math.round(rate * 100) / 100;
  return `${r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×`;
}
