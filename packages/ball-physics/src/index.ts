/**
 * @vtorn/ball-physics — ball trajectory + physics for VTourn renderers.
 *
 * Public surface:
 *
 *  - `sampleBallTrajectory` / `sampleBallVelocity` / `buildBallTrajectoryPolyline`
 *    — Catmull-Rom-driven kick trajectory sampler (default mode).
 *  - `catmullRomCentripetal` / `deriveApex` — pure helpers used by the
 *    spline mode and useful in tests.
 *  - `BALL_CONSTANTS` — regulation soccer ball physical constants.
 *  - `selectBallMode` — pure logic mapping events → mode.
 *  - `VerletBall` — fallback physics integrator used when
 *    `@react-three/rapier` is unavailable.
 *  - `BallController` — owns mode switch + 2s rapier timer; consumed
 *    by `Ball.tsx`.
 *  - `magnusSideForce` / `inferCurl` — Magnus side-force preview.
 *
 * The package has zero hard dependency on `three` — the spline math
 * uses raw Vec3 tuples. Three.js is a peer-dep so the renderer side
 * can lift control points into `THREE.CatmullRomCurve3` for free.
 */
export {
  catmullRomCentripetal,
  deriveApex,
  sampleBallTrajectory,
  sampleBallVelocity,
  buildBallTrajectoryPolyline,
  type BallShotInputs,
  type BallTrajectoryOptions,
} from "./ball-spline.js";

export {
  BALL_CONSTANTS,
  selectBallMode,
  VerletBall,
  BallController,
  type BallMode,
  type BallPhysicsAPI,
  type BallPose,
  type BallStepInput,
} from "./ball-rapier.js";

export {
  magnusSideForce,
  inferCurl,
  magnusSpinFromShot,
  magnusForce,
  splinePeakLateralOffset,
  magnusSplineSideForce,
  liftCoefficient,
  spinParameter,
  type CurlDirection,
  type MagnusInputs,
  type ShotCategory,
  type SpinEstimatorInputs,
  type MagnusSpinEstimate,
} from "./magnus.js";
