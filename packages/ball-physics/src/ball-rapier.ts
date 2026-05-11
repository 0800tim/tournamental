/**
 * Rapier-driven ball mode.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md` § "Rapier mode":
 *
 *   - `@react-three/rapier`'s `<RigidBody>` for the ball with mass
 *     0.43 kg, restitution 0.6, friction 0.4.
 *   - Trigger when event is `Free Kick` or when prior shot has
 *     `outcome=post|crossbar` (for the rebound).
 *   - After 2 seconds of physics OR when the next deterministic
 *     event fires, switch back to spline mode and reconcile to the
 *     next known position.
 *
 * This module is intentionally renderer-host agnostic. It exposes:
 *
 *   1. `BallPhysicsAPI` — the public contract used by `Ball.tsx`.
 *   2. A `VerletBall` fallback that integrates the ball position
 *      with semi-implicit Euler + gravity + drag, used when
 *      `@react-three/rapier` isn't installed (or in node tests where
 *      WASM bootstrapping is finicky). The fallback ships the same
 *      surface — apply impulse + step + read pose.
 *   3. `selectBallMode` — pure logic that decides between
 *      `spline` and `rapier` based on the latest event.
 *
 * `Ball.tsx` consumes the `BallPhysicsAPI`; the actual integrator is
 * wired up in the renderer (`apps/web/components/Ball.tsx`) — that's
 * where `@react-three/rapier` is mounted as a context.
 */
import type { EventMessage, Vec3 } from "@tournamental/spec";

/** Ball mode classification. */
export type BallMode = "spline" | "rapier";

/** Physical constants for a regulation soccer ball. */
export const BALL_CONSTANTS = {
  /** kg, FIFA size 5. */
  mass: 0.43,
  /** m, FIFA size 5. */
  radius: 0.11,
  /** Coefficient of restitution against the pitch. */
  restitution: 0.6,
  /** Sliding friction against the pitch. */
  friction: 0.4,
  /** Aerodynamic drag coefficient (rough sphere ~ 0.45). */
  dragCoefficient: 0.30,
  /** Gravity (m/s², spec-coords +z is up). */
  gravity: 9.81,
  /** Air density at sea level (kg/m³). */
  airDensity: 1.225,
} as const;

/**
 * Decide the ball mode for the *next* simulation step given the most
 * recent event. Pure logic, no side effects.
 *
 *   - `event.out_of_bounds` with restart=`free_kick` → rapier
 *   - `event.shot` with outcome=post|crossbar → rapier (for rebound)
 *   - anything else → spline
 *
 * The renderer side-effects (timer to re-cap rapier, snap-to-spline
 * handover) are handled by `BallController`.
 */
export function selectBallMode(event: EventMessage | null): BallMode {
  if (!event) return "spline";
  if (event.type === "event.out_of_bounds" && event.restart === "free_kick") {
    return "rapier";
  }
  if (event.type === "event.out_of_bounds" && event.restart === "corner") {
    return "rapier";
  }
  if (event.type === "event.shot") {
    // `on_target` + saved=false means a goal/post candidate; if the
    // event is followed by a goal we'll switch back. Phase-2 heuristic:
    // shots stay in spline (the spec carries target + saved fields)
    // unless the producer signals a deflection elsewhere.
    return "spline";
  }
  return "spline";
}

/** State written by `Ball.tsx` to the physics layer per frame. */
export interface BallStepInput {
  /** Time since previous step, seconds. */
  dt: number;
  /** Optional impulse to apply this step (e.g. on kick), in N·s. */
  impulse?: Vec3;
  /** Override position (e.g. spline mode handover). */
  setPosition?: Vec3;
  /** Override velocity (e.g. spline mode handover). */
  setVelocity?: Vec3;
  /** Phase-4: optional spin set (rad/s) — drives Magnus side-force. */
  setSpin?: Vec3;
}

/** Pose read out of the physics layer per frame. */
export interface BallPose {
  pos: Vec3;
  vel: Vec3;
}

/** Public physics API consumed by Ball.tsx. */
export interface BallPhysicsAPI {
  step(input: BallStepInput): BallPose;
  setPose(pose: Partial<BallPose>): void;
  getPose(): BallPose;
  /** Optional: register a contact callback — fired on collisions. */
  onContact?(cb: (point: Vec3, normal: Vec3) => void): () => void;
}

