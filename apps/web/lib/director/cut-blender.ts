/**
 * Eased camera transitions ("cuts").
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md`:
 *
 *   Camera cuts are not instant. They use a 200-400ms ease (cosine)
 *   on position + lookAt, unless the cut is to `goal-replay` (instant
 *   for impact).
 *
 * The blender owns the *previous* camera state and lerps it toward
 * the *target* camera state over the configured duration. Pure-ish:
 * the only side-effect is a Vector3 mutation on the supplied scratch
 * vectors so we don't allocate per-frame.
 */
import * as THREE from "three";
import type { CameraTarget, DirectorCamName } from "./director-policy.js";

export interface CutBlenderOptions {
  /** Default blend duration in seconds. Default 0.30 (300 ms). */
  blendSec?: number;
  /** Easing function; default cosine in/out. */
  ease?: (t: number) => number;
  /** Cuts to these cams are instant (no blend). Default goal-replay. */
  instantCuts?: Set<DirectorCamName>;
  /** Wall-clock provider. Default `() => performance.now()`. */
  now?: () => number;
}

/** Cosine in/out easing on [0, 1]. */
export function easeInOutCosine(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 0.5 * (1 - Math.cos(Math.PI * t));
}

export class CutBlender {
  private prevPos = new THREE.Vector3();
  private prevLook = new THREE.Vector3();
  private prevFov = 50;
  private startedAt = 0;
  private currentName: DirectorCamName | null = null;
  private blendSec: number;
  private ease: (t: number) => number;
  private instantCuts: Set<DirectorCamName>;
  private now: () => number;
  /** Active target snapshot, captured at cut time so a moving target
   *  doesn't change underneath the blend mid-flight. */
  private target: CameraTarget | null = null;

  constructor(opts: CutBlenderOptions = {}) {
    this.blendSec = opts.blendSec ?? 0.3;
    this.ease = opts.ease ?? easeInOutCosine;
    this.instantCuts = opts.instantCuts ?? new Set<DirectorCamName>(["goal-replay"]);
    this.now = opts.now ?? (() => performance.now());
  }

  /**
   * Notify the blender of the desired target this frame. If the
   * target's name is the same as last frame, the blend continues.
   * If different, a new blend kicks off (instant for the configured
   * cuts, eased otherwise).
   */
  setTarget(target: CameraTarget): void {
    if (!this.currentName) {
      // First call: snap the prev to the target.
      this.prevPos.copy(target.position);
      this.prevLook.copy(target.lookAt);
      this.prevFov = target.fov;
      this.currentName = target.name;
      this.startedAt = this.now() - this.blendSec * 1000; // already done
      this.target = { ...target, position: target.position.clone(), lookAt: target.lookAt.clone() };
      return;
    }
    if (target.name === this.currentName) {
      // Same cam, let the spec's pose updates flow through but keep
      // the blend going if it hasn't finished yet.
      this.target = { ...target, position: target.position.clone(), lookAt: target.lookAt.clone() };
      return;
    }
    // New cam → seed prev with the *current* blended state, then
    // start a new blend.
    const out = { position: new THREE.Vector3(), lookAt: new THREE.Vector3(), fov: this.prevFov, name: target.name };
    this.evaluate(out);
    this.prevPos.copy(out.position);
    this.prevLook.copy(out.lookAt);
    this.prevFov = out.fov;

    this.currentName = target.name;
    this.startedAt = this.now();
    this.target = { ...target, position: target.position.clone(), lookAt: target.lookAt.clone() };

    if (this.instantCuts.has(target.name)) {
      // Instant cut: shrink the blend window to ~0 so subsequent
      // evaluate()s return the target verbatim.
      this.startedAt = this.now() - this.blendSec * 1000;
    }
  }

  /**
   * Compute the blended pose this frame and write it into `out`. Out
   * vectors are reused across calls, pass scratch from the renderer.
   */
  evaluate(out: { position: THREE.Vector3; lookAt: THREE.Vector3; fov: number; name: DirectorCamName }): void {
    if (!this.target) {
      out.position.set(0, 25, 60);
      out.lookAt.set(0, 0, 0);
      out.fov = 50;
      out.name = "broadcast";
      return;
    }
    const elapsed = (this.now() - this.startedAt) / 1000;
    const tt = this.blendSec > 0 ? Math.max(0, Math.min(1, elapsed / this.blendSec)) : 1;
    const k = this.ease(tt);

    out.position.copy(this.prevPos).lerp(this.target.position, k);
    out.lookAt.copy(this.prevLook).lerp(this.target.lookAt, k);
    out.fov = this.prevFov + (this.target.fov - this.prevFov) * k;
    out.name = this.target.name;
  }

  /** Force the next setTarget to snap (no blend). */
  reset(): void {
    this.currentName = null;
    this.target = null;
  }
}
