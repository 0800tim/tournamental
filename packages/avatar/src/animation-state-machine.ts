/**
 * AvatarAnimationStateMachine — phase-1 fidelity FSM.
 *
 * Per `docs/27a-fidelity-phase1-mocap-rig.md`, every player owns one of
 * these. It bundles together:
 *
 *   - A `THREE.AnimationMixer` bound to a cloned skeleton.
 *   - A clip table of `Map<AnimTag, AnimationClip>` (typically the
 *     output of `loadAnimationLibrary`).
 *   - A small state graph: locomotion (idle/walk/jog/run/sprint) plus
 *     one-shot overrides (pass/kick/header/tackle/fall/celebrate/etc).
 *   - Crossfades between states via `AnimationAction.crossFadeFrom`.
 *
 * The class is intentionally engine-aware (it owns the mixer) but
 * R3F-agnostic — `apps/web` mounts it from inside `useFrame`. Pure-logic
 * pieces (`derive`, `consume`, `phaseRate`) live in stand-alone modules
 * (`locomotion.ts`, the spec's event helpers) so they can be unit-tested
 * without three.js.
 *
 * ## State table
 *
 * | state       | clip name   | loop  | crossfade ms | can interrupt          |
 * | ----------- | ----------- | ----- | ------------ | ---------------------- |
 * | idle        | idle        | loop  | 200          | always                 |
 * | walk        | walk        | loop  | 150          | always                 |
 * | run         | run         | loop  | 100          | always                 |
 * | sprint      | sprint      | loop  | 100          | always                 |
 * | pass        | pass        | once  | 80           | after clip ends        |
 * | kick        | kick        | once  | 80           | after clip ends        |
 * | header      | header      | once  | 80           | after clip ends        |
 * | shoot       | shoot       | once  | 80           | after clip ends        |
 * | tackle      | tackle      | once  | 100          | after clip ends        |
 * | fall        | fall        | once  | 100          | after 1.5s             |
 * | celebrate   | celebrate   | once  | 200          | after 4.0s             |
 * | catch       | catch       | once  | 50           | after clip ends        |
 *
 * The locomotion / one-shot split keeps the table small and matches the
 * existing `apps/web/lib/animation-fsm.ts` model. `consume()` ingests
 * spec events; `derive()` returns the desired target state given current
 * speed + active one-shot; `transitionTo()` runs the crossfade;
 * `tick()` advances the mixer.
 */
import * as THREE from "three";
import type { AnimTag, EventMessage } from "@vtorn/spec";
import { phaseLockRate } from "./locomotion.js";

/** Coarse state buckets. Used internally for transition policy. */
export type AvatarStateKind = "locomotion" | "one_shot";

/** Per-state metadata used to drive transitions. */
export interface AvatarStateConfig {
  tag: AnimTag;
  /** Clip name to look up in the clip table. May differ from tag (e.g. jog→run). */
  clip: AnimTag;
  /** AnimationMixer loop mode. */
  loop: THREE.AnimationActionLoopStyles;
  /** Default crossfade duration in seconds. */
  crossfadeSec: number;
  /** Earliest wall-clock ms (since enter) at which the state may be interrupted. */
  minDwellMs: number;
  /** Hard cap for one-shot states. 0 means "loops forever / runs to clip end". */
  maxDwellMs: number;
  kind: AvatarStateKind;
}

/**
 * Default state table. Exported for tests + so the runtime caller can
 * extend it (e.g. add a vendor-prefixed `x_breakdance` celebration).
 */
