/**
 * Playwright e2e, WC2026 hype landing page.
 *
 * Covers:
 *   1. /world-cup-2026/landing renders, all 48 team flags appear, the
 *      countdown is positive, the syndicate form posts to
 *      /api/syndicate/intent and gets a 200.
 *   2. The middleware rewrite: GET / with `Host: 2026wc.tournamental.com`
 *      serves the landing payload, GET / with the renderer host serves
 *      the original landing.
 */

import { test, expect } from "@playwright/test";

test.describe("WC2026 hype landing, content", () => {
  test("renders 48 teams, countdown ticks, hero CTA points at the bracket", async ({
    page,
  }) => {
    await page.goto("/world-cup-2026/landing");

    // Hero
    await expect(page.locator("h1")).toContainText("predicts the World Cup");

    // Countdown, at least one cell, days >= 0
    const countdown = page.getByTestId("wc-countdown");
    await expect(countdown).toBeVisible();
    const days = await page.getByTestId("wc-countdown-days").textContent();
    expect(Number(days)).toBeGreaterThanOrEqual(0);

    // Hero primary CTA -> /world-cup-2026
    const cta = page.getByRole("link", { name: /Play the bracket game/i });
    await expect(cta).toHaveAttribute("href", "/world-cup-2026");

    // 48 unique team rows in the groups grid
    const teamRows = page.locator(".wc-groups-grid .wc-team-row");
    await expect(teamRows).toHaveCount(48);

    // 12 groups labelled A-L
    const groupHeads = page.locator(".wc-groups-grid .wc-group-card h4");
    await expect(groupHeads).toHaveCount(12);

    // 12 upcoming matches
    const matches = page.locator("[data-testid=wc-upcoming-matches] .wc-match");
    await expect(matches).toHaveCount(12);
  });

  test("syndicate form posts to /api/syndicate/intent and shows success", async ({
    page,
  }) => {
    await page.goto("/world-cup-2026/landing");

    // Fill in the form
    const form = page.getByTestId("wc-syndicate-form");
    await form.locator("input[name=syndicate_name]").fill("E2E Test Crew");
    await form.locator("input[name=your_name]").fill("E2E");
    await form.locator("input[name=email]").fill("e2e@test.example");
    await form.locator("select[name=country]").selectOption("NZL");

    // Attach the response listener BEFORE the click, so we don't race the
    // submit. `waitForResponse` returns a Promise that resolves once a
    // matching response is received.
    const postPromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/syndicate/intent") &&
        r.request().method() === "POST",
      { timeout: 15_000 },
    );

    await page.getByTestId("wc-syndicate-submit").click();

    const response = await postPromise;
    expect(response.status()).toBe(200);

    // Status banner appears (the most reliable assertion that the round-trip
    // completed, the body parse occasionally races the page nav so we lean
    // on the visible UI confirmation).
    await expect(page.getByTestId("wc-syndicate-status")).toHaveAttribute(
      "data-status",
      "success",
    );
  });

  test("rejects an invalid email at the API layer", async ({ request }) => {
    const res = await request.post("/api/syndicate/intent", {
      data: {
        kind: "friends",
        syndicate_name: "Bad",
        your_name: "Bad",
        email: "not-an-email",
        country: "NZL",
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

test.describe("WC2026 hype landing, host-aware middleware", () => {
  test("Host: 2026wc.tournamental.com / rewrites to the landing", async ({
    request,
  }) => {
    const res = await request.get("/", {
      headers: { Host: "2026wc.tournamental.com" },
    });
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("predicts the World Cup");
    expect(html).toContain("wc-countdown");
  });

  test("Host: wc2026.tournamental.com / rewrites to the landing", async ({
    request,
  }) => {
    const res = await request.get("/", {
      headers: { Host: "wc2026.tournamental.com" },
    });
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("predicts the World Cup");
  });

  test("other hosts get the renderer landing, not the WC2026 page", async ({
    request,
  }) => {
    const res = await request.get("/", {
      headers: { Host: "tournamental.com" },
    });
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("predicts the World Cup");
    // The renderer apex landing, see app/page.tsx, copy is "Tournamental" since
    // PR #41. Just assert we're on the renderer's landing, not the WC page.
    expect(html).toContain("Watch the demo");
  });

  test("/world-cup-2026 (the bracket builder) is unaffected by middleware", async ({
    request,
  }) => {
    const res = await request.get("/world-cup-2026", {
      headers: { Host: "2026wc.tournamental.com" },
    });
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("Bracket Prophet");
  });
});
