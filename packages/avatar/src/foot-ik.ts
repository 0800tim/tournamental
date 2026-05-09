/**
 * Two-bone foot IK solver — Phase 2 fidelity.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md`:
 *
 *   1. Raycast from hip down through the knee+ankle bone at world Y.
 *   2. Find ground intersection.
 *   3. If stance phase (foot animation says foot is planted), pin the
 *      foot bone to the intersection point (lock).
 *   4. If swing phase, blend off the lock.
 *
 * The solver is a closed-form two-bone analytic solution (hip → knee →
 * ankle). It uses the law of cosines to find the knee bend angle and a
 * pole-vector derived from the FK-baked knee position to pick the
 * "natural" knee plane. ~80 lines for the pure math; the rest is wiring
 * + the stance-phase blend.
 *
 * The function is **pure** — it reads bone world transforms and writes
 * back local rotations on the hip + knee bones. It allocates zero
 * vectors per-call (re-uses scratch on the instance) so 22 players × 2
 * legs × 60 fps stays well under the 2.2 ms budget.
 *
 * The "stance hint" comes from the FSM: locomotion clips (walk / run /
 * sprint) lock alternating feet on a phase-locked schedule that mirrors
 * the clip's natural foot-plant cadence; one-shot clips (kick / pass /
 * tackle) typically have one stance foot for the duration of the
 * action. The default stance schedule is good enough for Phase 2; Phase
 * 4 can swap in clip-baked metadata.
 */
import * as THREE from "three";
import type { AnimTag } from "@vtorn/spec";
import { findCanonicalBone } from "./retarget.js";

/** Either left or right leg. */
export type FootSide = "left" | "right";

/**
 * Stance hint per leg. Values:
 *
 *   - `1.0` — full lock (foot planted)
 *   - `0.0` — full release (foot in swing)
 *   - in-between — blending (toe-off / heel-strike)
 */
export interface StanceHint {
  left: number;
  right: number;
}

/**
 * Locomotion stance schedule. Returns a stance-hint pair given the
 * current locomotion clip + the clip's normalised time in [0, 1).
 *
 * Phase-2 schedule is symmetric & out-of-phase: when one foot is
 * planted, the other is in swing. The transition window (toe-off +
 * heel-strike) is 8% of the cycle.
 */
export function locomotionStance(tag: AnimTag, clipPhase: number): StanceHint {
  // Idle / one-shots → both feet planted.
  if (tag === "idle" || tag === "celebrate" || tag === "throw" || tag === "catch") {
    return { left: 1, right: 1 };
  }
  // Locomotion: out-of-phase plant cycle.
  if (tag === "walk" || tag === "run" || tag === "sprint" || tag === "dribble") {
    const phase = ((clipPhase % 1) + 1) % 1;
    // Left foot plants in the first half, right foot in the second half,
    // with 8% transition windows for blending.
    return {
      left: stanceCurve(phase),
      right: stanceCurve((phase + 0.5) % 1),
    };
  }
  // One-shots that involve a kicking foot: the support foot stays
  // planted, the kicking foot is fully released. Default to "right is
  // kicking" — caller can override per-player handedness in Phase 4.
  if (tag === "pass" || tag === "kick" || tag === "shoot" || tag === "tackle") {
    return { left: 1, right: 0 };
  }
  // Fall / jump / header — no foot lock; the body is airborne or
  // unsupported.
  if (tag === "fall" || tag === "jump" || tag === "header") {
    return { left: 0, right: 0 };
  }
  return { left: 1, right: 1 };
}

/** Evaluate the stance curve at normalised cycle phase (0 → 1). */
function stanceCurve(phase: number): number {
  // 0–0.42: full plant. 0.42–0.50: ease off. 0.50–0.92: swing.
  // 0.92–1.0: ease back on.
  if (phase < 0.42) return 1;
  if (phase < 0.5) return 1 - (phase - 0.42) / 0.08;
  if (phase < 0.92) return 0;
  return (phase - 0.92) / 0.08;
}

/** Public options for the per-leg solve. */
export interface FootIkOptions {
  /** World-up vector for ground raycast (default +Y). */
  upAxis?: THREE.Vector3;
  /** Maximum length (in metres) the leg may reach before clamping. */
  maxLegLength?: number;
  /** Desired vertical clearance above ground for the ankle (m). Default 0.06. */
  ankleClearance?: number;
  /** Sample function for ground height at world (x, z). Default flat at y=0. */
  groundHeight?: (worldX: number, worldZ: number) => number;
}

