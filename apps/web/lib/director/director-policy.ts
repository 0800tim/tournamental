/**
 * Auto-director policy, pure logic.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md` § "Director
 * policy":
 *
 *   on event:
 *     case Goal:
 *       pause live → record replay buffer (last 8s)
 *       cut to behind-goal cam, play replay buffer at 0.25× with
 *         goal-replay post FX
 *       after replay: cut to player-track on scorer for celebration
 *       after 5s celebration: ease back to broadcast
 *       fire commentary cue: replay-window-start + replay-window-end
 *     case Penalty taken:
 *       cut to behind-goal cam 1s before kick, hold to outcome
 *     case Shot blocked / saved:
 *       no cut, broadcast continues
 *     case Substitution:
 *       ribbon banner overlay (HUD), no cam change
 *
 * The implementation is a small finite-state machine that takes
 * events + the current scene clock and returns a description of the
 * camera the director wants this frame.
 */
import * as THREE from "three";
import type { EventMessage } from "@vtorn/spec";

export type DirectorCamName =
  | "broadcast"
  | "behind-goal"
  | "player-track"
  | "goal-replay";

export interface CameraTarget {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
  name: DirectorCamName;
  /** Optional post-FX intensity (Phase-3 hookup). */
  fx?: { vignette?: number; motionBlur?: number; slowMoRate?: number };
}

/**
 * Internal director state, exposed only for testability.
 */
export type DirectorPhase =
  | { kind: "live"; cam: "broadcast" | "behind-goal" }
  | {
      kind: "goal-sequence";
      enteredAt: number;
      step: "replay" | "celebration" | "easing-back";
      scorerId: string;
      goalEventTime: number;
    }
  | { kind: "penalty"; cam: "behind-goal"; enteredAt: number };

export interface DirectorPolicyOptions {
  /** Scene clock provider, `() => performance.now()` in production. */
  now?: () => number;
  /** Replay dwell time in real seconds. Default 4. */
  replaySec?: number;
  /** Celebration dwell time in real seconds. Default 5. */
  celebrationSec?: number;
  /** Pre-roll (lead time) for penalty cam (real seconds). Default 1. */
  penaltyPreRollSec?: number;
  /** Cut blend duration (real seconds). Default 0.3. */
  cutBlendSec?: number;
}

export interface DirectorObservers {
  /**
   * Called when a goal sequence starts. The replay buffer should be
   * snapshotted here so the renderer can play back the last
   * `replayBufferSec` seconds at the configured slow-mo rate.
   */
  onReplayWindowStart?(scorerId: string, goalEventTime: number): void;
  onReplayWindowEnd?(): void;
}

/**
 * Director policy state machine.
 *
 * Usage:
 *
 *   const dir = new DirectorPolicy({ now: () => performance.now() });
 *   ...
 *   dir.consume(event);             // call once per spec event
 *   const phase = dir.tick();       // call once per render frame; returns
 *                                   // the active phase + cam name
 */
export class DirectorPolicy {
  private now: () => number;
  private replaySec: number;
  private celebrationSec: number;
  private penaltyPreRollSec: number;
  /** Note: kept for future use by `cut-blender`; not consumed here. */
  private _cutBlendSec: number;
  private phase: DirectorPhase = { kind: "live", cam: "broadcast" };
  private observers: DirectorObservers;
  private cutAt = 0;

  constructor(opts: DirectorPolicyOptions = {}, observers: DirectorObservers = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.replaySec = opts.replaySec ?? 4;
    this.celebrationSec = opts.celebrationSec ?? 5;
    this.penaltyPreRollSec = opts.penaltyPreRollSec ?? 1;
    this._cutBlendSec = opts.cutBlendSec ?? 0.3;
    this.observers = observers;
  }

  /** Public read of the current phase (testing + debug). */
  getPhase(): DirectorPhase {
    return this.phase;
  }

  /** Active camera right now. */
  activeCam(): DirectorCamName {
    if (this.phase.kind === "live") return this.phase.cam;
    if (this.phase.kind === "penalty") return this.phase.cam;
    if (this.phase.step === "replay") return "goal-replay";
    if (this.phase.step === "celebration") return "player-track";
    return "broadcast";
  }

  /** When the active phase was entered (ms, scene clock). */
  cutAtMs(): number {
    return this.cutAt;
  }