export const STATE_TABLE: Record<AnimTag, AvatarStateConfig> = {
  idle: { tag: "idle", clip: "idle", loop: THREE.LoopRepeat, crossfadeSec: 0.20, minDwellMs: 0, maxDwellMs: 0, kind: "locomotion" },
  walk: { tag: "walk", clip: "walk", loop: THREE.LoopRepeat, crossfadeSec: 0.15, minDwellMs: 0, maxDwellMs: 0, kind: "locomotion" },
  run: { tag: "run", clip: "run", loop: THREE.LoopRepeat, crossfadeSec: 0.10, minDwellMs: 0, maxDwellMs: 0, kind: "locomotion" },
  sprint: { tag: "sprint", clip: "sprint", loop: THREE.LoopRepeat, crossfadeSec: 0.10, minDwellMs: 0, maxDwellMs: 0, kind: "locomotion" },
  pass: { tag: "pass", clip: "pass", loop: THREE.LoopOnce, crossfadeSec: 0.08, minDwellMs: 60, maxDwellMs: 400, kind: "one_shot" },
  kick: { tag: "kick", clip: "kick", loop: THREE.LoopOnce, crossfadeSec: 0.08, minDwellMs: 80, maxDwellMs: 500, kind: "one_shot" },
  shoot: { tag: "shoot", clip: "shoot", loop: THREE.LoopOnce, crossfadeSec: 0.08, minDwellMs: 80, maxDwellMs: 600, kind: "one_shot" },
  header: { tag: "header", clip: "header", loop: THREE.LoopOnce, crossfadeSec: 0.08, minDwellMs: 60, maxDwellMs: 500, kind: "one_shot" },
  tackle: { tag: "tackle", clip: "tackle", loop: THREE.LoopOnce, crossfadeSec: 0.10, minDwellMs: 80, maxDwellMs: 800, kind: "one_shot" },
  fall: { tag: "fall", clip: "fall", loop: THREE.LoopOnce, crossfadeSec: 0.10, minDwellMs: 200, maxDwellMs: 1500, kind: "one_shot" },
  celebrate: { tag: "celebrate", clip: "celebrate", loop: THREE.LoopOnce, crossfadeSec: 0.20, minDwellMs: 400, maxDwellMs: 4000, kind: "one_shot" },
  throw: { tag: "throw", clip: "throw", loop: THREE.LoopOnce, crossfadeSec: 0.10, minDwellMs: 80, maxDwellMs: 600, kind: "one_shot" },
  catch: { tag: "catch", clip: "catch", loop: THREE.LoopOnce, crossfadeSec: 0.05, minDwellMs: 60, maxDwellMs: 500, kind: "one_shot" },
  dribble: { tag: "dribble", clip: "dribble", loop: THREE.LoopRepeat, crossfadeSec: 0.10, minDwellMs: 0, maxDwellMs: 0, kind: "locomotion" },
  jump: { tag: "jump", clip: "jump", loop: THREE.LoopOnce, crossfadeSec: 0.08, minDwellMs: 60, maxDwellMs: 600, kind: "one_shot" },
};

/** Speed-based locomotion classifier (m/s → AnimTag). */
export function locomotionForSpeed(speed: number): AnimTag {
  if (speed < 0.3) return "idle";
  if (speed < 1.5) return "walk";
  if (speed < 6.0) return "run";
  return "sprint";
}

/**
 * Pure helper: derive the next desired state from (current state,
 * locomotion-by-speed, pending one-shot, time since last enter).
 *
 *   - If a one-shot is pending and the current state can be interrupted,
 *     return the one-shot.
 *   - If we're in a one-shot whose maxDwell has passed (or it's been
 *     cleared), return the locomotion classification.
 *   - Otherwise stay where we are.
 */
export function deriveNextState(
  current: AnimTag,
  locomotion: AnimTag,
  pendingOneShot: AnimTag | null,
  msSinceEnter: number,
): AnimTag {
  const cfg = STATE_TABLE[current];
  const oneShotActive = cfg.kind === "one_shot";

  if (pendingOneShot) {
    // Honour minDwell on the current state — but only when it's *also* a
    // one-shot (so locomotion always yields immediately to a triggered
    // animation; e.g. running player picks up the kick instantly).
    if (oneShotActive && msSinceEnter < cfg.minDwellMs) return current;
    return pendingOneShot;
  }

  if (oneShotActive) {
    // Run until maxDwell (proxy for "clip ended"). The mixer's actual
    // clip end is checked in `tick()` via the `finished` event listener
    // and turned into a clear; this is the safety net.
    if (cfg.maxDwellMs > 0 && msSinceEnter >= cfg.maxDwellMs) return locomotion;
    return current;
  }

  return locomotion;
}

/**
 * Map an incoming spec event to a target one-shot state for `playerId`,
 * or null if the event doesn't apply to them. Mirrors
 * `apps/web/lib/animation-fsm.ts#eventOneShotFor` but lives here so the
 * package is self-contained.
 */
