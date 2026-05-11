import { describe, expect, it } from "vitest";
import type { StateFrame } from "@vtorn/spec";
import {
  StateFrameBuffer,
  catmullRom3,
} from "@/lib/replay/state-frame-buffer";

const f = (
  t: number,
  ball: [number, number, number],
  players: { id: string; pos: [number, number]; facing?: number }[] = [],
): StateFrame => ({
  type: "state",
  t,
  ball: { pos: ball },
  players: players.map((p) => ({
    id: p.id,
    pos: p.pos,
    facing: p.facing ?? 0,
    anim: "idle",
  })),
});

describe("catmullRom3", () => {
  it("interpolates linearly through control points at integer t", () => {
    // At t=0 we expect p1; at t=1 we expect p2.
    const p0: [number, number, number] = [0, 0, 0];
    const p1: [number, number, number] = [1, 1, 1];
    const p2: [number, number, number] = [2, 2, 2];
    const p3: [number, number, number] = [3, 3, 3];
    expect(catmullRom3(p0, p1, p2, p3, 0)).toEqual(p1);
    expect(catmullRom3(p0, p1, p2, p3, 1)).toEqual(p2);
  });

  it("on a straight line all four points collinear → midpoint is the linear midpoint", () => {
    const p0: [number, number, number] = [0, 0, 0];
    const p1: [number, number, number] = [1, 0, 0];
    const p2: [number, number, number] = [2, 0, 0];
    const p3: [number, number, number] = [3, 0, 0];
    const m = catmullRom3(p0, p1, p2, p3, 0.5);
    expect(m[0]).toBeCloseTo(1.5, 6);
    expect(m[1]).toBeCloseTo(0, 6);
    expect(m[2]).toBeCloseTo(0, 6);
  });

  it("does not extrapolate beyond p1..p2 with a sane curvature", () => {
    // Concave-up control points; the interpolated y at t=0.5 should be
    // between p1.y and p2.y or reasonably close (catmull-rom can
    // overshoot slightly, but not wildly).
    const p0: [number, number, number] = [0, 0, 0];
    const p1: [number, number, number] = [1, 1, 0];
    const p2: [number, number, number] = [2, 1, 0];
    const p3: [number, number, number] = [3, 0, 0];
    const m = catmullRom3(p0, p1, p2, p3, 0.5);
    expect(m[1]).toBeGreaterThan(0.9);
    expect(m[1]).toBeLessThan(1.5);
  });
});

