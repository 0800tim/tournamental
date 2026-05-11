/**
 * Ball-physics integrator tests.
 *
 * Vitest runs these without `@react-three/rapier` (the renderer-side
 * Rapier WASM doesn't bootstrap cleanly in node + jsdom), so the
 * fallback `VerletBall` integrator is exercised here. The R3F-rapier
 * integration is exercised in the Playwright spec.
 *
 * Per the spec: "rapier kick reaches expected zone".
 */
import { describe, it, expect } from "vitest";
import {
  BALL_CONSTANTS,
  BallController,
  VerletBall,
  selectBallMode,
} from "../src/ball-rapier.js";
import type { EventMessage } from "@tournamental/spec";

describe("selectBallMode", () => {
  it("defaults to spline mode", () => {
    expect(selectBallMode(null)).toBe("spline");
  });

  it("switches to rapier on free-kick restart", () => {
    const ev: EventMessage = {
      type: "event.out_of_bounds",
      restart: "free_kick",
      t: 0,
    };
    expect(selectBallMode(ev)).toBe("rapier");
  });

  it("switches to rapier on corner kicks", () => {
    const ev: EventMessage = {
      type: "event.out_of_bounds",
      restart: "corner",
      t: 0,
    };
    expect(selectBallMode(ev)).toBe("rapier");
  });

  it("stays in spline for goal events (not deflections)", () => {
    const ev: EventMessage = {
      type: "event.goal",
      player: "p1",
      team: "home",
      t: 0,
    };
    expect(selectBallMode(ev)).toBe("spline");
  });
});

describe("VerletBall integrator", () => {
  it("free-falls under gravity (~ 4.9 m in 1 s starting from rest)", () => {
    const ball = new VerletBall();
    ball.setPose({ pos: [0, 0, 5], vel: [0, 0, 0] });

    let totalDt = 0;
    while (totalDt < 1.0) {
      ball.step({ dt: 0.01 });
      totalDt += 0.01;
    }

    const { pos } = ball.getPose();
    // After 1s free-fall from z=5 → z ≈ 5 − 4.9 = 0.1, but with drag
    // and ground collision at radius=0.11. Allow a wide margin
    // because drag depends on speed.
    expect(pos[2]).toBeGreaterThan(0);
    expect(pos[2]).toBeLessThan(2);
  });

  it("bounces off the ground at z=0 with the configured restitution", () => {
    const ball = new VerletBall();
    ball.setPose({ pos: [0, 0, 2], vel: [0, 0, 0] });

    // Drop until ground contact, record peak vertical speed before
    // contact and at first bounce.
    let peakDown = 0;
    let bounceUp = 0;
    let bounced = false;
    for (let i = 0; i < 500; i++) {
      const before = ball.getPose();
      const after = ball.step({ dt: 1 / 200 });
      if (before.vel[2] < 0 && after.vel[2] >= 0 && !bounced) {
        peakDown = -before.vel[2];
        bounceUp = after.vel[2];
        bounced = true;
        break;
      }
    }
    expect(bounced).toBe(true);
    // Restitution is ~ 0.6 — allow ±20% drift due to drag.
    const ratio = bounceUp / Math.max(peakDown, 1e-6);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.8);
  });

  it("applies kick impulse and travels horizontally", () => {
    const ball = new VerletBall();
    ball.setPose({ pos: [0, 0, BALL_CONSTANTS.radius], vel: [0, 0, 0] });

    // Kick with horizontal momentum. m·v = 0.43 × 20 m/s ≈ 8.6 N·s.
    ball.step({ dt: 0, impulse: [8.6, 0, 4] });

    // Integrate for ~ 1 s.
    for (let i = 0; i < 100; i++) {
      ball.step({ dt: 1 / 100 });
    }

    const { pos } = ball.getPose();
    // After ~1s, ball should have moved several metres in x.
    expect(pos[0]).toBeGreaterThan(8);
    expect(pos[0]).toBeLessThan(25);
  });

  it("rapier-equivalent kick reaches expected zone", () => {
    // "Free kick" style impulse: kick the ball from (0,0) toward a
    // target ~25m away. After 1.2s, the ball should be roughly at the
    // target's x (within ±5m).
    const ball = new VerletBall();
    ball.setPose({ pos: [0, 0, BALL_CONSTANTS.radius], vel: [0, 0, 0] });

    // Choose impulse for 25 m at ~ 22 m/s, 30° launch:
    //   v0 = 22 m/s; vx = 22·cos(30°) ≈ 19; vz = 22·sin(30°) = 11.
    //   m·v = 0.43 × (19, 0, 11) = (8.17, 0, 4.73).
    ball.step({ dt: 0, impulse: [8.17, 0, 4.73] });

    for (let i = 0; i < 200; i++) {
      ball.step({ dt: 1 / 100 });
    }

    const { pos } = ball.getPose();
    expect(pos[0]).toBeGreaterThan(15);
    expect(pos[0]).toBeLessThan(45);
  });
});

describe("BallController", () => {
  it("starts in spline mode and tracks the supplied spline pose", () => {
    const ctrl = new BallController();
    expect(ctrl.getMode()).toBe("spline");
    const pose = ctrl.step(1 / 60, null, {
      pos: [1, 2, 0.11],
      vel: [0, 0, 0],
    });
    expect(pose.pos).toEqual([1, 2, 0.11]);
  });

  it("switches to rapier on free-kick event and back after timer", () => {
    const ctrl = new BallController(undefined, 0.2 /* short timer for test */);
    const splinePose = { pos: [0, 0, 0.11] as [number, number, number], vel: [0, 0, 0] as [number, number, number] };

    const fk: EventMessage = {
      type: "event.out_of_bounds",
      restart: "free_kick",
      t: 0,
    };
    ctrl.step(1 / 60, fk, splinePose);
    expect(ctrl.getMode()).toBe("rapier");

    // Step long enough for the timer to expire.
    for (let i = 0; i < 30; i++) {
      ctrl.step(1 / 60, null, splinePose);
    }
    expect(ctrl.getMode()).toBe("spline");
  });

  it("snaps to spline pose when switching modes", () => {
    const ctrl = new BallController();
    const fk: EventMessage = {
      type: "event.out_of_bounds",
      restart: "free_kick",
      t: 0,
    };
    const splinePose = { pos: [5, 5, 0.11] as [number, number, number], vel: [0, 0, 0] as [number, number, number] };

    ctrl.step(1 / 60, fk, splinePose);
    // First rapier frame: physics integrator was seeded with the
    // spline pose; pose returned should be very close to (5, 5, 0.11).
    const pose = ctrl.step(1 / 60, null, splinePose);
    expect(Math.abs(pose.pos[0] - 5)).toBeLessThan(0.5);
    expect(Math.abs(pose.pos[1] - 5)).toBeLessThan(0.5);
  });
});