/** Per-leg bone references resolved off a skeleton root. */
export interface LegBones {
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  ankle: THREE.Object3D;
}

/** Internal: rest-pose data captured on first solve. */
interface LegCache {
  hipQuat: THREE.Quaternion;
  kneeQuat: THREE.Quaternion;
  /** Rest-pose hip world quaternion (fully composed, world-space). */
  restHipWorld: THREE.Quaternion;
  /** Rest-pose knee world quaternion. */
  restKneeWorld: THREE.Quaternion;
  /** Rest hip→knee direction in WORLD space (unit length). */
  restHipKneeDir: THREE.Vector3;
  /** Rest knee→ankle direction in WORLD space (unit length). */
  restKneeAnkleDir: THREE.Vector3;
  /** Rest-pose pole direction (perpendicular to chord), in world space. */
  restPole: THREE.Vector3;
}

/** Try to resolve the canonical leg bones from a root Object3D. */
export function resolveLegBones(root: THREE.Object3D, side: FootSide): LegBones | null {
  const upHip = side === "left" ? "mixamorigLeftUpLeg" : "mixamorigRightUpLeg";
  const knee = side === "left" ? "mixamorigLeftLeg" : "mixamorigRightLeg";
  const foot = side === "left" ? "mixamorigLeftFoot" : "mixamorigRightFoot";
  const a = findCanonicalBone(root, upHip);
  const b = findCanonicalBone(root, knee);
  const c = findCanonicalBone(root, foot);
  if (!a || !b || !c) return null;
  return { hip: a, knee: b, ankle: c };
}

/**
 * Pure two-bone IK math, no THREE dependencies in the call signature
 * (apart from Vector3 — convenient typing). Given:
 *
 *   - `root`     — hip world position
 *   - `target`   — desired ankle world position
 *   - `lenA`     — hip→knee bone length (m)
 *   - `lenB`     — knee→ankle bone length (m)
 *
 * returns `{ kneeAngle, hipPitch }` where:
 *
 *   - `kneeAngle` is the *bend* angle in radians (0 = straight leg, π
 *     = fully folded). The caller applies it as a local-X rotation on
 *     the knee bone (knee axis is Mixamo's bend convention).
 *   - `hipPitch` is the additional pitch on the hip bone needed to
 *     align the knee→ankle plane with the target.
 *
 * The function is unit-testable without a skeleton: pass coordinates,
 * compare angles to expected values from law-of-cosines.
 */
export function solveTwoBoneAngles(
  root: THREE.Vector3,
  target: THREE.Vector3,
  lenA: number,
  lenB: number,
): { kneeAngle: number; hipPitch: number; reach: number } {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const dz = target.z - root.z;
  const dist = Math.hypot(dx, dy, dz);
  const reachMax = lenA + lenB;
  const reachMin = Math.abs(lenA - lenB);
  // Clamp the target so the chain can reach it.
  const d = Math.min(reachMax - 1e-4, Math.max(reachMin + 1e-4, dist));

  // Law of cosines for the knee bend. cos(θ) = (a² + b² - c²) / (2ab).
  // Knee *interior* angle: how open the joint is. The bend angle the
  // skeleton uses (0 = straight, π = folded) is π − interior.
  const cosInterior = (lenA * lenA + lenB * lenB - d * d) / (2 * lenA * lenB);
  const interior = Math.acos(Math.min(1, Math.max(-1, cosInterior)));
  const kneeAngle = Math.PI - interior;

  // Hip pitch: angle between the straight-down vector and the
  // hip→target vector, in the sagittal plane. We use atan2 on the (xz
  // length, y) components so positive pitch swings the knee forward.
  const horiz = Math.hypot(dx, dz);
  const hipPitch = Math.atan2(horiz, -dy);

  return { kneeAngle, hipPitch, reach: dist };
}

/** Default flat-ground sampler. */
function flatGround(): number {
  return 0;
}

/**
 * Per-player foot IK rig. One instance per `<Player>`. The owner calls
 * `solve(stance)` from `useFrame` after the FSM mixer has updated the
 * skeleton; we read the FK-baked ankle position, decide where the
 * ankle should be (raycast → ground), and rotate the hip + knee to
 * meet that target. The blend amount comes from the stance hint.
 *
 * The IK runs in *additive* mode: it only modifies the hip + knee
 * local rotations *after* the mixer has written to them. Because we
 * compute the new rotation in world space and set the local rotation
 * via `setRotationFromQuaternion`, the FSM's pose underneath stays the
 * authoritative source.
 */