/**
 * Verlet-integrator fallback for environments where `@react-three/rapier`
 * isn't available (CI, node tests). Implements gravity + linear drag +
 * elastic ground collision against a flat plane at z=0.
 *
 * Same `BallPhysicsAPI` surface as the Rapier-driven implementation
 * so `Ball.tsx` doesn't care which one is mounted.
 */
export class VerletBall implements BallPhysicsAPI {
  private pos: Vec3 = [0, 0, BALL_CONSTANTS.radius];
  private vel: Vec3 = [0, 0, 0];
  /** Angular velocity (spin) in rad/s. Phase-4 Magnus driver. */
  private spin: Vec3 = [0, 0, 0];

  step(input: BallStepInput): BallPose {
    if (input.setPosition) this.pos = [...input.setPosition];
    if (input.setVelocity) this.vel = [...input.setVelocity];
    if (input.setSpin) this.spin = [...input.setSpin];
    if (input.impulse) {
      const m = BALL_CONSTANTS.mass;
      this.vel = [
        this.vel[0] + input.impulse[0] / m,
        this.vel[1] + input.impulse[1] / m,
        this.vel[2] + input.impulse[2] / m,
      ];
    }

    const dt = Math.max(0, Math.min(input.dt, 1 / 30));

    // Drag (linear approximation): F_drag = -k v
    //   k = 0.5 · ρ · Cd · A
    const A = Math.PI * BALL_CONSTANTS.radius * BALL_CONSTANTS.radius;
    const k =
      0.5 *
      BALL_CONSTANTS.airDensity *
      BALL_CONSTANTS.dragCoefficient *
      A;
    const dragAccel: Vec3 = [
      -(k * this.vel[0]) / BALL_CONSTANTS.mass,
      -(k * this.vel[1]) / BALL_CONSTANTS.mass,
      -(k * this.vel[2]) / BALL_CONSTANTS.mass,
    ];

    // Magnus side-force from spin (Phase 4).
    const magnus = computeMagnusAccel(this.spin, this.vel);

    // Semi-implicit Euler.
    this.vel = [
      this.vel[0] + (dragAccel[0] + magnus[0]) * dt,
      this.vel[1] + (dragAccel[1] + magnus[1]) * dt,
      this.vel[2] + (dragAccel[2] + magnus[2] - BALL_CONSTANTS.gravity) * dt,
    ];

    this.pos = [
      this.pos[0] + this.vel[0] * dt,
      this.pos[1] + this.vel[1] * dt,
      this.pos[2] + this.vel[2] * dt,
    ];

    // Spin decay (~1%/sec).
    const decay = Math.exp(-0.01 * dt);
    this.spin = [this.spin[0] * decay, this.spin[1] * decay, this.spin[2] * decay];

    // Ground collision: flat z=0 with radius offset.
    if (this.pos[2] < BALL_CONSTANTS.radius) {
      this.pos[2] = BALL_CONSTANTS.radius;
      if (this.vel[2] < 0) {
        this.vel[2] = -this.vel[2] * BALL_CONSTANTS.restitution;
      }
      // Tangential friction.
      this.vel[0] *= 1 - BALL_CONSTANTS.friction * dt * 4;
      this.vel[1] *= 1 - BALL_CONSTANTS.friction * dt * 4;
    }

    return this.getPose();
  }

  setPose(pose: Partial<BallPose>): void {
    if (pose.pos) this.pos = [...pose.pos];
    if (pose.vel) this.vel = [...pose.vel];
  }

  /** Phase-4: explicitly set the spin axis (rad/s). */
  setSpin(spin: Vec3): void {
    this.spin = [...spin];
  }

  /** Phase-4: read the current spin axis (rad/s). */
  getSpin(): Vec3 {
    return [...this.spin];
  }

  getPose(): BallPose {
    return { pos: [...this.pos], vel: [...this.vel] };
  }
}

/**
 * Local helper: Magnus acceleration from spin × velocity. Mirrors
 * `magnusForce` in magnus.ts but inlined here to avoid a circular
 * import (magnus.ts imports BALL_CONSTANTS from this file).
 */
