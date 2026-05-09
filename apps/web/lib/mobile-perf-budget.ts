/**
 * Phase-4 mobile performance budget — single source of truth.
 *
 * Per `docs/27d-fidelity-phase4-magnus-mobile.md`:
 *
 *   We target steady-state 60 fps on a 2022 mid-range Android (Pixel 6a
 *   class). The renderer auto-downgrades quality when fps < 55 sustained
 *   for ~ 1.5 s. `?perf=mobile` URL flag forces the mobile profile for
 *   QA on desktop.
 *
 * No three.js dependency — pure logic. Tests in
 * `__tests__/mobile-perf-budget.test.ts`.
 */
import type { QualityPreset } from "./quality";

export type PerfTier = "mobile-low" | "mobile-mid" | "desktop" | "desktop-hi";

export interface PerfBudget {
  tier: PerfTier;
  targetFps: number;
  minFps: number;
  maxDrawCalls: number;
  maxTriangles: number;
  maxMemoryMb: number;
  defaultPreset: QualityPreset;
}

export const PERF_BUDGETS: Record<PerfTier, PerfBudget> = {
  "mobile-low": {
    tier: "mobile-low",
    targetFps: 60,
    minFps: 50,
    maxDrawCalls: 250,
    maxTriangles: 1_200_000,
    maxMemoryMb: 350,
    defaultPreset: "low",
  },
  "mobile-mid": {
    tier: "mobile-mid",
    targetFps: 60,
    minFps: 55,
    maxDrawCalls: 400,
    maxTriangles: 2_000_000,
    maxMemoryMb: 400,
    defaultPreset: "medium",
  },
  desktop: {
    tier: "desktop",
    targetFps: 60,
    minFps: 58,
    maxDrawCalls: 800,
    maxTriangles: 5_000_000,
    maxMemoryMb: 700,
    defaultPreset: "medium",
  },
  "desktop-hi": {
    tier: "desktop-hi",
    targetFps: 60,
    minFps: 58,
    maxDrawCalls: 1500,
    maxTriangles: 8_000_000,
    maxMemoryMb: 1100,
    defaultPreset: "high",
  },
};

export function classifyPerfTier(hint: {
  isMobile?: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}): PerfTier {
  if (hint.isMobile) {
    if ((hint.deviceMemory ?? 4) < 4) return "mobile-low";
    return "mobile-mid";
  }
  const mem = hint.deviceMemory ?? 8;
  if (mem >= 16) return "desktop-hi";
  if (mem >= 8) return "desktop";
  return "desktop";
}

export const PRESET_RANK: Record<QualityPreset, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const RANK_TO_PRESET: QualityPreset[] = ["low", "medium", "high"];

/**
 * Decide whether to step the quality preset down based on the recent
 * fps trend. Pure logic — caller manages the sustained-low timer.
 */
export function decideLODDowngrade(
  current: QualityPreset,
  fpsHistory: number[],
  budget: PerfBudget,
  options: { windowSec?: number; minSustainedSec?: number } = {},
): { nextPreset: QualityPreset; downgrade: boolean } {
  const minSustained = options.minSustainedSec ?? 1.5;
  if (fpsHistory.length === 0) return { nextPreset: current, downgrade: false };

  const samplesPerSec = options.windowSec ? fpsHistory.length / options.windowSec : 10;
  const required = Math.ceil(minSustained * samplesPerSec);
  if (fpsHistory.length < required) {
    return { nextPreset: current, downgrade: false };
  }
  const tail = fpsHistory.slice(-required);
  const allLow = tail.every((fps) => fps < budget.minFps);
  if (!allLow) return { nextPreset: current, downgrade: false };

  const rank = PRESET_RANK[current];
  if (rank === 0) return { nextPreset: current, downgrade: false };
  return { nextPreset: RANK_TO_PRESET[rank - 1], downgrade: true };
}

/** Parse `?perf=` query-string flag. */
export function parsePerfFlag(search: string): PerfTier | undefined {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const v = params.get("perf");
  if (v === "mobile") return "mobile-mid";
  if (v === "mobile-low" || v === "mobile-mid" || v === "desktop" || v === "desktop-hi") {
    return v;
  }
  return undefined;
}

