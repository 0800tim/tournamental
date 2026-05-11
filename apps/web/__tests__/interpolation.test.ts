import { describe, expect, it } from "vitest";
import {
  alphaForNow,
  clamp01,
  estimateSpeed,
  extrapolateBall,
  interpolateBall,
  interpolatePlayer,
  lerp,
  lerpVec2,
  lerpVec3,
  slerpAngle,
} from "@/lib/interpolation";
import type { StateFrame } from "@tournamental/spec";

describe("interpolation primitives", () => {
  it("clamps to [0, 1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.5)).toBe(1);
  });

  it("lerps scalars", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it("lerps Vec2 / Vec3", () => {
    expect(lerpVec2([0, 0], [10, 20], 0.5)).toEqual([5, 10]);
    expect(lerpVec3([0, 0, 0], [10, 20, 30], 0.25)).toEqual([2.5, 5, 7.5]);
  });

  it("slerpAngle takes the short path across the wraparound", () => {
    // From 170° to -170° should be a +20° rotation, not -340°.
    const a = (170 * Math.PI) / 180;
    const b = (-170 * Math.PI) / 180;
    const out = slerpAngle(a, b, 0.5);
    // Halfway should be at ±180° i.e. close to π or -π.
    expect(Math.abs(Math.abs(out) - Math.PI)).toBeLessThan(0.001);
  });

  it("slerpAngle handles same value", () => {
    expect(slerpAngle(1, 1, 0.5)).toBeCloseTo(1, 6);
  });
});

describe("alphaForNow", () => {
  it("returns 1 when span is zero", () => {
    expect(alphaForNow(100, 100, 100)).toBe(1);
  });

  it("clamps below 0 when now is far behind prev", () => {
    // now < prev → would be negative, clamp01 brings it to 0.
    expect(alphaForNow(100, 200, -1000)).toBe(0);
  });

  it("clamps above 1 when now is past curr", () => {
    expect(alphaForNow(100, 200, 9999)).toBe(1);
  });
});

const frame = (t: number, players: { id: string; pos: [number, number]; facing?: number }[]): StateFrame => ({
  type: "state",
  t,
  ball: { pos: [0, 0, 0] },
  players: players.map((p) => ({
    id: p.id,
    pos: p.pos,
    facing: p.facing ?? 0,
    anim: "idle",
  })),
});

describe("interpolatePlayer", () => {
  it("returns null when player is missing in curr", () => {
    const f = frame(100, []);
    expect(interpolatePlayer(null, f, "x", 0.5)).toBeNull();
  });

  it("returns curr if prev is null", () => {
    const f = frame(100, [{ id: "p1", pos: [10, 20] }]);
    const out = interpolatePlayer(null, f, "p1", 0.5);
    expect(out?.pos).toEqual([10, 20]);
  });

  it("lerps pos and facing between frames", () => {
    const a = frame(0, [{ id: "p1", pos: [0, 0], facing: 0 }]);
    const b = frame(100, [{ id: "p1", pos: [10, 20], facing: Math.PI / 2 }]);
    const out = interpolatePlayer(a, b, "p1", 0.5);
    expect(out?.pos).toEqual([5, 10]);
    expect(out?.facing).toBeCloseTo(Math.PI / 4, 5);
  });
});

describe("interpolateBall", () => {
  it("lerps the ball between frames", () => {
    const a: StateFrame = { type: "state", t: 0, ball: { pos: [0, 0, 0] }, players: [] };
    const b: StateFrame = { type: "state", t: 100, ball: { pos: [10, 20, 5] }, players: [] };
    expect(interpolateBall(a, b, 0.5)?.pos).toEqual([5, 10, 2.5]);
  });
});

describe("extrapolateBall", () => {
  it("walks forward by velocity, capped at maxMs", () => {
    const out = extrapolateBall(
      { pos: [0, 0, 0], vel: [10, 0, 0] },
      400,
      200,
    );
    // 10 m/s for 0.2s = 2 m.
    expect(out.pos[0]).toBeCloseTo(2, 5);
  });

  it("returns the input unchanged when velocity is missing", () => {
    const out = extrapolateBall({ pos: [1, 2, 3] }, 100);
    expect(out.pos).toEqual([1, 2, 3]);
  });
});

describe("estimateSpeed", () => {
  it("returns 0 with missing frames", () => {
    expect(estimateSpeed(null, null, "p")).toBe(0);
  });

  it("computes magnitude / dt", () => {
    const a = frame(0, [{ id: "p", pos: [0, 0] }]);
    const b = frame(1000, [{ id: "p", pos: [3, 4] }]); // moves 5m in 1s
    expect(estimateSpeed(a, b, "p")).toBeCloseTo(5, 5);
  });
});
