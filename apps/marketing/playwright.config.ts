import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the marketing site.
 *
 * The light-mode-readability spec is gated on RUN_MARKETING_E2E=1 so CI
 * (and contributors who don't have Playwright browsers installed) can
 * skip it. To run locally:
 *
 *   cd apps/marketing
 *   RUN_MARKETING_E2E=1 VTORN_AUTOSTART_DEV=1 pnpm exec playwright test
 *
 * or against an already-running dev server on :3320:
 *
 *   pnpm dev   # in another terminal
 *   RUN_MARKETING_E2E=1 pnpm exec playwright test
 */
const PORT = Number(process.env.VTORN_MARKETING_PORT ?? 3320);
const HOST = process.env.VTORN_MARKETING_HOST ?? `http://127.0.0.1:${PORT}`;
const AUTOSTART = process.env.VTORN_AUTOSTART_DEV === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: HOST,
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: AUTOSTART
    ? {
        command: "pnpm dev",
        url: HOST,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
