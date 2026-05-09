/**
 * Event coverage: a default 90-min match emits every standard event type
 * at least once. Per docs/05-mock-producer.md acceptance:
 *   kickoff, pass, shot, goal, save, tackle, foul, out_of_bounds,
 *   substitution, period_start, period_end, match_end.
 */
import { describe, it, expect } from "vitest";
import { runSimulation, defaultTeams } from "../src/index.js";

const REQUIRED: ReadonlyArray<string> = [
  "event.kickoff",
  "event.pass",
  "event.shot",
  "event.goal",
  "event.save",
  "event.tackle",
  "event.foul",
  "event.out_of_bounds",
  "event.substitution",
  "event.period_start",
  "event.period_end",
  "event.match_end",
];

describe("event coverage", () => {
  it("default seed emits every standard event type", () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 5_400_000,
      teams: defaultTeams(),
    });
    const seen = new Set(r.messages.map((m) => m.type));
    for (const ev of REQUIRED) {
      expect(seen.has(ev), `expected to see ${ev} at least once`).toBe(true);
    }
  });

  it("default match ends 1-4 goals total", () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 5_400_000,
      teams: defaultTeams(),
    });
    const goals = r.messages.filter((m) => m.type === "event.goal");
    expect(goals.length).toBeGreaterThanOrEqual(1);
    expect(goals.length).toBeLessThanOrEqual(4);
  });

  it("score_change is emitted after each goal", () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 5_400_000,
      teams: defaultTeams(),
    });
    const goals = r.messages.filter((m) => m.type === "event.goal").length;
    const scoreChanges = r.messages.filter((m) => m.type === "event.score_change").length;
    expect(scoreChanges).toBe(goals);
  });

  it("match_end is the last event", () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 5_400_000,
      teams: defaultTeams(),
    });
    const lastEvent = [...r.messages].reverse().find((m) => m.type.startsWith("event.")) as { type: string };
    // Allow `event.commentary` after match_end (we emit a closing line).
    expect(["event.match_end", "event.commentary"]).toContain(lastEvent.type);
    const matchEndIndex = r.messages.findIndex((m) => m.type === "event.match_end");
    expect(matchEndIndex).toBeGreaterThan(0);
  });
});
