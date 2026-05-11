/**
 * Phase-3 e2e: post-FX vignette + commentary ducking during goal-replay.
 *
 * Gated on `VTORN_RUN_PHASE3_E2E=1` per the agent prompt, this spec
 * needs a real dev server (`pnpm dev` on port 3300) and SwiftShader
 * WebGL is enough for it to mount.
 *
 * Asserts:
 *   1. Renderer mounts the post-FX composer when quality != off.
 *   2. The canvas reports its quality preset via `data-vtorn-fx`.
 *   3. `?fx=off` skips the composer (no `data-vtorn-fx` change beyond
 *      "off").
 *   4. During a goal-replay cut, the perf monitor reports the mixer
 *      ducking commentary (`data-mixer-state="ducked-goal"`).
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="node" />

// @ts-expect-error - playwright-test types not always available in editor
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.VTORN_BASE_URL ?? "http://localhost:3300";
const MATCH_ID = "fifa-wc-2022-final-arg-fra-2022-12-18";

test.describe("Phase-3 post-FX + commentary ducking", () => {
  test.skip(
    !process.env.VTORN_RUN_PHASE3_E2E,
    "set VTORN_RUN_PHASE3_E2E=1 to run",
  );

  test("mounts the post-FX composer at the requested quality", async ({ page }) => {
    await page.goto(`${BASE_URL}/match/${MATCH_ID}?quality=high`);
    await page.waitForSelector(".camera-toggle", { timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector("canvas") !== null,
      { timeout: 30_000 },
    );

    // The PostFX component sets data-vtorn-fx on the first canvas.
    const fx = await page.evaluate(() => {
      const c = document.querySelector("canvas") as HTMLCanvasElement | null;
      return c?.dataset.vtornFx ?? null;
    });
    expect(fx).toBe("high");

    await page.screenshot({
      path: "test-fixtures/visual/phase3-postfx-high.png",
      fullPage: false,
    });
  });

  test("?fx=off bypasses the composer entirely", async ({ page }) => {
    await page.goto(`${BASE_URL}/match/${MATCH_ID}?fx=off`);
    await page.waitForSelector(".camera-toggle", { timeout: 30_000 });

    const fx = await page.evaluate(() => {
      const c = document.querySelector("canvas") as HTMLCanvasElement | null;
      return c?.dataset.vtornFx ?? null;
    });
    // Either undefined (composer never mounted) or explicit "off".
    expect([null, undefined, "off"]).toContain(fx);
  });

  test("commentary mixer ducks during goal-replay cut", async ({ page }) => {
    await page.goto(
      `${BASE_URL}/match/${MATCH_ID}?time-scale=10&seed-state=t-22m45s&quality=medium`,
    );
    await page.waitForSelector(".camera-toggle", { timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector("canvas") !== null,
      { timeout: 30_000 },
    );

    // Wait for the director to cut to goal-replay.
    await page.waitForFunction(
      () => {
        const hud = document.querySelector(".perf-monitor");
        return hud?.getAttribute("data-cam") === "goal-replay";
      },
      { timeout: 60_000 },
    );

    // Within ~ 1s the mixer should report ducked-goal state. Allow up
    // to 3s slack for the audio init.
    await page.waitForFunction(
      () => {
        const hud = document.querySelector(".perf-monitor");
        return hud?.getAttribute("data-mixer-state") === "ducked-goal";
      },
      { timeout: 5000 },
    );

    // Sample the commentary gain, should be < 1 (ducked).
    const gain = await page.evaluate(() => {
      const hud = document.querySelector(".perf-monitor");
      return Number(hud?.getAttribute("data-commentary-gain") ?? "1");
    });
    expect(gain).toBeLessThan(1);

    await page.screenshot({
      path: "test-fixtures/visual/phase3-goal-replay-fx.png",
      fullPage: false,
    });
  });
});
