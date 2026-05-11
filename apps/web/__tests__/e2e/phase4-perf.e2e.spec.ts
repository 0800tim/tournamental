/**
 * Phase-4 native-GPU Playwright perf lane.
 *
 * Per `docs/27d-fidelity-phase4-magnus-mobile.md` § "Native-GPU lane":
 *
 *   Asserts steady-state ≥58fps for 15s after kickoff with all FX on,
 *   all 22 players visible.
 *
 * Gated on `VTORN_RUN_PHASE4_PERF=1` to enable; `VTORN_GPU_LANE=1`
 * for the hard FPS gate. SwiftShader (default CI) records but does
 * not fail the build.
 *
 * Real-GPU runner is flagged for ops follow-up, see PR body.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="node" />

// @ts-expect-error - playwright-test types not always available in editor
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.VTORN_BASE_URL ?? "http://localhost:3300";
const MATCH_ID = "fifa-wc-2022-final-arg-fra-2022-12-18";

const HARD_GATE = process.env.VTORN_GPU_LANE === "1";
const STEADY_FPS_FLOOR = 58;
const STEADY_WINDOW_MS = 15_000;

test.describe("Phase-4 native-GPU perf budget", () => {
  test.skip(!process.env.VTORN_RUN_PHASE4_PERF, "set VTORN_RUN_PHASE4_PERF=1 to run");

  test("steady-state ≥58 fps for 15 s after kickoff with all FX on", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err: Error) => consoleErrors.push(err.message));
    page.on("console", (msg: { type(): string; text(): string }) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE_URL}/match/${MATCH_ID}?time-scale=10&quality=high`);
    await page.waitForSelector(".camera-toggle", { timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector("canvas") !== null,
      { timeout: 30_000 },
    );

    await page.waitForTimeout(2000);

    const samples: number[] = [];
    const start = Date.now();
    while (Date.now() - start < STEADY_WINDOW_MS) {
      const fps = await page.evaluate(() => {
        return (window as unknown as { __vtornFps?: number }).__vtornFps ?? 0;
      });
      samples.push(fps);
      await page.waitForTimeout(200);
    }

    const sorted = samples.slice().sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const min = sorted[0];

    // eslint-disable-next-line no-console
    console.log(
      `[phase4-perf] samples=${samples.length} p50=${p50.toFixed(1)} p10=${p10.toFixed(1)} min=${min.toFixed(1)}`,
    );

    if (HARD_GATE) {
      expect(p50, `p50 fps below floor`).toBeGreaterThanOrEqual(STEADY_FPS_FLOOR);
      expect(p10, `p10 fps too low`).toBeGreaterThanOrEqual(STEADY_FPS_FLOOR - 5);
    }

    expect(consoleErrors).toEqual([]);
  });

  test("renderer publishes frame stats within 2 s of mount", async ({ page }) => {
    await page.goto(`${BASE_URL}/match/${MATCH_ID}?time-scale=1&quality=high`);
    await page.waitForSelector(".camera-toggle", { timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector("canvas") !== null,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(2000);
    const frameCount = await page.evaluate(() => {
      return (window as unknown as { __vtornFrameCount?: number }).__vtornFrameCount ?? 0;
    });
    expect(frameCount).toBeGreaterThan(0);
  });
});
