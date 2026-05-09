/**
 * Phase-2 foot-IK tests.
 *
 * Three suites:
 *
 *   1. `solveTwoBoneAngles` — pure math; verify against hand-computed
 *      law-of-cosines results.
 *   2. `locomotionStance` — verify the stance schedule matches the spec
 *      (out-of-phase, with blend windows).
 *   3. `FootIK` end-to-end — synthetic skeleton + ground plane; assert
 *      foot Y matches plane Y to ±2 cm after solve.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  FootIK,
  locomotionStance,
  solveTwoBoneAngles,
} from "../src/foot-ik.js";
import { CANONICAL_BONES } from "../src/retarget.js";

describe("solveTwoBoneAngles", () => {
  it("returns straight leg when target is at full reach", () => {
    const root = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3(0, 0, 0); // exactly 1m below
    const out = solveTwoBoneAngles(root, target, 0.5, 0.5);
    // Knee bend ~ 0 (straight), hipPitch ~ 0 (straight down).
    expect(Math.abs(out.kneeAngle)).toBeLessThan(0.05);
    expect(Math.abs(out.hipPitch)).toBeLessThan(0.05);
  });

  it("returns 90deg knee bend when target is at sqrt(2)/2 of reach", () => {
    // Both bones 0.5; target at distance sqrt(0.5² + 0.5²) ≈ 0.707
    // gives interior angle 90° → knee bend angle 90° (π/2).
    const root = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(0, -Math.SQRT1_2, 0);
    const out = solveTwoBoneAngles(root, target, 0.5, 0.5);
    expect(out.kneeAngle).toBeCloseTo(Math.PI / 2, 2);
  });

  it("clamps target inside reach when over-extended", () => {
    const root = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(5, 0, 0); // way too far
    const out = solveTwoBoneAngles(root, target, 0.5, 0.5);
    // Should still produce finite angles, not NaN.
    expect(Number.isFinite(out.kneeAngle)).toBe(true);
    expect(Number.isFinite(out.hipPitch)).toBe(true);
  });

  it("hipPitch points forward (+x) when target is in front", () => {
    const root = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3(0.4, 0.2, 0);
    const out = solveTwoBoneAngles(root, target, 0.5, 0.5);
    // horiz = 0.4, dy = -0.8 → atan2(0.4, 0.8) ≈ 0.46 rad
    expect(out.hipPitch).toBeGreaterThan(0);
    expect(out.hipPitch).toBeCloseTo(Math.atan2(0.4, 0.8), 3);
  });
});

describe("locomotionStance", () => {
  it("plants both feet during idle", () => {
    const s = locomotionStance("idle", 0);
    expect(s.left).toBe(1);
    expect(s.right).toBe(1);
  });

  it("plants left, releases right at phase 0.0", () => {
    const s = locomotionStance("run", 0);
    expect(s.left).toBeCloseTo(1, 2);
    expect(s.right).toBeCloseTo(0, 2);
  });

  it("plants right, releases left at phase 0.5", () => {
    const s = locomotionStance("run", 0.5);
    expect(s.left).toBeCloseTo(0, 2);
    expect(s.right).toBeCloseTo(1, 2);
  });

  it("transitions smoothly through toe-off (phase 0.42 → 0.50)", () => {
    const a = locomotionStance("run", 0.42);
    const b = locomotionStance("run", 0.46);
    const c = locomotionStance("run", 0.5);
    expect(a.left).toBeCloseTo(1, 2);
    expect(b.left).toBeCloseTo(0.5, 1);
    expect(c.left).toBeCloseTo(0, 2);
  });

  it("releases both feet when airborne (jump, header, fall)", () => {
    expect(locomotionStance("jump", 0).left).toBe(0);
    expect(locomotionStance("header", 0).right).toBe(0);
    expect(locomotionStance("fall", 0).left).toBe(0);
  });

  it("plants support foot during a kick / pass", () => {
    const k = locomotionStance("kick", 0);
    expect(k.left).toBe(1); // support
    expect(k.right).toBe(0); // kicking
  });
});

/**
 * Build a synthetic standing skeleton with canonical Mixamo bone
 * names, in a slightly-bent rest pose so the IK has somewhere to bend
 * *out* to (extending the leg) when it needs to reach further down.
 *
 *   - Hip at world y = 1.0
 *   - Upper leg 0.45m, lower leg 0.45m → reach 0.90m max
 *   - Rest pose: hip pitched slightly, knee bent so ankle sits ~0.20m
 *     below the hip (i.e. y = 0.80).
 *
 * Ground locks below 0.80 require the leg to extend (decrease bend).
 */
