/**
 * Phase-4 mobile perf budget tests — pure logic.
 */
import { describe, it, expect } from "vitest";
import {
  PERF_BUDGETS,
  PRESET_RANK,
  classifyPerfTier,
  decideLODDowngrade,
  parsePerfFlag,
  resolvePerfBudget,
  budgetTableMarkdown,
  LodDowngradeController,
} from "@/lib/mobile-perf-budget";

describe("PERF_BUDGETS", () => {
  it("has all four tiers with target 60 fps", () => {
    expect(Object.keys(PERF_BUDGETS).sort()).toEqual([
      "desktop",
      "desktop-hi",
      "mobile-low",
      "mobile-mid",
    ]);
    for (const b of Object.values(PERF_BUDGETS)) {
      expect(b.targetFps).toBe(60);
    }
  });

  it("min fps for mobile-mid is 55 per the docs/27d spec", () => {
    expect(PERF_BUDGETS["mobile-mid"].minFps).toBe(55);
  });

  it("memory budgets escalate from mobile-low to desktop-hi", () => {
    expect(PERF_BUDGETS["mobile-low"].maxMemoryMb).toBeLessThan(PERF_BUDGETS["mobile-mid"].maxMemoryMb);
    expect(PERF_BUDGETS["mobile-mid"].maxMemoryMb).toBeLessThan(PERF_BUDGETS.desktop.maxMemoryMb);
    expect(PERF_BUDGETS.desktop.maxMemoryMb).toBeLessThan(PERF_BUDGETS["desktop-hi"].maxMemoryMb);
  });
});

describe("classifyPerfTier", () => {
  it("mobile + low memory → mobile-low", () => {
    expect(classifyPerfTier({ isMobile: true, deviceMemory: 2 })).toBe("mobile-low");
  });

  it("mobile + 4 GB memory → mobile-mid", () => {
    expect(classifyPerfTier({ isMobile: true, deviceMemory: 4 })).toBe("mobile-mid");
  });

  it("mobile (default 4 GB when undefined) → mobile-mid", () => {
    expect(classifyPerfTier({ isMobile: true })).toBe("mobile-mid");
  });

  it("desktop + 8 GB → desktop", () => {
    expect(classifyPerfTier({ deviceMemory: 8 })).toBe("desktop");
  });

  it("desktop + 16 GB → desktop-hi", () => {
    expect(classifyPerfTier({ deviceMemory: 16 })).toBe("desktop-hi");
  });
});

describe("decideLODDowngrade", () => {
  const budget = PERF_BUDGETS["mobile-mid"];

  it("no downgrade when fps is healthy", () => {
    const fpsHistory = Array(20).fill(60);
    const r = decideLODDowngrade("high", fpsHistory, budget);
    expect(r.downgrade).toBe(false);
    expect(r.nextPreset).toBe("high");
  });

  it("downgrades from high → medium when sustained low", () => {
    const fpsHistory = Array(30).fill(40);
    const r = decideLODDowngrade("high", fpsHistory, budget);
    expect(r.downgrade).toBe(true);
    expect(r.nextPreset).toBe("medium");
  });

  it("downgrades medium → low when sustained low", () => {
    const fpsHistory = Array(30).fill(40);
    const r = decideLODDowngrade("medium", fpsHistory, budget);
    expect(r.downgrade).toBe(true);
    expect(r.nextPreset).toBe("low");
  });

  it("does not downgrade past low", () => {
    const fpsHistory = Array(30).fill(40);
    const r = decideLODDowngrade("low", fpsHistory, budget);
    expect(r.downgrade).toBe(false);
    expect(r.nextPreset).toBe("low");
  });

  it("requires sustained low (single frame doesn't trigger)", () => {
    const fpsHistory = [60, 60, 60, 30];
    const r = decideLODDowngrade("high", fpsHistory, budget);
    expect(r.downgrade).toBe(false);
  });

  it("treats samples as 10/sec by default for the threshold", () => {
    const fpsHistory = Array(15).fill(40);
    const r = decideLODDowngrade("high", fpsHistory, budget);
    expect(r.downgrade).toBe(true);
  });
});

