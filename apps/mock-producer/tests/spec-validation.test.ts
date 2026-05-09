/**
 * Spec-validation: every emitted message validates against `@vtorn/spec`
 * v0.1.1 via the bundled structural validator.
 */
import { describe, it, expect } from "vitest";
import { runSimulation, defaultTeams, validateMessage } from "../src/index.js";

describe("spec validation", () => {
  it("every message in a default 90-min match validates", () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 5_400_000,
      teams: defaultTeams(),
    });
    expect(r.messages.length).toBeGreaterThan(0);
    for (let i = 0; i < r.messages.length; i++) {
      try {
        validateMessage(r.messages[i]);
      } catch (err) {
        throw new Error(`message[${i}] (${(r.messages[i] as { type: string }).type}) failed validation: ${(err as Error).message}\n${JSON.stringify(r.messages[i]).slice(0, 240)}`);
      }
    }
  });

  it("init has spec_version 0.1.1 and two teams", () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 60_000,
      teams: defaultTeams(),
    });
    const init = r.messages[0] as { type: string; spec_version: string; teams: unknown[] };
    expect(init.type).toBe("match.init");
    expect(init.spec_version).toBe("0.1.1");
    expect(init.teams).toHaveLength(2);
  });

  it("state frames are emitted at 10Hz (every 100ms)", () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 5_000,
      teams: defaultTeams(),
    });
    const stateFrames = r.messages.filter((m): m is { type: "state"; t: number } => m.type === "state");
    // 5_000ms / 100ms = 50 frames + 1 (t=0 .. t=5000 inclusive).
    expect(stateFrames.length).toBeGreaterThanOrEqual(50);
    expect(stateFrames.length).toBeLessThanOrEqual(52);
    // Successive frames are 100ms apart.
    for (let i = 1; i < stateFrames.length; i++) {
      const dt = (stateFrames[i] as { t: number }).t - (stateFrames[i - 1] as { t: number }).t;
      expect(dt).toBe(100);
    }
  });
});
