/**
 * Playwright e2e — phone-OTP auth.
 *
 * Stubs the auth API at /v1/auth/* via page.route(...) so we don't
 * need the auth-sms service running. The page reads
 * NEXT_PUBLIC_AUTH_API_URL at build time, so this test sets up the
 * route on whatever origin the front-end was compiled to call.
 */

import { test, expect } from "@playwright/test";

const AUTH_BASE =
  process.env.NEXT_PUBLIC_AUTH_API_URL ?? "http://localhost:3330";
const AUTH_PATH = AUTH_BASE.replace(/^https?:\/\/[^/]+/, "");

test.describe("auth page — phone → OTP → logged in", () => {
  test("happy path SMS", async ({ page }) => {
    let stubCode = "424242";

    await page.route(`${AUTH_BASE}/v1/auth/request`, async (route) => {
      const body = (await route.request().postDataJSON()) as {
        phone: string;
        channel: string;
      };
      expect(body.phone).toBe("+6421999000");
      expect(body.channel).toBe("sms");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          channel: "sms",
          phoneMasked: "+64*****000",
          expiresInSeconds: 600,
        }),
      });
    });

    await page.route(`${AUTH_BASE}/v1/auth/verify`, async (route) => {
      const body = (await route.request().postDataJSON()) as {
        phone: string;
        code: string;
      };
      if (body.code !== stubCode) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "invalid-or-expired" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          jwt: "header.payload.signature",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: "u_test",
            phone: body.phone,
            displayName: null,
            country: null,
          },
        }),
      });
    });

    await page.goto("/auth?next=/world-cup-2026");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Sign in to VTourn",
    );

    await page.getByLabel("Phone number").fill("+6421999000");
    await page.getByRole("button", { name: /Send code/i }).click();

    await expect(page.getByLabel(/6-digit code/i)).toBeVisible();
    await expect(page.getByText(/\+64\*+000/)).toBeVisible();

    await page.getByLabel(/6-digit code/i).fill(stubCode);
    await page.getByRole("button", { name: /Verify/i }).click();

    await page.waitForURL("**/world-cup-2026", { timeout: 10_000 });

    const stored = await page.evaluate(() =>
      localStorage.getItem("vtourn_jwt"),
    );
    expect(stored).toBe("header.payload.signature");
  });

  test("wrong code shows readable error and stays on code step", async ({
    page,
  }) => {
    await page.route(`${AUTH_BASE}/v1/auth/request`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          channel: "sms",
          phoneMasked: "+64*****000",
          expiresInSeconds: 600,
        }),
      });
    });
    await page.route(`${AUTH_BASE}/v1/auth/verify`, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid-or-expired" }),
      });
    });

    await page.goto("/auth");
    await page.getByLabel("Phone number").fill("+6421999000");
    await page.getByRole("button", { name: /Send code/i }).click();
    await page.getByLabel(/6-digit code/i).fill("000000");
    await page.getByRole("button", { name: /Verify/i }).click();

    await expect(page.getByRole("alert")).toContainText(/expired|new one/i);
    await expect(page.getByLabel(/6-digit code/i)).toBeVisible();
  });

  test("rate-limit response is surfaced to the user", async ({ page }) => {
    await page.route(`${AUTH_BASE}/v1/auth/request`, async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "rate-limited",
          reason: "phone-cooldown",
          retryAfterSeconds: 42,
        }),
      });
    });
    await page.goto("/auth");
    await page.getByLabel("Phone number").fill("+6421999000");
    await page.getByRole("button", { name: /Send code/i }).click();
    await expect(page.getByRole("alert")).toContainText(/Too many requests/i);
  });
});

// Marker so the test file imports cleanly even when AUTH_PATH is unused.
void AUTH_PATH;