/** Resolve budget for the current page (URL flag → auto-classify). */
export function resolvePerfBudget(win: {
  location?: { search?: string };
  navigator?: {
    deviceMemory?: number;
    hardwareConcurrency?: number;
    userAgent?: string;
  };
}): PerfBudget {
  if (!win.location || !win.navigator) return PERF_BUDGETS.desktop;
  const flag = parsePerfFlag(win.location.search ?? "");
  if (flag) return PERF_BUDGETS[flag];
  const ua = win.navigator.userAgent ?? "";
  const isMobile = /Mobi|Android/i.test(ua);
  return PERF_BUDGETS[
    classifyPerfTier({
      isMobile,
      deviceMemory: win.navigator.deviceMemory,
      hardwareConcurrency: win.navigator.hardwareConcurrency,
    })
  ];
}

export function isPerfMobileFlag(search: string): boolean {
  return parsePerfFlag(search) !== undefined;
}

export interface LodDowngradeOptions {
  budget: PerfBudget;
  initial: QualityPreset;
  sampleHz?: number;
  historySec?: number;
  sustainedSec?: number;
  cooldownSec?: number;
  now?: () => number;
}

/**
 * Runtime LOD-downgrade controller. Tracks fps samples, downgrades the
 * quality preset when fps stays below `budget.minFps` for the
 * sustained-low window. 5-s cooldown between downgrades.
 */
export class LodDowngradeController {
  private budget: PerfBudget;
  private current: QualityPreset;
  private history: number[] = [];
  private sampleHz: number;
  private historySec: number;
  private sustainedSec: number;
  private cooldownSec: number;
  private lastDowngradeAt = -Infinity;
  private lastSampleAt: number | null = null;
  private now: () => number;

  constructor(opts: LodDowngradeOptions) {
    this.budget = opts.budget;
    this.current = opts.initial;
    this.sampleHz = opts.sampleHz ?? 10;
    this.historySec = opts.historySec ?? 3;
    this.sustainedSec = opts.sustainedSec ?? 1.5;
    this.cooldownSec = opts.cooldownSec ?? 5;
    this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  }

  recordFps(fps: number): void {
    const t = this.now();
    if (this.lastSampleAt !== null) {
      const dt = t - this.lastSampleAt;
      if (dt < 1000 / this.sampleHz) return;
    }
    this.lastSampleAt = t;
    this.history.push(fps);
    const max = Math.ceil(this.historySec * this.sampleHz);
    if (this.history.length > max) {
      this.history.splice(0, this.history.length - max);
    }
    this.maybeDowngrade(t);
  }

  private maybeDowngrade(now: number): void {
    if (now - this.lastDowngradeAt < this.cooldownSec * 1000) return;
    const decision = decideLODDowngrade(this.current, this.history, this.budget, {
      windowSec: this.historySec,
      minSustainedSec: this.sustainedSec,
    });
    if (decision.downgrade) {
      this.current = decision.nextPreset;
      this.lastDowngradeAt = now;
      this.history = [];
    }
  }

  preset(): QualityPreset {
    return this.current;
  }

  getHistory(): readonly number[] {
    return this.history;
  }

  setPreset(p: QualityPreset): void {
    this.current = p;
  }
}

/** Markdown table summarising the budget. */
export function budgetTableMarkdown(): string {
  const rows: string[] = [
    "| Tier | Target FPS | Min FPS | Max Draw Calls | Max Triangles | Max Memory (MB) | Default Preset |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const order: PerfTier[] = ["mobile-low", "mobile-mid", "desktop", "desktop-hi"];
  for (const tier of order) {
    const b = PERF_BUDGETS[tier];
    rows.push(
      `| ${b.tier} | ${b.targetFps} | ${b.minFps} | ${b.maxDrawCalls} | ${b.maxTriangles.toLocaleString()} | ${b.maxMemoryMb} | ${b.defaultPreset} |`,
    );
  }
  return rows.join("\n");
}
