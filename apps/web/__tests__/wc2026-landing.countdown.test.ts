/**
 * Vitest, pure countdown math.
 */

import { describe, it, expect } from "vitest";

import {
  countdownTo,
  pad2,
  TOURNAMENT_KICKOFF_UTC,
} from "../app/world-cup-2026/landing/_lib/countdown";

describe("countdownTo", () => {
  it("returns kickedOff=false and a positive total before kickoff", () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const r = countdownTo(TOURNAMENT_KICKOFF_UTC, now);
    expect(r.kickedOff).toBe(false);
    expect(r.totalMs).toBeGreaterThan(0);
    expect(r.days).toBe(33);
  });

  it("breaks the remainder cleanly into hours/minutes/seconds", () => {
    // Target = 2026-06-11T19:00:00Z; Now  = 2026-06-10T17:54:30Z
    // Delta = 1d 1h 5m 30s
    const now = new Date("2026-06-10T17:54:30Z");
    const r = countdownTo(TOURNAMENT_KICKOFF_UTC, now);
    expect(r.days).toBe(1);
    expect(r.hours).toBe(1);
    expect(r.minutes).toBe(5);
    expect(r.seconds).toBe(30);
  });

  it("flips kickedOff=true at and after kickoff", () => {
    const exactly = new Date("2026-06-11T19:00:00Z");
    const after = new Date("2026-06-11T19:00:01Z");
    expect(countdownTo(TOURNAMENT_KICKOFF_UTC, exactly).kickedOff).toBe(true);
    expect(countdownTo(TOURNAMENT_KICKOFF_UTC, after).kickedOff).toBe(true);
  });

  it("clamps totalMs to 0 once we're past kickoff", () => {
    const after = new Date("2026-07-01T00:00:00Z");
    const r = countdownTo(TOURNAMENT_KICKOFF_UTC, after);
    expect(r.totalMs).toBe(0);
    expect(r.days).toBe(0);
    expect(r.hours).toBe(0);
    expect(r.minutes).toBe(0);
    expect(r.seconds).toBe(0);
  });

  it("rejects an invalid ISO target", () => {
    expect(() => countdownTo("not-a-date")).toThrow();
  });
});

describe("pad2", () => {
  it("zero-pads single digits", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(7)).toBe("07");
    expect(pad2(10)).toBe("10");
    expect(pad2(99)).toBe("99");
  });
});