export function eventToOneShot(playerId: string, ev: EventMessage): AnimTag | null {
  switch (ev.type) {
    case "event.pass":
      return ev.from === playerId ? "pass" : null;
    case "event.shot":
      return ev.player === playerId ? "shoot" : null;
    case "event.tackle":
      if (ev.player === playerId) return "tackle";
      if (ev.victim === playerId) return "fall";
      return null;
    case "event.foul":
      if (ev.player === playerId) return "tackle";
      if (ev.victim === playerId) return "fall";
      return null;
    case "event.goal":
      return ev.player === playerId ? "celebrate" : null;
    case "event.penalty_attempt":
      if (ev.player === playerId) return "shoot";
      if (ev.outcome === "saved" && ev.keeper === playerId) return "catch";
      return null;
    case "event.save":
      return ev.keeper === playerId ? "catch" : null;
    default:
      return null;
  }
}

/** Natural ground-speed of each locomotion clip (m/s). Used by phase-lock. */
export const CLIP_NATURAL_SPEED_M_S: Partial<Record<AnimTag, number>> = {
  idle: 0,
  walk: 1.4,
  run: 4.0,
  sprint: 6.5,
};

export interface AvatarFsmOptions {
  /** The skinned mesh root the mixer drives. */
  root: THREE.Object3D;
  /** Clip table; missing tags fall back to `idle`. */
  clips: Map<AnimTag, THREE.AnimationClip | null>;
  /** Override the table. Useful in tests. */
  table?: Record<AnimTag, AvatarStateConfig>;
  /** Initial state. Defaults to `idle`. */
  initialState?: AnimTag;
  /** Override the speed→locomotion classifier. */
  classify?: (speed: number) => AnimTag;
  /** Override the natural-speed table. */
  naturalSpeed?: Partial<Record<AnimTag, number>>;
  /**
   * Wall-clock provider; `() => performance.now()` in production. The
   * tests inject a fake.
   */
  now?: () => number;
}

/**
 * Per-player FSM. One instance per `<Player>`. Owns its mixer.
 */
export class AvatarAnimationStateMachine {
  readonly mixer: THREE.AnimationMixer;
  private readonly clips: Map<AnimTag, THREE.AnimationClip | null>;
  private readonly table: Record<AnimTag, AvatarStateConfig>;
  private readonly classify: (speed: number) => AnimTag;
  private readonly naturalSpeed: Partial<Record<AnimTag, number>>;
  private readonly now: () => number;
  private actions = new Map<AnimTag, THREE.AnimationAction>();
  private currentTag: AnimTag;
  private currentAction: THREE.AnimationAction | null = null;
  /** Wall-clock ms when the current state was entered. */
  private enteredAt: number;
  /** Pending one-shot queued by `consume()`; cleared once it fires. */
  private pendingOneShot: AnimTag | null = null;
  /** Has the current one-shot's clip naturally finished? */
  private oneShotFinished = false;
  private finishedListener: (e: { action: THREE.AnimationAction }) => void;

  constructor(opts: AvatarFsmOptions) {
    this.mixer = new THREE.AnimationMixer(opts.root);
    this.clips = opts.clips;
    this.table = opts.table ?? STATE_TABLE;
    this.classify = opts.classify ?? locomotionForSpeed;
    this.naturalSpeed = opts.naturalSpeed ?? CLIP_NATURAL_SPEED_M_S;
    this.now = opts.now ?? (() => performance.now());

    this.currentTag = opts.initialState ?? "idle";
    this.enteredAt = this.now();

    this.finishedListener = ({ action }) => {
      // Mark the one-shot finished so the next `tick()` resolves back to
      // locomotion. We don't transition synchronously here — that happens
      // inside `tick()` where the speed input is available.
      if (action === this.currentAction && this.table[this.currentTag].kind === "one_shot") {
        this.oneShotFinished = true;
      }
    };
    this.mixer.addEventListener("finished", this.finishedListener);

    const startAction = this.actionFor(this.currentTag);
    if (startAction) {
      startAction.reset().play();
      this.currentAction = startAction;
    }
  }

  /** Public: current animation tag. */
  get state(): AnimTag {
    return this.currentTag;
  }

  /** Public: ms since the current state was entered. */
  msSinceEnter(): number {
    return this.now() - this.enteredAt;
  }

