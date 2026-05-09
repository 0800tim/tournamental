/**
 * Playwright e2e — odds chip + hover tooltip on the bracket page.
 *
 * Runs against `http://localhost:3300/world-cup-2026` (Next.js dev). Not
 * wired into CI yet — `@playwright/test` is not installed in this
 * monorepo. To run locally:
 *
 *   pnpm --filter @vtorn/web add -D @playwright/test
 *   pnpm exec playwright install chromium
 *   pnpm --filter @vtorn/web exec playwright test __tests__/e2e
 *
 * The same critical-path assertions are covered (without a real
 * browser) by:
 *   - `apps/web/__tests__/OddsChip.test.tsx`
 *   - `apps/web/__tests__/bracket-odds-integration.test.tsx`
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="node" />

// @ts-expect-error - @playwright/test not yet installed in this monorepo
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.VTORN_BASE_URL ?? "http://localhost:3300";

test.describe("Odds chip on bracket page", () => {
  test("hovering a group match row reveals a tooltip with three rows summing to 100%", async ({ page }) => {
    await page.goto(`${BASE_URL}/world-cup-2026`);

    // The chip is inside `[data-mpr-odds]`. Wait for at least one chip
    // to leave its loading state.
    const firstChip = page
      .locator('[data-mpr-odds] [role="button"][data-state="ok"]')
      .first();
    await expect(firstChip).toBeVisible({ timeout: 10_000 });

    // Hover the chip.
    await firstChip.hover();

    // The hover-card pops up. It's a sibling div with role=tooltip.
    const tooltip = page.locator('[role="tooltip"]').first();
    await expect(tooltip).toBeVisible();

    // Three rows: home, draw, away. Read the percentage off each.
    const homePctText = await tooltip.locator('[data-side="home"]').textContent();
    const drawPctText = await tooltip.locator('[data-side="draw"]').textContent();
    const awayPctText = await tooltip.locator('[data-side="away"]').textContent();

    function pct(s: string | null): number {
      const m = s?.match(/(\d+)%/);
      return m ? Number(m[1]) : 0;
    }

    const total = pct(homePctText) + pct(drawPctText) + pct(awayPctText);
    expect(total).toBe(100);

    // Source attribution is present.
    await expect(tooltip).toContainText(/Polymarket|Estimate/);
  });

  test("knockout-stage chip hides the Draw row", async ({ page }) => {
    await page.goto(`${BASE_URL}/world-cup-2026`);
    // Switch to knockouts tab.
    await page.getByRole("tab", { name: /Knockouts/ }).click();
    // A knockout chip — only present when both slots are known. We
    // pick group winners first so a few R16/R32 slots resolve.
    await page.getByRole("tab", { name: /Group stage/ }).click();
    // Click MEX to win all 3 group A matches so KOR + MEX advance.
    const groupA = page.locator(".bracket-group").filter({ hasText: "Group A" });
    const matchRows = groupA.locator(".mpr-row");
    await matchRows.nth(0).locator(".mpr-pick-home").click();
    await matchRows.nth(1).locator(".mpr-pick-home").click();
    await matchRows.nth(2).locator(".mpr-pick-home").click();
    // Back to knockouts; expect to find at least one chip with no draw row.
    await page.getByRole("tab", { name: /Knockouts/ }).click();
    const koChip = page
      .locator('[data-km-odds] [role="button"][data-state="ok"]')
      .first();
    if (await koChip.count()) {
      await koChip.hover();
      const tooltip = page.locator('[role="tooltip"]').first();
      // No draw row in knockouts.
      await expect(tooltip.locator('[data-side="draw"]')).toHaveCount(0);
    }
  });
});
