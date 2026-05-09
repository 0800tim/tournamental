import { describe, expect, it } from "vitest";
import { formatTime, projectScoreAt } from "@/components/TimelineScrubber";
import type { EventMessage } from "@vtorn/spec";

describe("formatTime", () => {
  it("renders as MM:SS under an hour", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(59_000)).toBe("0:59");
    expect(formatTime(60_000)).toBe("1:00");
    expect(formatTime(23 * 60_000 + 4_000)).toBe("23:04");
  });

  it("renders as H:MM:SS over an hour", () => {
    expect(formatTime(3_600_000)).toBe("1:00:00");
    expect(formatTime(2 * 3_600_000 + 30 * 60_000)).toBe("2:30:00");
  });

  it("clamps negative input to zero", () => {
    expect(formatTime(-1000)).toBe("0:00");
  });
});

describe("projectScoreAt", () => {
  const events: EventMessage[] = [
    { type: "event.score_change", t: 1_380_000, home: 1, away: 0 },
    { type: "event.score_change", t: 2_160_000, home: 2, away: 0 },
    { type: "event.score_change", t: 4_800_000, home: 2, away: 1 },
    { type: "event.score_change", t: 4_860_000, home: 2, away: 2 },
  ];

  it("returns 0-0 before any score change", () => {
    expect(projectScoreAt(events, 0)).toEqual({ home: 0, away: 0 });
    expect(projectScoreAt(events, 1_000_000)).toEqual({ home: 0, away: 0 });
  });

  it("returns the last score change ≤ t", () => {
    expect(projectScoreAt(events, 1_400_000)).toEqual({ home: 1, away: 0 });
    expect(projectScoreAt(events, 4_800_001)).toEqual({ home: 2, away: 1 });
    expect(projectScoreAt(events, 9_999_999)).toEqual({ home: 2, away: 2 });
  });
});