  /** Lazily create and cache an AnimationAction for a tag. Falls back to idle. */
  private actionFor(tag: AnimTag): THREE.AnimationAction | null {
    const cached = this.actions.get(tag);
    if (cached) return cached;

    const cfg = this.table[tag];
    let clip = this.clips.get(cfg.clip) ?? null;
    if (!clip && tag !== "idle") {
      // Fallback: substitute the idle clip so the mixer always has *something*.
      clip = this.clips.get("idle") ?? null;
    }
    if (!clip) return null;

    const action = this.mixer.clipAction(clip);
    action.setLoop(cfg.loop, cfg.loop === THREE.LoopOnce ? 1 : Infinity);
    action.clampWhenFinished = cfg.loop === THREE.LoopOnce;
    this.actions.set(tag, action);
    return action;
  }

  /**
   * Ingest a spec event for this player. If the event maps to a one-shot
   * (via `eventToOneShot`), it is queued for the next `tick()`.
   *
   * `playerId` is the FSM owner's id; events for other players are
   * ignored cleanly so the caller can pass the whole event stream.
   */
  consume(playerId: string, ev: EventMessage): AnimTag | null {
    const target = eventToOneShot(playerId, ev);
    if (!target) return null;
    this.pendingOneShot = target;
    return target;
  }

  /** Convenience: ingest several events at once. */
  consumeMany(playerId: string, events: EventMessage[]): void {
    for (const ev of events) this.consume(playerId, ev);
  }

  /**
   * Transition to `target`. If we're already there, no-op (except if
   * forceRestart is true, used to restart a one-shot like a 2nd kick).
   */
  transitionTo(target: AnimTag, forceRestart = false): boolean {
    if (target === this.currentTag && !forceRestart) return false;

    const fromCfg = this.table[this.currentTag];
    const toCfg = this.table[target];
    const next = this.actionFor(target);
    if (!next) return false;

    // If we're moving into the same locomotion clip via a different tag
    // skip the crossfade — it's a no-op visually.
    const sameClip = fromCfg.clip === toCfg.clip && fromCfg.kind === toCfg.kind;

    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);

    if (this.currentAction && !sameClip) {
      next.crossFadeFrom(this.currentAction, toCfg.crossfadeSec, false);
    } else if (this.currentAction && sameClip) {
      // Hard-swap: stop the old action, play the new.
      this.currentAction.stop();
    }
    next.play();

    this.currentAction = next;
    this.currentTag = target;
    this.enteredAt = this.now();
    this.oneShotFinished = false;

    if (toCfg.kind === "one_shot") this.pendingOneShot = null;

    return true;
  }

  /**
   * Advance the mixer + run state-machine logic.
   *
   *   `delta`        — seconds since the previous tick (R3F gives this).
   *   `speed`        — m/s magnitude of the player's velocity.
   *
   * Returns the active state after this tick.
   */
  tick(delta: number, speed: number): AnimTag {
    // 1. Decide where we want to be.
    const locomotion = this.classify(speed);

    // If a one-shot's clip naturally finished, treat it as a "no pending
    // one-shot, current done" — derive will fall back to locomotion.
    const pending = this.pendingOneShot;
    if (this.oneShotFinished && !pending) {
      // Forcibly age out maxDwell so derive returns locomotion.
      this.enteredAt = this.now() - (this.table[this.currentTag].maxDwellMs + 1);
    }

    const target = deriveNextState(
      this.currentTag,
      locomotion,
      pending,
      this.msSinceEnter(),
    );

    if (target !== this.currentTag) {
      this.transitionTo(target);
    } else if (pending && pending === target) {
      // Already in the target one-shot. Clear pending so we don't loop.
      this.pendingOneShot = null;
    }

    // 2. Phase-lock locomotion playback rate to the actual ground speed.
    if (this.currentAction) {
      const cfg = this.table[this.currentTag];
      if (cfg.kind === "locomotion") {
        const natural = this.naturalSpeed[cfg.clip] ?? 0;
        const rate = phaseLockRate(speed, natural);
        this.currentAction.setEffectiveTimeScale(rate);
      } else {
        this.currentAction.setEffectiveTimeScale(1);
      }
    }

    // 3. Advance the mixer.
    this.mixer.update(delta);

    return this.currentTag;
  }

  /** Tear down: detach mixer listener, stop actions. Call on unmount. */
  dispose(): void {
    this.mixer.removeEventListener("finished", this.finishedListener);
    for (const action of this.actions.values()) action.stop();
    this.actions.clear();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
  }
}

export type { THREE };
