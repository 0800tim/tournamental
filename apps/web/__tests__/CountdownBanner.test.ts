/**
 * Vitest, pure-function test for CountdownBanner.computeParts.
 * Verifies day/hour/minute/second decomposition and the elapsed flag.
 */

import { describe, it, expect } from "vitest";

import { computeParts } from "@/components/ui/CountdownBanner";

describe("computeParts", () => {
  it("decomposes a future delta correctly", () => {
    const target = Date.UTC(2026, 5, 11, 18, 0, 0);
    const now = Date.UTC(2026, 5, 9, 17, 30, 15); // 2 days, 0h 29m 45s before
    const parts = computeParts(target, now);
    expect(parts.elapsed).toBe(false);
    expect(parts.days).toBe(2);
    expect(parts.hours).toBe(0);
    expect(parts.minutes).toBe(29);
    expect(parts.seconds).toBe(45);
  });

  it("flags elapsed when target is in the past", () => {
    const parts = computeParts(1000, 2000);
    expect(parts.elapsed).toBe(true);
    expect(parts.days).toBe(0);
    expect(parts.seconds).toBe(0);
  });
});
