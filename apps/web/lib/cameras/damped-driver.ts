/**
 * DampedCameraDriver, frame-rate-independent damping for the active
 * camera's position, lookAt, and FOV.
 *
 * Background: the Director writes
 *   camera.position.copy(blendedTarget.position)
 *   camera.lookAt(blendedTarget.lookAt)
 * directly each frame. The CutBlender already eases *transitions
 * between cams* (200-400 ms cosine), but the *target itself*, e.g. the
 * broadcast camera's `lookAt = ball.position * 0.4`, moves
 * discontinuously each state frame. With state frames batched in the
 * synthetic stream, the target jumps several metres per tick and the
 * camera snaps to it.
 *
 * Fix: between the blender's output and the actual `camera.position`
 * write, run a damper that tracks the target with `THREE.MathUtils.damp`
 * (lambda) so the camera always *approaches* the desired pose without
 * overshoot. λ ≈ 5 → reaches half the gap in ≈ 0.14 s; smooth on the
 * eye but not laggy.
 *
 * On a cut to a new cam (a `reset()` call), the next `update()`
 * SNAPS to the target so the cut still reads as a cut, not a slow
 * pan from the old cam pose to the new one.
 *
 * Pure module: no React, no Three component lifecycle. Inject a
 * `THREE.MathUtils.damp` impl when testing in jsdom.
 */
import * as THREE from "three";

export interface DampedCameraDriverOptions {
  /** Damping rate for position. Default 5. */
  positionLambda?: number;
  /** Damping rate for lookAt. Default 4. */
  lookAtLambda?: number;
  /** Damping rate for FOV. Default 6. */
  fovLambda?: number;
  /**
   * Override THREE.MathUtils.damp (signature: (current, target, lambda, dt) => damped).
   * For tests.
   */
  damp?: (current: number, target: number, lambda: number, dt: number) => number;
}

export interface DampedCameraTarget {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
}

export class DampedCameraDriver {
  private posLambda: number;
  private lookLambda: number;
  private fovLambda: number;
  private damp: (current: number, target: number, lambda: number, dt: number) => number;
  private snap = true;
  /** The damped lookAt point (the camera does NOT internally store one). */
  private currentLookAt = new THREE.Vector3();
  private currentFov = 50;

  constructor(opts: DampedCameraDriverOptions = {}) {
    this.posLambda = opts.positionLambda ?? 5;
    this.lookLambda = opts.lookAtLambda ?? 4;
    this.fovLambda = opts.fovLambda ?? 6;
    this.damp = opts.damp ?? THREE.MathUtils.damp;
  }

  /**
   * Force the next `update()` to snap to the target instead of damping.
   * Use on cuts and on the first update after mount.
   */
  reset(): void {
    this.snap = true;
  }

  /**
   * Damp the supplied `camera`'s position toward `target.position` and
   * its lookAt toward `target.lookAt`, then call `camera.lookAt()`.
   *
   * `dt` is the per-frame delta in seconds (R3F gives this). It is
   * clamped internally to a sane range so a stall doesn't snap the
   * camera.
   */
  update(
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    target: DampedCameraTarget,
    dt: number,
  ): void {
    // Clamp delta to avoid frame-stall snaps.
    const cdt = Math.max(0, Math.min(dt, 1 / 30));

    if (this.snap) {
      camera.position.copy(target.position);
      this.currentLookAt.copy(target.lookAt);
      this.currentFov = target.fov;
      if (camera instanceof THREE.PerspectiveCamera) {
        if (Math.abs(camera.fov - target.fov) > 0.05) {
          camera.fov = target.fov;
          camera.updateProjectionMatrix();
        }
      }
      camera.lookAt(this.currentLookAt);
      this.snap = false;
      return;
    }

    // Position
    camera.position.x = this.damp(camera.position.x, target.position.x, this.posLambda, cdt);
    camera.position.y = this.damp(camera.position.y, target.position.y, this.posLambda, cdt);
    camera.position.z = this.damp(camera.position.z, target.position.z, this.posLambda, cdt);

    // LookAt
    this.currentLookAt.x = this.damp(this.currentLookAt.x, target.lookAt.x, this.lookLambda, cdt);
    this.currentLookAt.y = this.damp(this.currentLookAt.y, target.lookAt.y, this.lookLambda, cdt);
    this.currentLookAt.z = this.damp(this.currentLookAt.z, target.lookAt.z, this.lookLambda, cdt);

    // FOV
    this.currentFov = this.damp(this.currentFov, target.fov, this.fovLambda, cdt);
    if (camera instanceof THREE.PerspectiveCamera) {
      if (Math.abs(camera.fov - this.currentFov) > 0.05) {
        camera.fov = this.currentFov;
        camera.updateProjectionMatrix();
      }
    }

    camera.lookAt(this.currentLookAt);
  }

  /** Read-only inspectors for tests. */
  getCurrentLookAt(): THREE.Vector3 {
    return this.currentLookAt.clone();
  }

  getCurrentFov(): number {
    return this.currentFov;
  }

  isSnapping(): boolean {
    return this.snap;
  }
}
