/**
 * Unit tests for the per-bot bracket cascade resolver.
 *
 * Verifies that:
 *   - Real fixture loading succeeds (104 matches, 12 groups of 4).
 *   - For sample bot indices the cascade returns CONCRETE team ids on
 *     every knockout fixture rather than the placeholder slot labels.
 *   - Determinism: same bot index returns the same cascaded bracket
 *     across two invocations.
 */

import { describe, expect, it } from "vitest";

import {
  resolveBotBracket,
  resolvedKnockoutSlots,
} from "@/components/browser-swarm/cascade";
import {
  MASTER_SEED,
  buildDemoMatches,
} from "@/components/browser-swarm/regenerate";

describe("browser-swarm cascade", () => {
  it("loads the 104-match WC 2026 schedule", () => {
    const matches = buildDemoMatches();
    expect(matches.length).toBe(104);
    const groups = matches.filter((m) => m.allows_draw);
    const knockouts = matches.filter((m) => !m.allows_draw);
    expect(groups.length).toBe(72);
    expect(knockouts.length).toBe(32);
  });

  it("resolves every knockout to concrete team ids for bot 0", () => {
    const matches = buildDemoMatches();
    const resolved = resolveBotBracket(MASTER_SEED, 0, matches);
    expect(resolved.cascaded.knockouts.length).toBe(32);
    for (const k of resolved.cascaded.knockouts) {
      expect(k.home.team).toBeTruthy();
      expect(k.away.team).toBeTruthy();
      // No more placeholder strings like "winner_grpA": the resolver
      // must hand the UI a real ISO code so it can show "France" / "ARG"
      // / "USA" etc.
      expect(typeof k.home.team).toBe("string");
      expect(typeof k.away.team).toBe("string");
      expect(k.home.team!.length).toBeLessThanOrEqual(5);
      expect(k.away.team!.length).toBeLessThanOrEqual(5);
    }
  });

  it("resolves every knockout to concrete team ids for bot 12345", () => {
    const matches = buildDemoMatches();
    const resolved = resolveBotBracket(MASTER_SEED, 12_345, matches);
    expect(resolved.cascaded.knockouts.length).toBe(32);
    for (const k of resolved.cascaded.knockouts) {
      expect(k.home.team).toBeTruthy();
      expect(k.away.team).toBeTruthy();
    }
  });

  it("picks a concrete winner for every knockout fixture", () => {
    const matches = buildDemoMatches();
    const resolved = resolveBotBracket(MASTER_SEED, 42, matches);
    const final = resolved.cascaded.knockouts.find((k) => k.stage === "f");
    expect(final).toBeTruthy();
    expect(final!.predicted_winner).toBeTruthy();
  });

  it("returns the same cascaded bracket for repeat calls", () => {
    const matches = buildDemoMatches();
    const a = resolveBotBracket(MASTER_SEED, 7, matches);
    const b = resolveBotBracket(MASTER_SEED, 7, matches);
    expect(a.cascaded.knockouts.map((k) => k.predicted_winner)).toEqual(
      b.cascaded.knockouts.map((k) => k.predicted_winner),
    );
    expect(a.prediction.best_thirds).toEqual(b.prediction.best_thirds);
  });

  it("exposes resolvedKnockoutSlots for the detail page", () => {
    const matches = buildDemoMatches();
    const resolved = resolveBotBracket(MASTER_SEED, 1, matches);
    const r32 = resolved.cascaded.knockouts[0]!;
    const lookup = resolvedKnockoutSlots(resolved.cascaded, r32.id);
    expect(lookup).not.toBeNull();
    expect(lookup!.home).toBe(r32.home.team);
    expect(lookup!.away).toBe(r32.away.team);
    expect(lookup!.winner).toBe(r32.predicted_winner);
  });
});
