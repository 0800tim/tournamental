/**
 * Phase-4 Magnus tests.
 */
import { describe, it, expect } from "vitest";
import {
  liftCoefficient,
  spinParameter,
  magnusSpinFromShot,
  magnusForce,
  splinePeakLateralOffset,
  magnusSplineSideForce,
  magnusSideForce,
} from "../src/magnus.js";
import { BALL_CONSTANTS, VerletBall } from "../src/ball-rapier.js";

describe("liftCoefficient", () => {
  it("returns 0 for sub-threshold spin parameter", () => {
    expect(liftCoefficient(0)).toBe(0);
    expect(liftCoefficient(0.04)).toBe(0);
  });

  it("returns ~0.18 at S=0.05, ~0.25 at S=0.15", () => {
    expect(liftCoefficient(0.05)).toBeCloseTo(0.18, 2);
    expect(liftCoefficient(0.15)).toBeCloseTo(0.25, 2);
  });

  it("clamps at 0.32 for high spin parameters", () => {
    expect(liftCoefficient(0.5)).toBeCloseTo(0.32, 2);
    expect(liftCoefficient(2.0)).toBeCloseTo(0.32, 2);
  });

  it("treats |S| symmetrically (sign-invariant)", () => {
    expect(liftCoefficient(-0.2)).toBeCloseTo(liftCoefficient(0.2), 5);
  });
});

describe("spinParameter", () => {
  it("returns ωr/v for positive speeds", () => {
    const S = spinParameter(50, 25);
    expect(S).toBeCloseTo((50 * BALL_CONSTANTS.radius) / 25, 5);
  });

  it("returns 0 for zero / near-zero speed", () => {
    expect(spinParameter(50, 0)).toBe(0);
    expect(spinParameter(50, 1e-9)).toBe(0);
  });
});

describe("magnusSpinFromShot — categories", () => {
  it("free-kick: ~10 rev/s, ω on +z, curl='left' for right-foot in-swinger", () => {
    const est = magnusSpinFromShot({ category: "free_kick", preferredFoot: "right" });
    expect(est.revPerSec).toBeCloseTo(10, 0);
    expect(est.curl).toBe("left");
    expect(est.omega[2]).toBeGreaterThan(0);
  });

  it("free-kick left-foot: ω on -z, curl='right'", () => {
    const est = magnusSpinFromShot({ category: "free_kick", preferredFoot: "left" });
    expect(est.curl).toBe("right");
    expect(est.omega[2]).toBeLessThan(0);
  });

  it("knuckleball: zero spin, curl='knuckle'", () => {
    const est = magnusSpinFromShot({ category: "knuckleball" });
    expect(est.revPerSec).toBe(0);
    expect(est.curl).toBe("knuckle");
    expect(est.omega).toEqual([0, 0, 0]);
  });

  it("corner: ~8 rev/s", () => {
    const est = magnusSpinFromShot({ category: "corner" });
    expect(est.revPerSec).toBeCloseTo(8, 0);
  });

  it("lob: backspin flavour, no horizontal axis", () => {
    const est = magnusSpinFromShot({ category: "lob" });
    expect(est.curl).toBe("backspin");
  });

  it("explicit run-up angle overrides foot-based default", () => {
    const est = magnusSpinFromShot({
      category: "free_kick",
      preferredFoot: "right",
      runUpAngleDeg: -30,
    });
    expect(est.curl).toBe("right");
    expect(est.omega[2]).toBeLessThan(0);
  });
});