  /** Real-time seconds since the last cut. */
  secsSinceCut(): number {
    return (this.now() - this.cutAt) / 1000;
  }

  /**
   * Ingest a spec event. The director updates its phase based on the
   * event type. Idempotent, repeat events of the same type during a
   * goal sequence are ignored (we don't want 10 simultaneous goals to
   * stack 10 replays).
   */
  consume(event: EventMessage): void {
    switch (event.type) {
      case "event.goal":
        this.enterGoalSequence(event.player, event.t);
        break;
      case "event.penalty_attempt":
        // The director cuts to behind-goal `penaltyPreRollSec` before
        // the actual kick, but in our model we cut when the event
        // arrives (the producer should send the event ~1s ahead of the
        // kick already) and hold until outcome.
        this.enterPenalty();
        break;
      // shot/save/substitution: no cam change.
      default:
        break;
    }
  }

  /**
   * Tick the director, call once per render frame. Updates the
   * phase if dwell timers have elapsed. Returns the active cam name
   * so the renderer can pick which `useCamera()` hook to read from.
   */
  tick(): DirectorCamName {
    const since = this.secsSinceCut();

    if (this.phase.kind === "goal-sequence") {
      if (this.phase.step === "replay" && since >= this.replaySec) {
        this.transitionTo({
          kind: "goal-sequence",
          enteredAt: this.now(),
          step: "celebration",
          scorerId: this.phase.scorerId,
          goalEventTime: this.phase.goalEventTime,
        });
        this.observers.onReplayWindowEnd?.();
      } else if (this.phase.step === "celebration" && since >= this.celebrationSec) {
        this.transitionTo({
          kind: "goal-sequence",
          enteredAt: this.now(),
          step: "easing-back",
          scorerId: this.phase.scorerId,
          goalEventTime: this.phase.goalEventTime,
        });
      } else if (this.phase.step === "easing-back" && since >= 1) {
        this.transitionTo({ kind: "live", cam: "broadcast" });
      }
    } else if (this.phase.kind === "penalty" && since >= 6) {
      // Failsafe: if no penalty outcome event arrives within 6s, ease
      // back to broadcast.
      this.transitionTo({ kind: "live", cam: "broadcast" });
    }

    return this.activeCam();
  }

  /**
   * Currently-tracked scorer id, if we're in the player-track step of
   * a goal sequence. Used by `<Director>` to wire `<player-track-cam>`
   * to the right player.
   */
  scorerId(): string | null {
    return this.phase.kind === "goal-sequence" ? this.phase.scorerId : null;
  }

  /**
   * Slow-mo rate the renderer should use this frame. 0.25 during the
   * goal-replay step; 1 otherwise.
   */
  slowMoRate(): number {
    return this.phase.kind === "goal-sequence" && this.phase.step === "replay"
      ? 0.25
      : 1;
  }

  private enterGoalSequence(scorerId: string, goalEventTime: number): void {
    if (this.phase.kind === "goal-sequence") return;
    this.transitionTo({
      kind: "goal-sequence",
      enteredAt: this.now(),
      step: "replay",
      scorerId,
      goalEventTime,
    });
    this.observers.onReplayWindowStart?.(scorerId, goalEventTime);
  }

  private enterPenalty(): void {
    if (this.phase.kind === "penalty") return;
    this.transitionTo({
      kind: "penalty",
      cam: "behind-goal",
      enteredAt: this.now(),
    });
  }

  private transitionTo(next: DirectorPhase): void {
    this.phase = next;
    this.cutAt = this.now();
  }
}

/**
 * Convenience: replay a list of events through a fresh
 * `DirectorPolicy` and return the cut sequence (in order).
 *
 * `simulateMs(eventLog, ms)` is unit-testable: pass an event log + a
 * timeline of "tick at this clock" values, get back the camera names
 * that were active at each tick.
 */
export function simulateDirectorTimeline(
  events: EventMessage[],
  ticks: number[],
  options: DirectorPolicyOptions = {},
): DirectorCamName[] {
  let now = 0;
  const dir = new DirectorPolicy({ ...options, now: () => now });
  const out: DirectorCamName[] = [];
  let evIdx = 0;
  for (const t of ticks) {
    while (evIdx < events.length && events[evIdx].t <= t) {
      now = events[evIdx].t;
      dir.consume(events[evIdx]);
      evIdx++;
    }
    now = t;
    out.push(dir.tick());
  }
  return out;
}