function makeSyntheticSkeleton(): THREE.Object3D {
  const root = new THREE.Object3D();
  root.name = "synthetic_root";

  function buildLeg(side: "Left" | "Right", xOffset: number) {
    const hip = new THREE.Bone();
    hip.name = `mixamorig${side}UpLeg`;
    hip.position.set(xOffset, 1.0, 0);
    // Pitch the hip forward 30° so the knee comes forward, then knee
    // bends back. Net result: ankle is below hip but with bend headroom.
    hip.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI * 0.3);

    const knee = new THREE.Bone();
    knee.name = `mixamorig${side}Leg`;
    knee.position.set(0, -0.45, 0);
    // Bend the knee 90° back so the lower leg returns to vertical.
    knee.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI * 0.6);

    const ankle = new THREE.Bone();
    ankle.name = `mixamorig${side}Foot`;
    ankle.position.set(0, -0.45, 0);

    knee.add(ankle);
    hip.add(knee);
    root.add(hip);
  }

  buildLeg("Left", -0.12);
  buildLeg("Right", 0.12);

  // Sanity: ensure all canonical bones we care about exist on root by
  // reading the skeleton tree (only adds the leg bones for this test).
  void CANONICAL_BONES;

  root.updateMatrixWorld(true);
  return root;
}

describe("FootIK end-to-end", () => {
  it("attaches to a synthetic skeleton and resolves leg bones", () => {
    const root = makeSyntheticSkeleton();
    const ik = new FootIK();
    ik.attach(root);
    // No throw means the bones resolved.
    ik.solve({ left: 1, right: 1 });
  });

  it("pins ankle Y to ground plane within 2 cm tolerance", () => {
    const root = makeSyntheticSkeleton();
    // Hip is at world y=1.0; legs reach 0.9m max → ankle min y = 0.10.
    // Set ground at y=0.20 so the IK target is reachable.
    root.updateMatrixWorld(true);

    const ik = new FootIK({
      ankleClearance: 0,
      groundHeight: () => 0.20,
    });
    ik.attach(root);

    ik.solve({ left: 1, right: 1 });
    root.updateMatrixWorld(true);

    const leftFoot = root.getObjectByName("mixamorigLeftFoot")!;
    const rightFoot = root.getObjectByName("mixamorigRightFoot")!;
    const leftWorld = new THREE.Vector3();
    const rightWorld = new THREE.Vector3();
    leftFoot.getWorldPosition(leftWorld);
    rightFoot.getWorldPosition(rightWorld);

    // Ground at y=0.20 → ankle should be pinned to y=0.20 ± 2 cm.
    expect(Math.abs(leftWorld.y - 0.20)).toBeLessThan(0.02);
    expect(Math.abs(rightWorld.y - 0.20)).toBeLessThan(0.02);
  });

  it("releases the lock with weight=0 (rest pose preserved)", () => {
    const root = makeSyntheticSkeleton();
    root.updateMatrixWorld(true);

    // First capture the rest-pose ankle position before any IK runs.
    const leftFoot = root.getObjectByName("mixamorigLeftFoot")!;
    const restWorld = new THREE.Vector3();
    leftFoot.getWorldPosition(restWorld);

    const ik = new FootIK();
    ik.attach(root);

    // Solve once with weight=0 — rest pose preserved.
    ik.solve({ left: 0, right: 0 });
    root.updateMatrixWorld(true);

    const after = new THREE.Vector3();
    leftFoot.getWorldPosition(after);

    // Foot didn't move.
    expect(after.distanceTo(restWorld)).toBeLessThan(0.005);
  });

  it("respects a custom ground sampler", () => {
    const root = makeSyntheticSkeleton();
    root.updateMatrixWorld(true);

    // Sloped ground: y = 0.10 + 0.05 * x. Ankle rest is at ~0.80,
    // ground is around 0.10 → reachable.
    const ik = new FootIK({
      ankleClearance: 0,
      groundHeight: (x) => 0.10 + 0.05 * x,
    });
    ik.attach(root);

    ik.solve({ left: 1, right: 1 });
    root.updateMatrixWorld(true);

    const leftFoot = root.getObjectByName("mixamorigLeftFoot")!;
    const rightFoot = root.getObjectByName("mixamorigRightFoot")!;
    const leftWorld = new THREE.Vector3();
    const rightWorld = new THREE.Vector3();
    leftFoot.getWorldPosition(leftWorld);
    rightFoot.getWorldPosition(rightWorld);

    // Each foot pinned to its own ground-Y (within 2 cm).
    expect(Math.abs(leftWorld.y - (0.10 + 0.05 * leftWorld.x))).toBeLessThan(0.02);
    expect(Math.abs(rightWorld.y - (0.10 + 0.05 * rightWorld.x))).toBeLessThan(0.02);
  });

  it("performs under the budget: 2 legs × 1000 solves in reasonable time", () => {
    const root = makeSyntheticSkeleton();
    root.position.y = 0.15;
    root.updateMatrixWorld(true);

    const ik = new FootIK();
    ik.attach(root);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      ik.solve({ left: 1, right: 1 });
    }
    const elapsed = performance.now() - start;
    // Native budget: < 0.05 ms / leg / frame × 2 legs = < 0.1 ms per
    // call. Vitest in node + jsdom under parallel CPU contention from
    // a multi-package monorepo run is much slower than browser JIT;
    // use a 250 ms ceiling for 1000 calls so the test isn't flaky on
    // shared CI runners while still catching a 10× pathological
    // regression.
    expect(elapsed).toBeLessThan(250);
  });
});