describe("magnusForce — physical side-force", () => {
  it("returns zero for zero spin", () => {
    expect(magnusForce([0, 0, 0], [25, 0, 0])).toEqual([0, 0, 0]);
  });

  it("returns zero for zero velocity", () => {
    expect(magnusForce([0, 0, 60], [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("is orthogonal to both ω and v", () => {
    const omega: [number, number, number] = [0, 0, 60];
    const v: [number, number, number] = [25, 0, 0];
    const F = magnusForce(omega, v);
    const dotOmega = F[0] * omega[0] + F[1] * omega[1] + F[2] * omega[2];
    const dotV = F[0] * v[0] + F[1] * v[1] + F[2] * v[2];
    expect(Math.abs(dotOmega)).toBeLessThan(1e-6);
    expect(Math.abs(dotV)).toBeLessThan(1e-6);
  });

  it("for +z spin and +x travel, force is along +y", () => {
    const F = magnusForce([0, 0, 60], [25, 0, 0]);
    expect(F[1]).toBeGreaterThan(0);
    expect(Math.abs(F[0])).toBeLessThan(1e-6);
  });

  it("force magnitude scales with v² (approximately)", () => {
    const F1 = magnusForce([0, 0, 60], [10, 0, 0]);
    const F2 = magnusForce([0, 0, 60], [20, 0, 0]);
    const m1 = Math.hypot(F1[0], F1[1], F1[2]);
    const m2 = Math.hypot(F2[0], F2[1], F2[2]);
    expect(m2 / m1).toBeGreaterThan(2.5);
    expect(m2 / m1).toBeLessThan(5);
  });
});

describe("splinePeakLateralOffset", () => {
  it("returns 0 for zero spin or zero flight time", () => {
    expect(splinePeakLateralOffset([0, 0, 0], 25, 1.5)).toBe(0);
    expect(splinePeakLateralOffset([0, 0, 60], 25, 0)).toBe(0);
  });

  it("calibration free kick (25 m, 27 m/s, 10 rev/s): peak offset in [0.5, 2.5] m", () => {
    const omega: [number, number, number] = [0, 0, 10 * 2 * Math.PI];
    const offset = splinePeakLateralOffset(omega, 27, 25 / 27);
    expect(offset).toBeGreaterThan(0.5);
    expect(offset).toBeLessThan(2.5);
  });

  it("higher spin → larger offset (monotonicity)", () => {
    const flightSec = 1.0;
    const offsetLow = splinePeakLateralOffset([0, 0, 30], 25, flightSec);
    const offsetHigh = splinePeakLateralOffset([0, 0, 90], 25, flightSec);
    expect(offsetHigh).toBeGreaterThan(offsetLow);
  });
});

describe("magnusSplineSideForce — high-level helper", () => {
  it("returns zero for knuckleball events", () => {
    const f = magnusSplineSideForce(
      { category: "knuckleball", speed: 25 },
      [1, 0, 0],
      1.0,
    );
    expect(f).toEqual([0, 0, 0]);
  });

  it("returns a +y vector for right-foot free kick travelling +x", () => {
    const f = magnusSplineSideForce(
      { category: "free_kick", preferredFoot: "right", speed: 27 },
      [1, 0, 0],
      25 / 27,
    );
    expect(f[1]).toBeGreaterThan(0);
    expect(Math.abs(f[0])).toBeLessThan(1e-6);
  });

  it("respects custom run-up angles for left/right curl", () => {
    const fLeft = magnusSplineSideForce(
      { category: "free_kick", runUpAngleDeg: 30, speed: 25 },
      [1, 0, 0],
      1.0,
    );
    const fRight = magnusSplineSideForce(
      { category: "free_kick", runUpAngleDeg: -30, speed: 25 },
      [1, 0, 0],
      1.0,
    );
    expect(Math.sign(fLeft[1])).not.toBe(Math.sign(fRight[1]));
  });

  it("backspin lobs return an upward (positive z) force", () => {
    const f = magnusSplineSideForce(
      { category: "lob", speed: 15 },
      [1, 0, 0],
      1.5,
    );
    expect(f[2]).toBeGreaterThan(0);
  });
});

describe("magnusSideForce — knuckleball is zero", () => {
  it("returns zero vector for curl='knuckle'", () => {
    const f = magnusSideForce({ travelDir: [1, 0, 0], curl: "knuckle", strength: 1 });
    expect(f).toEqual([0, 0, 0]);
  });
});

describe("VerletBall integrator with spin", () => {
  it("non-zero spin curves a kicked ball laterally vs. a no-spin baseline", () => {
    const baseline = new VerletBall();
    baseline.setPose({ pos: [0, 0, BALL_CONSTANTS.radius], vel: [0, 0, 0] });
    baseline.step({ dt: 0, impulse: [BALL_CONSTANTS.mass * 25, 0, BALL_CONSTANTS.mass * 4] });

    const curved = new VerletBall();
    curved.setPose({ pos: [0, 0, BALL_CONSTANTS.radius], vel: [0, 0, 0] });
    curved.setSpin([0, 0, 70]);
    curved.step({ dt: 0, impulse: [BALL_CONSTANTS.mass * 25, 0, BALL_CONSTANTS.mass * 4] });

    for (let i = 0; i < 80; i++) {
      baseline.step({ dt: 1 / 100 });
      curved.step({ dt: 1 / 100 });
    }

    const baseY = baseline.getPose().pos[1];
    const curvedY = curved.getPose().pos[1];
    expect(Math.abs(baseY)).toBeLessThan(0.05);
    expect(curvedY - baseY).toBeGreaterThan(0.4);
  });

  it("getSpin reflects setSpin and decays slowly with dt", () => {
    const ball = new VerletBall();
    ball.setSpin([0, 0, 60]);
    expect(ball.getSpin()).toEqual([0, 0, 60]);
    for (let i = 0; i < 100; i++) {
      ball.step({ dt: 1 / 100 });
    }
    const decayed = ball.getSpin()[2];
    expect(decayed).toBeLessThan(60);
    expect(decayed).toBeGreaterThan(58);
  });

  it("calibration: free kick at ~25 m, 27 m/s, 10 rev/s — visible curl when ball reaches goal-line", () => {
    const ball = new VerletBall();
    ball.setPose({ pos: [0, 0, BALL_CONSTANTS.radius], vel: [0, 0, 0] });
    ball.step({
      dt: 0,
      impulse: [BALL_CONSTANTS.mass * 26.4, 0, BALL_CONSTANTS.mass * 5.6],
      setSpin: [0, 0, 10 * 2 * Math.PI],
    });
    let endY = 0;
    for (let i = 0; i < 500; i++) {
      ball.step({ dt: 1 / 100 });
      const pose = ball.getPose();
      if (pose.pos[0] >= 25) {
        endY = pose.pos[1];
        break;
      }
    }
    expect(Math.abs(endY)).toBeGreaterThan(0.5);
    expect(Math.abs(endY)).toBeLessThan(6.0);
  });
});