function computeMagnusAccel(omega: Vec3, velocity: Vec3): Vec3 {
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
  if (speed < 1e-3) return [0, 0, 0];
  const omegaMag = Math.hypot(omega[0], omega[1], omega[2]);
  if (omegaMag < 1e-6) return [0, 0, 0];

  const S = (omegaMag * BALL_CONSTANTS.radius) / speed;
  let Cl: number;
  if (S < 0.05) Cl = 0;
  else if (S < 0.15) Cl = 0.18 + ((S - 0.05) / 0.10) * (0.25 - 0.18);
  else if (S < 0.30) Cl = 0.25 + ((S - 0.15) / 0.15) * (0.32 - 0.25);
  else Cl = 0.32;
  if (Cl === 0) return [0, 0, 0];

  const A = Math.PI * BALL_CONSTANTS.radius * BALL_CONSTANTS.radius;
  const factor = 0.5 * BALL_CONSTANTS.airDensity * Cl * A * speed * speed;

  const omegaHat: Vec3 = [omega[0] / omegaMag, omega[1] / omegaMag, omega[2] / omegaMag];
  const velHat: Vec3 = [velocity[0] / speed, velocity[1] / speed, velocity[2] / speed];
  const cx = omegaHat[1] * velHat[2] - omegaHat[2] * velHat[1];
  const cy = omegaHat[2] * velHat[0] - omegaHat[0] * velHat[2];
  const cz = omegaHat[0] * velHat[1] - omegaHat[1] * velHat[0];
  const cmag = Math.hypot(cx, cy, cz);
  if (cmag < 1e-9) return [0, 0, 0];

  const m = BALL_CONSTANTS.mass;
  return [
    (cx / cmag) * factor / m,
    (cy / cmag) * factor / m,
    (cz / cmag) * factor / m,
  ];
}

/**
 * Controller that holds the spline/rapier mode + a 2-second timer.
 * `Ball.tsx` mounts one of these per match; `step(dt, event, splinePos)`
 * returns the pose to draw.
 *
 *   - In `spline` mode the controller returns the externally-provided
 *     spline pose verbatim.
 *   - In `rapier` mode the controller advances the physics integrator,
 *     starting from the spline pose at the moment of switch.
 *   - After 2 seconds in `rapier` mode (or when a new spline event
 *     fires) it switches back, snapping the next spline sample to the
 *     last physics pose so the visual is continuous.
 */
export class BallController {
  private mode: BallMode = "spline";
  private modeTimerSec = 0;
  private physics: BallPhysicsAPI;
  private lastPose: BallPose = {
    pos: [0, 0, BALL_CONSTANTS.radius],
    vel: [0, 0, 0],
  };
  private maxRapierSec: number;

  constructor(physics?: BallPhysicsAPI, maxRapierSec = 2.0) {
    this.physics = physics ?? new VerletBall();
    this.maxRapierSec = maxRapierSec;
  }

  /** Current mode (read-only). */
  getMode(): BallMode {
    return this.mode;
  }

  /** Force a switch — used when the next event arrives. */
  setMode(mode: BallMode, snapTo?: BallPose): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.modeTimerSec = 0;
    if (snapTo) {
      this.physics.setPose(snapTo);
      this.lastPose = {
        pos: snapTo.pos ?? this.lastPose.pos,
        vel: snapTo.vel ?? this.lastPose.vel,
      };
    }
  }

  /**
   * Advance the controller by `dt` seconds.
   *
   *   - `event`: the latest event (used to maybe switch into rapier).
   *   - `splinePose`: the pose the spline mode wants — used as the
   *     authoritative pose when in spline mode, and as the seed when
   *     entering rapier mode.
   *   - returns the pose to render this frame.
   */
  step(dt: number, event: EventMessage | null, splinePose: BallPose): BallPose {
    if (event) {
      const next = selectBallMode(event);
      if (next !== this.mode) {
        this.setMode(next, splinePose);
      }
    }

    if (this.mode === "spline") {
      this.lastPose = splinePose;
      this.physics.setPose(splinePose);
      return splinePose;
    }

    // rapier: integrate physics, snap back to spline after timer
    this.modeTimerSec += dt;
    this.lastPose = this.physics.step({ dt });

    if (this.modeTimerSec >= this.maxRapierSec) {
      this.setMode("spline", splinePose);
    }

    return this.lastPose;
  }

  /** Apply an impulse — e.g. when the ball hits a post. */
  applyImpulse(impulse: Vec3): void {
    this.physics.step({ dt: 0, impulse });
  }

  /** Phase-4: set the ball spin (rad/s). */
  setSpin(spin: Vec3): void {
    if (this.physics instanceof VerletBall) {
      this.physics.setSpin(spin);
    } else {
      this.physics.step({ dt: 0, setSpin: spin });
    }
  }
}
