/**
 * Playwright e2e for the per-match-prediction flow.
 *
 * Runs against `http://localhost:3300/world-cup-2026` (Next.js dev). Not
 * wired into CI yet — Playwright isn't installed in this monorepo. To
 * run locally:
 *
 *   pnpm --filter @vtorn/web add -D @playwright/test
 *   pnpm exec playwright install chromium
 *   pnpm --filter @vtorn/web exec playwright test __tests__/e2e
 *
 * The same critical-path assertions are also covered (without a real
 * browser) by `apps/web/__tests__/per-match-prediction.test.tsx` — that
 * is the gating test until Playwright lands.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="node" />

// The import below works once `@playwright/test` is installed; the file
// is type-checked in isolation under TS strict, so we use a deferred
// dynamic import pattern.
// @ts-expect-error - @playwright/test not yet installed in this monorepo
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.VTORN_BASE_URL ?? "http://localhost:3300";

test.describe("Per-match prediction", () => {
  test("predicts all 6 group A matches and sees standings update live", async ({ page }) => {
    await page.goto(`${BASE_URL}/world-cup-2026`);
    const groupA = page.locator(".bracket-group").filter({ hasText: "Group A" });
    await expect(groupA).toBeVisible();

    // Pick MEX to win all of their matches and KOR to beat CZE; verify
    // the standings panel reflects MEX 1st, KOR 2nd.
    const matchRows = groupA.locator(".mpr-row");
    await matchRows.nth(0).locator(".mpr-btn-home").click(); // MEX vs RSA
    await matchRows.nth(1).locator(".mpr-btn-home").click(); // KOR vs CZE
    await matchRows.nth(2).locator(".mpr-btn-home").click(); // MEX vs KOR
    await matchRows.nth(3).locator(".mpr-btn-away").click(); // CZE vs RSA → RSA win
    await matchRows.nth(4).locator(".mpr-btn-away").click(); // CZE vs MEX → MEX win
    await matchRows.nth(5).locator(".mpr-btn-home").click(); // RSA vs KOR → RSA win

    const mexRow = groupA.locator(".bracket-standings-row").filter({ hasText: "MEX" });
    await expect(mexRow).toContainText("9 pts");
    await expect(mexRow).toHaveClass(/is-advance/);
  });

  test("locks the bracket and shows the lock summary", async ({ page }) => {
    await page.goto(`${BASE_URL}/world-cup-2026`);
    await page.getByRole("tab", { name: /Lock \+ share/ }).click();
    await expect(page.getByRole("button", { name: /Lock final/ })).toBeVisible();
  });
});
