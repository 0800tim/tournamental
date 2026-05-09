/**
 * Capture screenshots + LCP / bundle-size measurements for the launch
 * report. Runs on demand: `pnpm exec playwright test wc2026-screenshots`.
 *
 * Output goes to `apps/web/.playwright-screenshots/` (gitignored). Tim
 * picks the relevant ones for the PR description.
 */

import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "./.playwright-screenshots";
mkdirSync(OUT, { recursive: true });

test("desktop hero", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/world-cup-2026/landing");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/01-hero-desktop.png`, fullPage: false });
});

test("desktop full-page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/world-cup-2026/landing");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/02-full-desktop.png`, fullPage: true });
});

test("teams grid", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/world-cup-2026/landing");
  await page.locator(".wc-groups-grid").scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/03-teams-grid.png`, fullPage: false });
});

test("syndicate form", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/world-cup-2026/landing");
  await page.locator("[data-testid=wc-syndicate-form]").scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/04-syndicate-form.png`, fullPage: false });
});

test("leaderboard preview", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/world-cup-2026/landing");
  await page.locator(".wc-leaderboard").scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/05-leaderboard.png`, fullPage: false });
});

test("mobile (iPhone SE)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/world-cup-2026/landing");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/06-mobile.png`, fullPage: true });
});

test("performance: LCP + total transfer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const responses: { url: string; bytes: number; type: string }[] = [];
  page.on("response", async (r) => {
    try {
      const buf = await r.body();
      responses.push({
        url: r.url(),
        bytes: buf.byteLength,
        type: r.request().resourceType(),
      });
    } catch {
      // some streams have no body — ignore.
    }
  });

  const t0 = Date.now();
  await page.goto("/world-cup-2026/landing", { waitUntil: "networkidle" });
  const totalMs = Date.now() - t0;

  // largest-contentful-paint via PerformanceObserver
  const lcpMs = await page.evaluate<number>(
    () =>
      new Promise<number>((resolve) => {
        let last = 0;
        const obs = new PerformanceObserver((entries) => {
          for (const e of entries.getEntries()) {
            // @ts-expect-error renderTime / loadTime are not in the lib types
            last = e.renderTime || e.loadTime || last;
          }
        });
        obs.observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => {
          obs.disconnect();
          resolve(last);
        }, 1500);
      }),
  );

  const totalBytes = responses.reduce((acc, r) => acc + r.bytes, 0);
  const jsBytes = responses
    .filter((r) => r.type === "script")
    .reduce((acc, r) => acc + r.bytes, 0);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        navMs: totalMs,
        lcpMs: Math.round(lcpMs),
        totalBytes,
        jsBytes,
        responseCount: responses.length,
      },
      null,
      2,
    ),
  );

  expect(lcpMs).toBeLessThan(5000);
});
