/**
 * Unit tests for the parametric stadium geometry builder.
 */
import { describe, expect, it } from "vitest";
import { buildSeatingTier } from "@/lib/stadium-geometry";

describe("buildSeatingTier", () => {
  const tier = buildSeatingTier({
    innerRadiusLong: 54,
    innerRadiusShort: 36,
    depth: 6,
    rise: 4,
    baseY: 0.5,
    tilt: 0.15,
    segments: 12,
    seatColour: "#7d1416",
  });

  it("emits one slice per segment", () => {
    expect(tier.slices).toHaveLength(12);
  });

  it("preserves the input parameters", () => {
    expect(tier.segments).toBe(12);
    expect(tier.baseY).toBe(0.5);
    expect(tier.rise).toBe(4);
    expect(tier.depth).toBe(6);
    expect(tier.seatColour).toBe("#7d1416");
  });

  it("centres each slice at the box's mid-Y", () => {
    for (const slice of tier.slices) {
      expect(slice.position[1]).toBeCloseTo(0.5 + 4 / 2, 5);
    }
  });

  it("places slices around an elliptical ring (X/Z axes)", () => {
    // We can only assert the cardinal slices land exactly on the
    // ellipse — diagonal slices use the parametric (cos*rx, sin*rz)
    // form which is NOT a constant-radius ring.
    // Slice 0 is at angle 0 → (rx, 0).
    expect(tier.slices[0].position[0]).toBeCloseTo(54 + 3, 3);
    expect(tier.slices[0].position[2]).toBeCloseTo(0, 3);
    // Slice 3 (90°) → (0, rz).
    expect(tier.slices[3].position[0]).toBeCloseTo(0, 3);
    expect(tier.slices[3].position[2]).toBeCloseTo(36 + 3, 3);
    // Slice 6 (180°) → (-rx, 0).
    expect(tier.slices[6].position[0]).toBeCloseTo(-(54 + 3), 3);
    expect(tier.slices[6].position[2]).toBeCloseTo(0, 3);
    // Slice 9 (270°) → (0, -rz).
    expect(tier.slices[9].position[0]).toBeCloseTo(0, 3);
    expect(tier.slices[9].position[2]).toBeCloseTo(-(36 + 3), 3);
  });

  it("yaws each slice tangent to the ring", () => {
    // slice 0 is at angle 0 → yaw should be PI/2.
    const s0 = tier.slices[0];
    expect(s0.rotation[1]).toBeCloseTo(Math.PI / 2, 3);
    // slice at angle PI → yaw 3PI/2.
    const sHalf = tier.slices[6];
    expect(sHalf.rotation[1]).toBeCloseTo(Math.PI + Math.PI / 2, 3);
  });

  it("applies the input tilt to all slices", () => {
    for (const slice of tier.slices) {
      expect(slice.rotation[0]).toBe(-0.15);
    }
  });

  it("box width is roughly the arc length per segment", () => {
    // arc length per segment is 2π*r/12 with our 5% overlap
    const expected =
      ((54 + 36) / 2) * ((Math.PI * 2) / 12) * 1.05;
    for (const slice of tier.slices) {
      expect(slice.size[0]).toBeCloseTo(expected, 3);
    }
  });

  it("box height equals the tier rise", () => {
    for (const slice of tier.slices) {
      expect(slice.size[1]).toBe(4);
    }
  });

  it("box depth equals the tier depth", () => {
    for (const slice of tier.slices) {
      expect(slice.size[2]).toBe(6);
    }
  });
});
