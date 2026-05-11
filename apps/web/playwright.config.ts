import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Phase-1 fidelity acceptance suite.
 *
 * The dev server is *not* spawned by this config, Phase-1 assumes the
 * orchestrator already has `next dev -p 3300` running (per
 * `docs/22-deployment-and-tunnels.md`). If it isn't, set
 * `VTORN_AUTOSTART_DEV=1` and Playwright will boot it for you.
 */
const PORT = Number(process.env.VTORN_PORT ?? 3300);
const HOST = process.env.VTORN_HOST ?? `http://127.0.0.1:${PORT}`;
const AUTOSTART = process.env.VTORN_AUTOSTART_DEV === "1";

export default defineConfig({
  testDir: "./__tests__",
  testMatch: ["**/*.e2e.spec.ts"],
  testIgnore: ["**/*.test.ts", "**/*.test.tsx"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: HOST,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        // Try to coax headless chromium into hardware-accelerated WebGL.
        // Falls back to SwiftShader if the host has no GPU.
        launchOptions: {
          args: [
            "--enable-webgl",
            "--use-gl=swiftshader",
            "--use-angle=swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
    {
      name: "pixel-7",
      // Mobile-perf gate per docs/27a § "Performance gates".
      use: {
        ...devices["Pixel 7"],
        launchOptions: {
          args: [
            "--enable-webgl",
            "--use-gl=swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
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
