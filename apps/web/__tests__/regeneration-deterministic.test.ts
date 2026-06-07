/**
 * Determinism proof for the regenerate-on-demand contract.
 *
 * The /bot-arena storage table claims 1,000,000 bots = ~32 MB on disk.
 * That number is only honest if we can recompute any bot's 104-match
 * bracket bit-for-bit from (master_seed, bot_index, fixtures) without
 * persisting picks. This test asserts exactly that for both the
 * chalk-blended and unique-by-construction regeneration paths.
 *
 * If this ever fails, fix the regression before publishing the table
 * to /bot-arena or the underlying premise stops being true.
 * Tim 2026-06-08.
 */

import { describe, it, expect } from "vitest";

import {
  buildDemoMatches,
  regenerateBotBracket,
  regenerateBotBracketUnique,
  MASTER_SEED,
} from "@/components/browser-swarm/regenerate";

describe("browser-swarm regenerate-on-demand", () => {
  const matches = buildDemoMatches();

  it.each([0, 42, 523_891, 999_999, 1_000_000_000 - 1])(
    "chalk-blended bot #%i is bit-identical across 3 runs",
    (idx) => {
      const r1 = regenerateBotBracket(MASTER_SEED, idx, matches);
      const r2 = regenerateBotBracket(MASTER_SEED, idx, matches);
      const r3 = regenerateBotBracket(MASTER_SEED, idx, matches);
      const a = r1.map((p) => p.pick.outcome).join(",");
      const b = r2.map((p) => p.pick.outcome).join(",");
      const c = r3.map((p) => p.pick.outcome).join(",");
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(r1.length).toBe(matches.length);
    },
  );

  it.each([0, 42, 523_891, 999_999, 1_000_000_000 - 1])(
    "unique-variant bot #%i is bit-identical across 3 runs (this is what the worker actually federates)",
    (idx) => {
      const r1 = regenerateBotBracketUnique(MASTER_SEED, idx, matches);
      const r2 = regenerateBotBracketUnique(MASTER_SEED, idx, matches);
      const r3 = regenerateBotBracketUnique(MASTER_SEED, idx, matches);
      const a = r1.map((p) => p.pick.outcome).join(",");
      const b = r2.map((p) => p.pick.outcome).join(",");
      const c = r3.map((p) => p.pick.outcome).join(",");
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(r1.length).toBe(matches.length);
    },
  );

  it("unique variant produces structurally distinct brackets (>90% unique in 1000-bot sample)", () => {
    const fingerprints = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const r = regenerateBotBracketUnique(MASTER_SEED, i, matches);
      fingerprints.add(r.map((p) => p.pick.outcome).join(""));
    }
    expect(fingerprints.size).toBeGreaterThan(900);
  });
});
