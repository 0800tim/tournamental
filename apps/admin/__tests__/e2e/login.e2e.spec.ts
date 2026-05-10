import { test, expect } from "@playwright/test";

test.describe("login flow", () => {
  test("redirects unauthenticated requests to /login", async ({ page }) => {
    const r = await page.goto("/users", { waitUntil: "domcontentloaded" });
    expect(r?.url()).toContain("/login");
  });

  test("renders the login form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /Tournamental Admin/i })).toBeVisible();
    await expect(page.getByLabel(/Admin email/i)).toBeVisible();
  });

  test("submitting an email shows the 'sent' confirmation", async ({ page }) => {
    test.skip(!process.env.ADMIN_EMAILS, "ADMIN_EMAILS not set in CI env");
    await page.goto("/login");
    await page.getByLabel(/Admin email/i).fill("tim@tournamental.com");
    await page.getByRole("button", { name: /Send sign-in link/i }).click();
    await expect(page).toHaveURL(/sent=1/);
  });
});
