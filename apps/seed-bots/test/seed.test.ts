/**
 * Determinism + validation-target regression test.
 *
 * 100 bots is small enough to run inside CI in <1s but large enough
 * that the favourite / draw / top-6 rates approach their target rates
 * within +-3pp. The CLI applies the stricter +-2pp threshold at write
 * time on the full 18k cohort; tests use +-3pp because n=100 sampling
 * noise is bigger than the 18k production cohort's.
 */

import { describe, expect, it } from "vitest";

import { generateBots, validateTargets } from "../src/seed.js";

const SEED = "tournamental-2026-seed-v1";

describe("seed pipeline", () => {
  it("generates 100 deterministic bots that pass validation targets", () => {
    const bots = generateBots({ seed: SEED, target: 100 });
    expect(bots).toHaveLength(100);

    // Bot ids look like `bot_<8-char-base32>`.
    for (const b of bots) {
      expect(b.bot_id).toMatch(/^bot_[a-z2-7]{8}$/);
    }

    const targets = validateTargets(bots);
    expect(targets.favourite_rate).toBeGreaterThanOrEqual(0.72);
    expect(targets.favourite_rate).toBeLessThanOrEqual(0.78);
    expect(targets.draw_rate).toBeGreaterThanOrEqual(0.12);
    expect(targets.draw_rate).toBeLessThanOrEqual(0.18);
    expect(targets.top6_cup_winner_rate).toBeGreaterThanOrEqual(0.82);
  });

  it("is byte-deterministic across runs with the same seed", () => {
    const a = generateBots({ seed: SEED, target: 10 });
    const b = generateBots({ seed: SEED, target: 10 });
    expect(a.map((x) => x.bot_id)).toEqual(b.map((x) => x.bot_id));
    expect(a.map((x) => x.identity.display_name)).toEqual(
      b.map((x) => x.identity.display_name),
    );
    expect(a[0]?.bracket.picks.map((p) => p.outcome)).toEqual(
      b[0]?.bracket.picks.map((p) => p.outcome),
    );
    expect(a.map((x) => x.bracket.cup_winner_team3)).toEqual(
      b.map((x) => x.bracket.cup_winner_team3),
    );
  });

  it("produces a different cohort with a different seed", () => {
    const a = generateBots({ seed: SEED, target: 10 });
    const b = generateBots({ seed: "different-seed-v1", target: 10 });
    expect(a.map((x) => x.bot_id)).not.toEqual(b.map((x) => x.bot_id));
  });

  it("respects the engagement-tier weights", () => {
    const bots = generateBots({ seed: SEED, target: 200 });
    let high = 0,
      med = 0,
      low = 0;
    for (const b of bots) {
      if (b.personality.engagement_tier === "high") high++;
      else if (b.personality.engagement_tier === "med") med++;
      else low++;
    }
    // Generous bands for n=200; spec target is 10/30/60 percent.
    expect(high / bots.length).toBeGreaterThanOrEqual(0.05);
    expect(high / bots.length).toBeLessThanOrEqual(0.18);
    expect(med / bots.length).toBeGreaterThanOrEqual(0.22);
    expect(med / bots.length).toBeLessThanOrEqual(0.4);
    expect(low / bots.length).toBeGreaterThanOrEqual(0.5);
  });

  it("composes handles as firstname_<team3>_<NN>", () => {
    const bots = generateBots({ seed: SEED, target: 25 });
    for (const b of bots) {
      expect(b.identity.handle).toMatch(/^[a-z0-9]+_[a-z]{3}_\d{2}$/);
      expect(b.identity.handle).toContain(
        `_${b.favourite_team3.toLowerCase()}_`,
      );
    }
  });

  it("rolls 104 picks per bot covering every fixture", () => {
    const [bot] = generateBots({ seed: SEED, target: 1 });
    expect(bot).toBeDefined();
    if (!bot) return;
    expect(bot.bracket.picks).toHaveLength(104);
    // Group picks numbered 1..72; knockout 73..104 per the canonical
    // fixtures.json.
    const groupMatchNos = bot.bracket.picks
      .filter((p) => p.stage === "group")
      .map((p) => p.match_number);
    expect(groupMatchNos.sort((a, b) => a - b)[0]).toBe(1);
    expect(groupMatchNos.length).toBe(72);
    const koMatchNos = bot.bracket.picks
      .filter((p) => p.stage !== "group")
      .map((p) => p.match_number);
    expect(koMatchNos.length).toBe(32);
  });
});
