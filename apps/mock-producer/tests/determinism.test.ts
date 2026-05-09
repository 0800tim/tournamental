/**
 * Determinism: same `--seed` produces byte-identical output.
 *
 * We run the simulation twice with the same config, serialise the message
 * arrays as NDJSON, and assert byte equality. This catches any
 * accidentally-introduced wall-clock or process-state non-determinism.
 */
import { describe, it, expect } from "vitest";
import { runSimulation, defaultTeams } from "../src/index.js";

function ndjson(messages: ReadonlyArray<unknown>): string {
  return messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
}

describe("determinism", () => {
  it("same seed produces byte-identical NDJSON over a 5-min match", () => {
    const cfg = {
      seed: 42,
      matchDurationMs: 5 * 60 * 1000,
      teams: defaultTeams(),
    };
    const a = runSimulation(cfg);
    const b = runSimulation(cfg);
    const aBytes = ndjson(a.messages);
    const bBytes = ndjson(b.messages);
    expect(aBytes.length).toBe(bBytes.length);
    expect(aBytes).toBe(bBytes);
  });

  it("same seed produces byte-identical NDJSON over a full 90-min match", () => {
    const cfg = {
      seed: 42,
      matchDurationMs: 5_400_000,
      teams: defaultTeams(),
    };
    const a = runSimulation(cfg);
    const b = runSimulation(cfg);
    expect(ndjson(a.messages)).toBe(ndjson(b.messages));
  });

  it("different seeds produce different output", () => {
    const cfg1 = { seed: 42, matchDurationMs: 5 * 60 * 1000, teams: defaultTeams() };
    const cfg2 = { seed: 7,  matchDurationMs: 5 * 60 * 1000, teams: defaultTeams() };
    const a = runSimulation(cfg1);
    const b = runSimulation(cfg2);
    expect(ndjson(a.messages)).not.toBe(ndjson(b.messages));
  });
});
