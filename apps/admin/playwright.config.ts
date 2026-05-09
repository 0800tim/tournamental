import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.VTORN_ADMIN_PORT ?? 3340);
const HOST = process.env.VTORN_ADMIN_HOST ?? `http://127.0.0.1:${PORT}`;
const AUTOSTART = process.env.VTORN_AUTOSTART_DEV === "1";

export default defineConfig({
  testDir: "./__tests__/e2e",
  testMatch: ["**/*.e2e.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: HOST,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
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
