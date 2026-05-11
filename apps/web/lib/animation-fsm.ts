import type { AnimTag, EventMessage } from "@tournamental/spec";

/**
 * Per-player animation FSM.
 *
 * Locomotion tag is computed from instantaneous speed each frame. One-shot
 * tags (kick/pass/shoot/tackle/celebrate/fall) override the locomotion tag
 * for a fixed duration after the triggering event arrives, then fall back.
 *
 * Doc 04 thresholds (m/s):
 *   speed < 0.5            → idle
 *   0.5 ≤ speed < 2.5      → walk
 *   2.5 ≤ speed < 5        → run
 *   speed ≥ 5              → sprint
 */
export const SPEED_THRESHOLDS = {
  walk: 0.5,
  run: 2.5,
  sprint: 5.0,
} as const;

/** Default one-shot durations in milliseconds. */
export const ONE_SHOT_MS: Partial<Record<AnimTag, number>> = {
  pass: 400,
  kick: 400,
  shoot: 600,
  tackle: 800,
  fall: 1000,
  celebrate: 3000,
  header: 500,
  throw: 500,
  catch: 500,
  jump: 500,
  dribble: 600,
};

/**
 * Pure helper: classify a speed into a locomotion tag. Exported for unit
 * tests so the boundaries don't drift silently.
 */
export function locomotionFor(speed: number): AnimTag {
  if (speed < SPEED_THRESHOLDS.walk) return "idle";
  if (speed < SPEED_THRESHOLDS.run) return "walk";
  if (speed < SPEED_THRESHOLDS.sprint) return "run";
  return "sprint";
}

export interface OneShot {
  tag: AnimTag;
  /** Wall-clock ms when the one-shot started. */
  startedAt: number;
  /** Total duration in ms; 0 means "sticky until cleared". */
  durationMs: number;
}

export interface FsmState {
  locomotion: AnimTag;
  oneShot: OneShot | null;
}

export const INITIAL_FSM_STATE: FsmState = { locomotion: "idle", oneShot: null };

/**
 * Map an incoming event into a one-shot for the affected player, or null if
 * the event doesn't trigger an animation for them.
 *
 * Per doc 04:
 *   event.pass(self)            → pass
 *   event.shot(self)            → shoot
 *   event.tackle(player=self)   → tackle
 *   event.tackle(victim=self)   → fall
 *   event.foul(player=self)     → tackle (aggressor)
 *   event.foul(victim=self)     → fall
 *   event.goal(scorer=self)     → celebrate (sticky-ish, 3s)
 *   event.penalty_attempt(self) → shoot
 */
export function eventOneShotFor(playerId: string, ev: EventMessage, now: number): OneShot | null {
  const make = (tag: AnimTag, durationMs = ONE_SHOT_MS[tag] ?? 500) => ({
    tag,
    startedAt: now,
    durationMs,
  });

  switch (ev.type) {
    case "event.pass":
      if (ev.from === playerId) return make("pass");
      return null;
    case "event.shot":
      if (ev.player === playerId) return make("shoot");
      return null;
    case "event.tackle":
      if (ev.player === playerId) return make("tackle");
      if (ev.victim === playerId) return make("fall");
      return null;
    case "event.foul":
      if (ev.player === playerId) return make("tackle");
      if (ev.victim === playerId) return make("fall");
      return null;
    case "event.goal":
      if (ev.player === playerId) return make("celebrate");
      return null;
    case "event.penalty_attempt":
      if (ev.player === playerId) return make("shoot");
      if (ev.outcome === "saved" && ev.keeper === playerId) return make("catch");
      return null;
    default:
      return null;
  }
}

/**
 * Resolve the active animation tag at time `now` given the FSM state.
 * Locomotion is the default; an unexpired one-shot wins.
 */
export function activeTag(state: FsmState, now: number): AnimTag {
  if (state.oneShot && now < state.oneShot.startedAt + state.oneShot.durationMs) {
    return state.oneShot.tag;
  }
  return state.locomotion;
}

/**
 * Step the FSM forward. Pure: returns the next state without mutating.
 *
 *   speed      , instantaneous speed in spec units/sec.
 *   newEvents  , events for this player observed since the last step.
 *   now        , wall-clock ms reference (use Date.now() in production).
 */
export function stepFsm(
  prev: FsmState,
  speed: number,
  newEvents: EventMessage[],
  playerId: string,
  now: number,
): FsmState {
  const locomotion = locomotionFor(speed);

  // Choose the highest-priority one-shot that fires this step. We iterate in
  // event order; later events overwrite earlier ones (e.g. a shot that
  // becomes a goal celebrates rather than continues shooting).
  let oneShot: OneShot | null = prev.oneShot;
  if (oneShot && now >= oneShot.startedAt + oneShot.durationMs) oneShot = null;

  for (const ev of newEvents) {
    const candidate = eventOneShotFor(playerId, ev, now);
    if (candidate) oneShot = candidate;
  }

  return { locomotion, oneShot };
}
