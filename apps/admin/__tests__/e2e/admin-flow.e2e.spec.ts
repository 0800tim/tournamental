/**
 * Full admin flow: log in via WhatsApp OTP step-up, then ban a user and
 * verify the audit-log entry appears.
 *
 * This test is gated on `ADMIN_E2E=1` AND `ADMIN_E2E_COOKIE` (a valid
 * admin_session cookie value captured from a real OTP exchange) so it
 * doesn't run in CI without deliberate setup. The previous magic-link
 * + log-mailer test harness was removed when the admin gate moved to
 * WhatsApp OTP; rather than re-implement an OTP-capture shim here we
 * accept a pre-baked session cookie via env var.
 *
 * Tracked: SEC-ADMIN-11.
 */

import { test, expect } from "@playwright/test";

test.skip(!process.env.ADMIN_E2E, "Set ADMIN_E2E=1 to run admin flow E2E");

test("ban a user and see it in audit log", async ({ page, context }) => {
  const cookie = process.env.ADMIN_E2E_COOKIE;
  test.skip(
    !cookie,
    "ADMIN_E2E_COOKIE required (capture admin_session cookie value from a real OTP login)",
  );

  const cookieName =
    process.env.NODE_ENV === "production" ? "__Host-admin" : "admin-session";
  await context.addCookies([
    {
      name: cookieName,
      value: cookie!,
      url: page.url() || "http://localhost:3340",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
    },
  ]);

  // Step 1: navigate to users.
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

  // Step 2: ban the first user.
  await page.getByRole("button", { name: /^Ban$/ }).first().click();
  await page.getByRole("textbox").fill("E2E test ban");
  await page.getByRole("button", { name: /Ban user/i }).click();

  // Step 3: open audit log and look for entry.
  await page.goto("/audit-log");
  await expect(page.getByText("user.ban")).toBeVisible();
});