describe("StateFrameBuffer", () => {
  it("returns null sample before any push", () => {
    const buf = new StateFrameBuffer();
    expect(buf.sample()).toBeNull();
    expect(buf.size()).toBe(0);
    expect(buf.latest()).toBeNull();
  });

  it("returns single-frame sample as a copy of that frame", () => {
    const buf = new StateFrameBuffer();
    buf.push(f(100, [1, 2, 3], [{ id: "p1", pos: [4, 5] }]));
    const s = buf.sampleAt(100);
    expect(s).not.toBeNull();
    expect(s?.ball.pos).toEqual([1, 2, 3]);
    expect(s?.players[0].pos).toEqual([4, 5]);
  });

  it("clamps queries below the first buffered frame", () => {
    const buf = new StateFrameBuffer();
    buf.push(f(100, [0, 0, 0]));
    buf.push(f(200, [10, 0, 0]));
    const s = buf.sampleAt(0);
    expect(s?.ball.pos).toEqual([0, 0, 0]);
  });

  it("clamps queries past the last buffered frame", () => {
    const buf = new StateFrameBuffer();
    buf.push(f(100, [0, 0, 0]));
    buf.push(f(200, [10, 0, 0]));
    const s = buf.sampleAt(99999);
    expect(s?.ball.pos).toEqual([10, 0, 0]);
  });

  it("linear-interpolates player position at the bracket midpoint", () => {
    const buf = new StateFrameBuffer();
    buf.push(f(0, [0, 0, 0], [{ id: "p1", pos: [0, 0] }]));
    buf.push(f(1000, [0, 0, 0], [{ id: "p1", pos: [10, 20] }]));
    const s = buf.sampleAt(500);
    expect(s?.players[0].pos).toEqual([5, 10]);
  });

  it("slerps yaw across the wraparound (shortest-arc)", () => {
    const buf = new StateFrameBuffer();
    const a = (170 * Math.PI) / 180;
    const b = (-170 * Math.PI) / 180;
    buf.push(f(0, [0, 0, 0], [{ id: "p1", pos: [0, 0], facing: a }]));
    buf.push(f(1000, [0, 0, 0], [{ id: "p1", pos: [0, 0], facing: b }]));
    const s = buf.sampleAt(500);
    // Halfway should wrap through ±π, not pass through 0.
    const yaw = s?.players[0].facing ?? 0;
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(0.001);
  });

  it("uses Catmull-Rom for the ball when 4 frames bracket", () => {
    const buf = new StateFrameBuffer();
    // Straight line ball trajectory: catmull-rom should match linear.
    buf.push(f(0, [0, 0, 0]));
    buf.push(f(100, [1, 0, 0]));
    buf.push(f(200, [2, 0, 0]));
    buf.push(f(300, [3, 0, 0]));
    const s = buf.sampleAt(150); // midpoint of segment 100→200
    expect(s?.ball.pos[0]).toBeCloseTo(1.5, 6);
  });

  it("falls back to linear ball lerp when only the bracketing pair is available", () => {
    const buf = new StateFrameBuffer();
    buf.push(f(0, [0, 0, 0]));
    buf.push(f(100, [10, 0, 0]));
    const s = buf.sampleAt(25);
    expect(s?.ball.pos[0]).toBeCloseTo(2.5, 6);
  });

  it("drops out-of-order frames", () => {
    const buf = new StateFrameBuffer();
    buf.push(f(100, [1, 0, 0]));
    buf.push(f(50, [99, 0, 0])); // out of order, drop
    expect(buf.size()).toBe(1);
    expect(buf.latest()?.t).toBe(100);
  });

  it("respects capacity and discards the oldest frame", () => {
    const buf = new StateFrameBuffer({ capacity: 3 });
    buf.push(f(100, [1, 0, 0]));
    buf.push(f(200, [2, 0, 0]));
    buf.push(f(300, [3, 0, 0]));
    buf.push(f(400, [4, 0, 0]));
    expect(buf.size()).toBe(3);
    // Earliest frame is now t=200 (t=100 was evicted).
    expect(buf.sampleAt(0)?.ball.pos[0]).toBe(2);
  });

  it("anchors monotonically at real-time pace", () => {
    let wall = 1000;
    const buf = new StateFrameBuffer({ now: () => wall });
    // Real-time pace: each frame is 100 ms apart in match-time and
    // 100 ms apart in wall-clock.
    buf.push(f(0, [0, 0, 0]));
    wall += 100;
    buf.push(f(100, [0, 0, 0]));
    wall += 100;
    buf.push(f(200, [0, 0, 0]));
    const a = buf.debugAnchor();
    expect(a?.matchMs).toBe(200);
    expect(a?.wallMs).toBe(1200);
  });

  it("burst arrivals do NOT slide the anchor forward", () => {
    let wall = 0;
    const buf = new StateFrameBuffer({ now: () => wall });
    // Burst: 4 frames in the same wall-clock instant.
    buf.push(f(0, [0, 0, 0]));
    buf.push(f(1000, [0, 0, 0]));
    buf.push(f(2000, [0, 0, 0]));
    buf.push(f(3000, [0, 0, 0]));
    const a = buf.debugAnchor();
    expect(a?.matchMs).toBe(0);
    expect(a?.wallMs).toBe(0);
  });

  it("currentMatchTime advances at real-time pace from the anchor", () => {
    let wall = 0;
    const buf = new StateFrameBuffer({ now: () => wall });
    buf.push(f(0, [0, 0, 0]));
    buf.push(f(1000, [10, 0, 0]));
    buf.push(f(2000, [20, 0, 0]));
    // anchor sits at the first frame; after 500 ms wall-clock, current
    // match-time should be 500 (not 2000).
    wall = 500;
    expect(buf.currentMatchTime()).toBe(500);
    // After 1500 ms, current match-time should be 1500.
    wall = 1500;
    expect(buf.currentMatchTime()).toBe(1500);
    // After 5000 ms (past the head), it clamps to head t.
    wall = 5000;
    expect(buf.currentMatchTime()).toBe(2000);
  });

  it("reset clears frames and the anchor", () => {
    const buf = new StateFrameBuffer();
    buf.push(f(0, [0, 0, 0]));
    buf.push(f(100, [10, 0, 0]));
    buf.reset();
    expect(buf.size()).toBe(0);
    expect(buf.debugAnchor()).toBeNull();
    expect(buf.sample()).toBeNull();
  });
});