describe("parsePerfFlag", () => {
  it("?perf=mobile maps to mobile-mid", () => {
    expect(parsePerfFlag("?perf=mobile")).toBe("mobile-mid");
  });

  it("?perf=mobile-low → mobile-low", () => {
    expect(parsePerfFlag("?perf=mobile-low")).toBe("mobile-low");
  });

  it("?perf=desktop-hi → desktop-hi", () => {
    expect(parsePerfFlag("?perf=desktop-hi")).toBe("desktop-hi");
  });

  it("missing or unknown perf flag returns undefined", () => {
    expect(parsePerfFlag("")).toBeUndefined();
    expect(parsePerfFlag("?perf=banana")).toBeUndefined();
    expect(parsePerfFlag("?other=x")).toBeUndefined();
  });

  it("accepts optional leading ?", () => {
    expect(parsePerfFlag("perf=mobile-mid")).toBe("mobile-mid");
    expect(parsePerfFlag("?perf=mobile-mid")).toBe("mobile-mid");
  });
});

describe("resolvePerfBudget", () => {
  it("respects the URL flag override", () => {
    const b = resolvePerfBudget({
      location: { search: "?perf=mobile-low" },
      navigator: { userAgent: "Mozilla/5.0 Desktop" },
    });
    expect(b.tier).toBe("mobile-low");
  });

  it("auto-classifies a mobile UA as mobile-mid", () => {
    const b = resolvePerfBudget({
      location: { search: "" },
      navigator: { userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile" },
    });
    expect(b.tier).toBe("mobile-mid");
  });

  it("falls back to desktop when navigator/location are missing", () => {
    const b = resolvePerfBudget({});
    expect(b.tier).toBe("desktop");
  });
});

describe("budgetTableMarkdown", () => {
  it("renders a table with all four tiers", () => {
    const md = budgetTableMarkdown();
    expect(md).toContain("mobile-low");
    expect(md).toContain("mobile-mid");
    expect(md).toContain("desktop");
    expect(md).toContain("desktop-hi");
    expect(md).toContain("Target FPS");
  });
});

describe("LodDowngradeController", () => {
  it("starts at the configured initial preset", () => {
    let now = 0;
    const ctrl = new LodDowngradeController({
      budget: PERF_BUDGETS["mobile-mid"],
      initial: "high",
      now: () => now,
    });
    expect(ctrl.preset()).toBe("high");
  });

  it("downgrades to medium after sustained low fps", () => {
    let now = 0;
    const ctrl = new LodDowngradeController({
      budget: PERF_BUDGETS["mobile-mid"],
      initial: "high",
      sampleHz: 10,
      historySec: 3,
      sustainedSec: 1.5,
      now: () => now,
    });
    for (let i = 0; i < 30; i++) {
      ctrl.recordFps(40);
      now += 100;
    }
    expect(ctrl.preset()).toBe("medium");
  });

  it("respects PRESET_RANK ordering", () => {
    expect(PRESET_RANK.low).toBeLessThan(PRESET_RANK.medium);
    expect(PRESET_RANK.medium).toBeLessThan(PRESET_RANK.high);
  });

  it("does not re-downgrade within the cooldown window", () => {
    let now = 0;
    const ctrl = new LodDowngradeController({
      budget: PERF_BUDGETS["mobile-mid"],
      initial: "high",
      cooldownSec: 5,
      now: () => now,
    });
    for (let i = 0; i < 30; i++) {
      ctrl.recordFps(40);
      now += 100;
    }
    expect(ctrl.preset()).toBe("medium");
    for (let i = 0; i < 20; i++) {
      ctrl.recordFps(40);
      now += 100;
    }
    expect(ctrl.preset()).toBe("medium");
  });
});
