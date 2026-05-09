import { describe, expect, it } from "vitest";
import { toWorld, toWorldYaw, toWorldInto } from "@/lib/coords";
import { Vector3 } from "three";

describe("coords.toWorld", () => {
  it("maps 2D spec coords to (x, 0, -y)", () => {
    const v = toWorld([10, 20]);
    expect(v.x).toBe(10);
    expect(v.y).toBe(0);
    expect(v.z).toBe(-20);
  });

  it("maps 3D spec coords to (x, z, -y)", () => {
    const v = toWorld([10, 20, 5]);
    expect(v.x).toBe(10);
    expect(v.y).toBe(5);
    expect(v.z).toBe(-20);
  });

  it("origin maps to origin", () => {
    const a = toWorld([0, 0]).toArray();
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(0);
    expect(Math.abs(a[2])).toBe(0);
    const b = toWorld([0, 0, 0]).toArray();
    expect(b[0]).toBe(0);
    expect(b[1]).toBe(0);
    expect(Math.abs(b[2])).toBe(0);
  });
});

describe("coords.toWorldYaw", () => {
  it("flips sign of yaw", () => {
    expect(toWorldYaw(0)).toBe(-0);
    expect(toWorldYaw(Math.PI / 2)).toBe(-Math.PI / 2);
    expect(toWorldYaw(-Math.PI / 4)).toBe(Math.PI / 4);
  });
});

describe("coords.toWorldInto", () => {
  it("writes into an existing vector without allocating", () => {
    const out = new Vector3();
    const ret = toWorldInto(out, [3, 4]);
    expect(ret).toBe(out);
    expect(out.toArray()).toEqual([3, 0, -4]);
  });

  it("handles 3D input", () => {
    const out = new Vector3();
    toWorldInto(out, [1, 2, 3]);
    expect(out.toArray()).toEqual([1, 3, -2]);
  });
});