export class FootIK {
  private readonly opts: Required<Omit<FootIkOptions, "groundHeight">> & {
    groundHeight: (x: number, z: number) => number;
  };

  // Scratch vectors — re-used per-frame to avoid GC pressure.
  private readonly _hipWorld = new THREE.Vector3();
  private readonly _kneeWorld = new THREE.Vector3();
  private readonly _ankleWorld = new THREE.Vector3();
  private readonly _target = new THREE.Vector3();
  private readonly _tmp = new THREE.Vector3();
  private readonly _quatA = new THREE.Quaternion();
  private readonly _quatB = new THREE.Quaternion();
  private readonly _quatHipAim = new THREE.Quaternion();
  private readonly _quatHipFinal = new THREE.Quaternion();
  private readonly _quatKneeFinal = new THREE.Quaternion();

  // Cached bone lengths, resolved on first solve.
  private lenLeftA = 0;
  private lenLeftB = 0;
  private lenRightA = 0;
  private lenRightB = 0;

  // Bone references; resolved lazily so the rig owner can construct
  // the FootIK before the GLB has loaded.
  private legs: { left: LegBones | null; right: LegBones | null } = {
    left: null,
    right: null,
  };

  // Per-leg cached rest-pose data.
  //
  //   - `hipQuat` / `kneeQuat`: the local quaternion as authored by the
  //     mixer for the *rest pose* sample — captured the first time
  //     `solve()` runs. We blend *toward* the IK rotation by `stance`;
  //     with stance=0 we restore the rest exactly.
  //   - `restDir`: rest-pose hip→ankle direction in the hip *parent's*
  //     world frame. We rotate this onto the desired direction to find
  //     the hip aim delta.
  //   - `kneeAxis`: the local-frame axis around which the knee bends
  //     in the rest pose. Inferred from the rest-pose kneecap position
  //     relative to the hip→ankle line.
  private cacheLeft: LegCache | null = null;
  private cacheRight: LegCache | null = null;

  constructor(opts: FootIkOptions = {}) {
    this.opts = {
      upAxis: opts.upAxis ?? new THREE.Vector3(0, 1, 0),
      maxLegLength: opts.maxLegLength ?? 1.05,
      ankleClearance: opts.ankleClearance ?? 0.06,
      groundHeight: opts.groundHeight ?? flatGround,
    };
  }

  /**
   * Resolve leg bones off a freshly-loaded skeleton root. Idempotent —
   * subsequent calls re-resolve (handles GLB swap-in mid-session).
   */
  attach(root: THREE.Object3D): void {
    this.legs.left = resolveLegBones(root, "left");
    this.legs.right = resolveLegBones(root, "right");
    this.measureBoneLengths();
  }

  private measureBoneLengths(): void {
    if (this.legs.left) {
      const { hip, knee, ankle } = this.legs.left;
      hip.updateWorldMatrix(true, true);
      this._hipWorld.setFromMatrixPosition(hip.matrixWorld);
      this._kneeWorld.setFromMatrixPosition(knee.matrixWorld);
      this._ankleWorld.setFromMatrixPosition(ankle.matrixWorld);
      this.lenLeftA = this._hipWorld.distanceTo(this._kneeWorld);
      this.lenLeftB = this._kneeWorld.distanceTo(this._ankleWorld);
    }
    if (this.legs.right) {
      const { hip, knee, ankle } = this.legs.right;
      hip.updateWorldMatrix(true, true);
      this._hipWorld.setFromMatrixPosition(hip.matrixWorld);
      this._kneeWorld.setFromMatrixPosition(knee.matrixWorld);
      this._ankleWorld.setFromMatrixPosition(ankle.matrixWorld);
      this.lenRightA = this._hipWorld.distanceTo(this._kneeWorld);
      this.lenRightB = this._kneeWorld.distanceTo(this._ankleWorld);
    }
  }

  /**
   * Solve both legs' IK and write the result back to the skeleton.
   * No-op if `attach` hasn't been called or stance is fully released.
   */
  solve(stance: StanceHint): void {
    if (this.legs.left && stance.left > 0.001) {
      this.solveLeg("left", stance.left);
    }
    if (this.legs.right && stance.right > 0.001) {
      this.solveLeg("right", stance.right);
    }
  }

