/**
 * Full admin flow: log in via the dev `log` mailer (which writes the URL
 * to stderr; the test extracts it via the cookie callback), then ban a
 * user and verify the audit-log entry appears.
 *
 * This test is gated on `ADMIN_E2E=1` so it doesn't run in CI without
 * a deliberate setup (it depends on a real Next.js dev server, which
 * playwright can boot via VTORN_AUTOSTART_DEV=1).
 */

import { test, expect, request as pwRequest } from "@playwright/test";

test.skip(!process.env.ADMIN_E2E, "Set ADMIN_E2E=1 to run admin flow E2E");

test("ban a user and see it in audit log", async ({ page, baseURL }) => {
  const ctx = await pwRequest.newContext({ baseURL });
  // Step 1: request a link.
  const reqR = await ctx.post("/api/auth/request", {
    data: { email: "tim@tournamental.com", next: "/" },
  });
  expect(reqR.ok()).toBeTruthy();

  // Step 2: in dev "log" mode the link is written to stderr; tests in
  // CI would mock this. For now, the test instructs the operator to
  // export ADMIN_E2E_TOKEN to a captured magic-link token.
  const token = process.env.ADMIN_E2E_TOKEN;
  test.skip(!token, "ADMIN_E2E_TOKEN required (capture from dev server log)");

  await page.goto(`/api/auth/callback?token=${encodeURIComponent(token!)}`);
  await expect(page).toHaveURL("/");

  // Step 3: navigate to users.
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

  // Step 4: ban the first user.
  await page.getByRole("button", { name: /^Ban$/ }).first().click();
  await page.getByRole("textbox").fill("E2E test ban");
  await page.getByRole("button", { name: /Ban user/i }).click();

  // Step 5: open audit log and look for entry.
  await page.goto("/audit-log");
  await expect(page.getByText("user.ban")).toBeVisible();
});
