/**
 * PlayerLOD bucket-classification tests.
 *
 * The selector lives at `components/PlayerLOD.tsx` but its hot logic
 * (`classifyLODBucket`) is pure so we unit-test it without R3F. The
 * hysteresis + previous-bucket interaction is the main correctness
 * concern — we don't want a player oscillating between HIGH/MED at the
 * 14.9 m boundary.
 */
import { describe, it, expect } from "vitest";
import {
  classifyLODBucket,
  LOD_THRESHOLDS,
} from "@/components/PlayerLOD";

describe("classifyLODBucket", () => {
  it("returns 'high' below 15 m", () => {
    expect(classifyLODBucket(5, "high")).toBe("high");
    expect(classifyLODBucket(14, "high")).toBe("high");
  });

  it("returns 'med' between 15 m and 35 m", () => {
    expect(classifyLODBucket(20, "high")).toBe("med");
    expect(classifyLODBucket(34, "med")).toBe("med");
  });

  it("returns 'low' above 35 m", () => {
    expect(classifyLODBucket(40, "med")).toBe("low");
    expect(classifyLODBucket(100, "low")).toBe("low");
  });

  it("HIGH→MED requires crossing highMax + hysteresis", () => {
    expect(classifyLODBucket(15.5, "high")).toBe("high");
    expect(classifyLODBucket(17, "high")).toBe("med");
  });

  it("MED→HIGH only when distance drops below highMax", () => {
    expect(classifyLODBucket(14, "med")).toBe("high");
    expect(classifyLODBucket(15.5, "med")).toBe("med");
  });

  it("MED→LOW requires crossing medMax + hysteresis", () => {
    expect(classifyLODBucket(35.5, "med")).toBe("med");
    expect(classifyLODBucket(37, "med")).toBe("low");
  });

  it("LOW→MED only re-enters once we drop below medMax - hysteresis", () => {
    expect(classifyLODBucket(34, "low")).toBe("low");
    expect(classifyLODBucket(33, "low")).toBe("med");
  });

  it("LOD_THRESHOLDS are sane defaults", () => {
    expect(LOD_THRESHOLDS.highMax).toBe(15);
    expect(LOD_THRESHOLDS.medMax).toBe(35);
    expect(LOD_THRESHOLDS.hysteresis).toBeGreaterThan(0);
  });
});