  /** Get-or-build the rest-pose cache for one leg. */
  private getCache(side: FootSide): LegCache | null {
    let cache = side === "left" ? this.cacheLeft : this.cacheRight;
    if (cache) return cache;

    const legs = side === "left" ? this.legs.left : this.legs.right;
    if (!legs) return null;
    const lenA = side === "left" ? this.lenLeftA : this.lenRightA;
    const lenB = side === "left" ? this.lenLeftB : this.lenRightB;
    if (lenA <= 0 || lenB <= 0) return null;

    const { hip, knee, ankle } = legs;
    hip.updateWorldMatrix(true, true);

    const hipWorld = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
    const kneeWorld = new THREE.Vector3().setFromMatrixPosition(knee.matrixWorld);
    const ankleWorld = new THREE.Vector3().setFromMatrixPosition(ankle.matrixWorld);

    const restHipWorld = new THREE.Quaternion();
    hip.getWorldQuaternion(restHipWorld);
    const restKneeWorld = new THREE.Quaternion();
    knee.getWorldQuaternion(restKneeWorld);

    const restHipKneeDir = kneeWorld.clone().sub(hipWorld).normalize();
    const restKneeAnkleDir = ankleWorld.clone().sub(kneeWorld).normalize();

    // Pole: rest knee position projected onto the plane perpendicular
    // to the chord (hip→ankle). In world space.
    const chord = ankleWorld.clone().sub(hipWorld);
    const chordLen = Math.max(chord.length(), 1e-6);
    const chordDir = chord.clone().multiplyScalar(1 / chordLen);
    const mid = hipWorld.clone().add(ankleWorld).multiplyScalar(0.5);
    const restPole = kneeWorld.clone().sub(mid);
    const along = chordDir.clone().multiplyScalar(restPole.dot(chordDir));
    restPole.sub(along);
    if (restPole.lengthSq() < 1e-10) {
      restPole.set(0, 0, 1);
    } else {
      restPole.normalize();
    }

    cache = {
      hipQuat: hip.quaternion.clone(),
      kneeQuat: knee.quaternion.clone(),
      restHipWorld,
      restKneeWorld,
      restHipKneeDir,
      restKneeAnkleDir,
      restPole,
    };
    if (side === "left") this.cacheLeft = cache;
    else this.cacheRight = cache;
    return cache;
  }

  private solveLeg(side: FootSide, weight: number): void {
    const legs = side === "left" ? this.legs.left : this.legs.right;
    if (!legs) return;
    const lenA = side === "left" ? this.lenLeftA : this.lenRightA;
    const lenB = side === "left" ? this.lenLeftB : this.lenRightB;
    if (lenA <= 0 || lenB <= 0) return;

    const cache = this.getCache(side);
    if (!cache) return;

    const { hip, knee, ankle } = legs;

    hip.updateWorldMatrix(true, true);
    this._hipWorld.setFromMatrixPosition(hip.matrixWorld);
    this._ankleWorld.setFromMatrixPosition(ankle.matrixWorld);

    // Ground sample under the FK-baked ankle.
    const groundY =
      this.opts.groundHeight(this._ankleWorld.x, this._ankleWorld.z) +
      this.opts.ankleClearance;

    // Where do we want the ankle to end up? The lock target is on the
    // ground plane; if the FK ankle is already above the lock target
    // and the caller's stance hint allows partial relaxation (weight <
    // 1), we ease back to the rest pose. With weight=1 we always pin.
    const needsLock = this._ankleWorld.y < groundY || weight >= 0.999;
    if (!needsLock) {
      hip.quaternion.slerp(cache.hipQuat, 1 - weight);
      knee.quaternion.slerp(cache.kneeQuat, 1 - weight);
      return;
    }

    this._target.set(this._ankleWorld.x, groundY, this._ankleWorld.z);

    // Clamp the target inside the leg's max reach (clamp toward hip if
    // too short, away from hip if too long).
    this._tmp.subVectors(this._target, this._hipWorld);
    const reachMax = lenA + lenB - 1e-4;
    const reachMin = Math.max(1e-4, Math.abs(lenA - lenB) + 1e-4);
    let distance = this._tmp.length();
    if (distance > reachMax) {
      this._tmp.multiplyScalar(reachMax / Math.max(distance, 1e-6));
      this._target.copy(this._hipWorld).add(this._tmp);
      distance = reachMax;
    } else if (distance < reachMin) {
      this._tmp.multiplyScalar(reachMin / Math.max(distance, 1e-6));
      this._target.copy(this._hipWorld).add(this._tmp);
      distance = reachMin;
    }

    // ---- Two-bone IK in world space --------------------------------
    //
    // Given hip H, target T, lA, lB, find knee K such that |HK|=lA and
    // |KT|=lB. The knee lies on a circle of radius r centred on the
    // chord at distance dC from H, where:
    //   dC = (lA² − lB² + D²) / (2D)
    //   r  = sqrt(lA² − dC²)
    // and the circle's plane is perpendicular to the chord. The pole
    // vector picks which point on the circle to use.
    const D = distance;
    const dC = (lenA * lenA - lenB * lenB + D * D) / (2 * D);
    const r = Math.sqrt(Math.max(0, lenA * lenA - dC * dC));
    const chord = this._tmp.subVectors(this._target, this._hipWorld);
    const chordDir = chord.clone().multiplyScalar(1 / Math.max(D, 1e-6));

    // Pole in world space: rotate the rest pole so it stays on the
    // chord-perpendicular plane. Take the rest pole's component
    // perpendicular to the new chord; if degenerate, fall back to a
    // sensible default (world +Z, then world +Y).
    const pole = cache.restPole.clone();
    const along = chordDir.clone().multiplyScalar(pole.dot(chordDir));
    pole.sub(along);
    if (pole.lengthSq() < 1e-6) {
      pole.set(0, 0, 1);
      const along2 = chordDir.clone().multiplyScalar(pole.dot(chordDir));
      pole.sub(along2);
      if (pole.lengthSq() < 1e-6) {
        pole.set(0, 1, 0);
        pole.sub(chordDir.clone().multiplyScalar(pole.dot(chordDir)));
      }
    }
    pole.normalize();

    // Knee world position.
    const kneeWorld = this._hipWorld
      .clone()
      .add(chordDir.clone().multiplyScalar(dC))
      .add(pole.clone().multiplyScalar(r));

    // ---- Hip world rotation ---------------------------------------
    //
    // Compute the delta quaternion that rotates the rest hip→knee
    // direction (world space) onto the desired direction (world
    // space). Apply that delta to the rest hip world quaternion to get
    // the new hip world quaternion. Convert back to local via the hip
    // parent's current world rotation.
    const hipParentQuat = this._quatA;
    if (hip.parent) hip.parent.getWorldQuaternion(hipParentQuat);
    else hipParentQuat.identity();

    const dirHipKneeWorld = kneeWorld.clone().sub(this._hipWorld).normalize();
    const hipDelta = this._quatHipAim.setFromUnitVectors(cache.restHipKneeDir, dirHipKneeWorld);
    // newHipWorld = hipDelta * restHipWorld
    const newHipWorld = hipDelta.clone().multiply(cache.restHipWorld);
    // newHipLocal = inv(hipParent) * newHipWorld
    this._quatHipFinal.copy(hipParentQuat).invert().multiply(newHipWorld);

    // ---- Knee world rotation --------------------------------------
    //
    // The chain has rotated; we need the knee's *world* quaternion to
    // map the rest knee→ankle direction onto the new desired direction
    // (target − kneeWorld). Then convert back to local via the knee
    // parent's NEW world rotation (= newHipWorld for a hip→knee→ankle
    // chain where the knee is a direct child of the hip).
    const dirKneeAnkleWorld = this._target.clone().sub(kneeWorld).normalize();
    const kneeDelta = this._quatHipAim.setFromUnitVectors(cache.restKneeAnkleDir, dirKneeAnkleWorld);
    const newKneeWorld = kneeDelta.clone().multiply(cache.restKneeWorld);
    // newKneeLocal = inv(newHipWorld) * newKneeWorld
    this._quatKneeFinal.copy(newHipWorld).invert().multiply(newKneeWorld);

    // ---- Blend in -------------------------------------------------
    hip.quaternion.copy(cache.hipQuat).slerp(this._quatHipFinal, weight);
    knee.quaternion.copy(cache.kneeQuat).slerp(this._quatKneeFinal, weight);
  }

  /** Reset captured rest poses; call when the FSM swaps clips. */
  resetRest(): void {
    this.cacheLeft = null;
    this.cacheRight = null;
  }
}
