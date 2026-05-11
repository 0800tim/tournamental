/**
 * End-to-end Playwright suite for the full WC2026 bracket cascade.
 *
 * Goal: prove that a user can pick **every** match — 72 group matches plus
 * 32 knockouts — and that every cascade step (R32 → R16 → QF → SF →
 * third-place + Final) resolves real team names into the next round's
 * slots, the lock-summary tab shows the full submission, and the picks
 * survive a hard reload.
 *
 * Runs against a live deployed environment. Default base URL is
 * https://play.tournamental.com; override with `PLAYWRIGHT_BASE_URL`.
 *
 * Bug-tolerance:
 *   - The test never *fixes* application code. If the cascade leaves
 *     placeholders or localStorage doesn't persist, the test fails with a
 *     diagnostic message that the orchestrator can hand to a follow-up
 *     fix PR.
 *   - Steps that probe nice-to-have surfaces (the multiplier table, the
 *     "Back your boldest pick" CTA, the "Predicted tournament winner"
 *     panel) use `expect.soft()` so the rest of the test still runs and
 *     reports them as failures rather than hard-aborting.
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  assertNoPlaceholders,
  clearBracketLocalStorage,
  getPickCounts,
  knockoutCardById,
  listKnockoutCardsForStage,
  pickAllGroupMatches,
  pickAllKnockoutsForRound,
} from "./_helpers/bracket-driver";

// ---------- config ----------

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.VTORN_BASE_URL ??
  "https://play.tournamental.com";

const BRACKET_PATH = "/world-cup-2026";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOT_DIR = resolve(__dirname, "../../test-fixtures/visual/cascade");

const SCREENSHOTS = {
  emptyGroups: "01-empty-groups.png",
  groupsFilled: "02-groups-72-72.png",
  knockoutsTabEmpty: "03-knockouts-tab-empty.png",
  r32Picked: "04-r32-picked.png",
  r16Picked: "05-r16-picked.png",
  qfPicked: "06-qf-picked.png",
  sfPicked: "07-sf-picked.png",
  finalPicked: "08-final-picked.png",
  lockSummary: "09-lock-summary.png",
  afterReload: "10-after-reload-persisted.png",
} as const;

// Expected counts derived from the engine's vendored fixtures
// (packages/bracket-engine/data/fifa-wc-2026-fixtures.json).
const EXPECTED_GROUP_MATCHES = 72;
const EXPECTED_KNOCKOUT_MATCHES = 32; // 16 r32 + 8 r16 + 4 qf + 2 sf + 1 third-place + 1 final
const EXPECTED_R32 = 16;
const EXPECTED_R16 = 8;
const EXPECTED_QF = 4;
const EXPECTED_SF = 2;

// ---------- fixtures + utilities ----------

async function ensureScreenshotDir(): Promise<void> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function snap(page: Page, name: string): Promise<void> {
  const path = resolve(SCREENSHOT_DIR, name);
  await page.screenshot({ path, fullPage: true });
}

async function gotoBracket(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}${BRACKET_PATH}`, { waitUntil: "networkidle" });
  // Heading proves the bracket builder mounted.
  await expect(page.locator(".bracket-builder")).toBeVisible();
}

// Tabs need a click to render — reading their badge counts only reflects
// the current state if the page has hydrated.
async function waitForHydration(page: Page): Promise<void> {
  await expect(page.getByRole("tab", { name: /^Groups/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^R32/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Final/ })).toBeVisible();
}

// ---------- the test ----------

test.describe.configure({ mode: "serial" });

test.describe("Full WC2026 bracket cascade", () => {
  test.setTimeout(300_000); // 5 min — 104 clicks + cascade settles

  test.beforeAll(ensureScreenshotDir);

  // The cascade-prediction flow is identical across viewports; running it
  // on the mobile project doubles runtime for no extra signal. Skip the
  // pixel-7 project — desktop-chromium gives full coverage.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "cascade flow only needs the desktop project",
    );
  });

  test("picks every match group → final and verifies cascade + persistence", async ({
    page,
  }) => {
    // ------------------------------------------------------------------
    // 1. Navigate + reset local state so the run is reproducible.
    // ------------------------------------------------------------------
    await gotoBracket(page);
    await waitForHydration(page);
    await clearBracketLocalStorage(page);

    // After clearing, reload so the BracketBuilder mounts with an empty
    // draft (loadDraft() returns null on first read).
    await page.reload({ waitUntil: "networkidle" });
    await waitForHydration(page);

    // 1a. Empty group state — counter should read "0/72".
    const initialCounts = await getPickCounts(page);
    expect(initialCounts.groups).toBe(`0/${EXPECTED_GROUP_MATCHES}`);
    expect(initialCounts.knockouts).toBe(`0/${EXPECTED_KNOCKOUT_MATCHES}`);
    await snap(page, SCREENSHOTS.emptyGroups);

    // ------------------------------------------------------------------
    // 2. Group stage — pick "Home Win" on every match.
    // ------------------------------------------------------------------
    const groupClicks = await pickAllGroupMatches(page, "home_win");
    expect(groupClicks).toBe(EXPECTED_GROUP_MATCHES);

    const afterGroups = await getPickCounts(page);
    expect(afterGroups.groups).toBe(
      `${EXPECTED_GROUP_MATCHES}/${EXPECTED_GROUP_MATCHES}`,
    );
    await snap(page, SCREENSHOTS.groupsFilled);

    // ------------------------------------------------------------------
    // 3. Switch to the R32 tab — R32 slots should already be populated
    //    by the cascade because every group's standings are now defined.
    // ------------------------------------------------------------------
    await page.getByRole("tab", { name: /^R32/ }).click();
    await expect(page.locator(".km-grid")).toBeVisible();
    await snap(page, SCREENSHOTS.knockoutsTabEmpty);

    // Sanity: 32 knockout cards should be in the DOM.
    const allCards = await page.locator(".km-card[data-match-id]").count();
    expect(allCards).toBe(EXPECTED_KNOCKOUT_MATCHES);

    // R32 home slot should be a real team name (not a TBD placeholder).
    const firstR32 = page.locator(".km-card[data-match-id^='r32_']").first();
    await expect(firstR32.locator(".km-home .km-team-name")).toBeVisible();

    // ------------------------------------------------------------------
    // 4. R32 — click home on each of the 16 R32 cards.
    // ------------------------------------------------------------------
    const r32Picked = await pickAllKnockoutsForRound(page, "r32", "home");
    expect(r32Picked).toBe(EXPECTED_R32);
    await snap(page, SCREENSHOTS.r32Picked);

    // 4a. After R32 picks, every R16 card must have real team names.
    await assertNoPlaceholders(page, "r16");

    // ------------------------------------------------------------------
    // 5. R16.
    // ------------------------------------------------------------------
    const r16Picked = await pickAllKnockoutsForRound(page, "r16", "home");
    expect(r16Picked).toBe(EXPECTED_R16);
    await snap(page, SCREENSHOTS.r16Picked);
    await assertNoPlaceholders(page, "qf");

    // ------------------------------------------------------------------
    // 6. QF.
    // ------------------------------------------------------------------
    const qfPicked = await pickAllKnockoutsForRound(page, "qf", "home");
    expect(qfPicked).toBe(EXPECTED_QF);
    await snap(page, SCREENSHOTS.qfPicked);
    await assertNoPlaceholders(page, "sf");

    // ------------------------------------------------------------------
    // 7. SF (the two real semi-finals — id `sf_01`, `sf_02`).
    //    The third-place playoff (id `tp_01`) shares the SF stage in the
    //    engine but its slots only resolve after the SF picks land
    //    (knockout_loser sources). We pick it separately below.
    // ------------------------------------------------------------------
    const sfPicked = await pickAllKnockoutsForRound(page, "sf", "home");
    expect(sfPicked).toBe(EXPECTED_SF);
    await snap(page, SCREENSHOTS.sfPicked);

    // After SF picks, the Final card AND the third-place playoff should
    // both have real teams populated.
    await assertNoPlaceholders(page, "final");
    await assertNoPlaceholders(page, "third_place");

    // ------------------------------------------------------------------
    // 8. Third-place playoff (one match, id `tp_01`).
    // ------------------------------------------------------------------
    const tpIds = await listKnockoutCardsForStage(page, "third_place");
    expect(tpIds.length).toBe(1);
    const tpCard = knockoutCardById(page, tpIds[0]!);
    await tpCard.locator(".km-home").click();
    await page.waitForTimeout(200);

    // ------------------------------------------------------------------
    // 9. The Final.
    // ------------------------------------------------------------------
    const finalCard = knockoutCardById(page, "final");
    await expect(finalCard.locator(".km-home .km-team-name")).toBeVisible();
    await expect(finalCard.locator(".km-away .km-team-name")).toBeVisible();
    await finalCard.locator(".km-home").click();
    await page.waitForTimeout(200);

    // The picked side gets an `.is-winner` modifier — sanity check.
    await expect(finalCard.locator(".km-home")).toHaveClass(/is-winner/);
    await snap(page, SCREENSHOTS.finalPicked);

    // ------------------------------------------------------------------
    // 10. Counters: knockouts tab should now read 32/32.
    // ------------------------------------------------------------------
    const afterAll = await getPickCounts(page);
    expect(afterAll.groups).toBe(
      `${EXPECTED_GROUP_MATCHES}/${EXPECTED_GROUP_MATCHES}`,
    );
    expect(afterAll.knockouts).toBe(
      `${EXPECTED_KNOCKOUT_MATCHES}/${EXPECTED_KNOCKOUT_MATCHES}`,
    );

    // ------------------------------------------------------------------
    // 11. Final tab — hosts the save-and-share summary for the full bracket.
    // ------------------------------------------------------------------
    await page.getByRole("tab", { name: /^Final/ }).click();
    await expect(page.locator(".bracket-lock-summary")).toBeVisible();

    // 11a. Counts inside the save panel.
    const groupsCount = page.locator(".bracket-lock-counts strong").nth(0);
    const knockoutsCount = page.locator(".bracket-lock-counts strong").nth(1);
    await expect(groupsCount).toHaveText(String(EXPECTED_GROUP_MATCHES));
    await expect(knockoutsCount).toHaveText(String(EXPECTED_KNOCKOUT_MATCHES));

    // 11b. Total picks = 72 + 32 = 104. We probe localStorage as the
    // canonical source of truth — that's what the API will eventually
    // submit.
    const draft = await page.evaluate(() => {
      const keys = Object.keys(window.localStorage).filter((k) =>
        k.startsWith("vtorn:bracket:v2:fifa-wc-2026:"),
      );
      if (keys.length === 0) return null;
      try {
        return JSON.parse(window.localStorage.getItem(keys[0]!) ?? "null");
      } catch {
        return null;
      }
    });
    expect(draft).not.toBeNull();
    const matchPredictions = Object.keys(
      (draft as { matchPredictions?: Record<string, unknown> }).matchPredictions ?? {},
    );
    const knockoutPredictions = Object.keys(
      (draft as { knockoutPredictions?: Record<string, unknown> }).knockoutPredictions ?? {},
    );
    expect(matchPredictions.length).toBe(EXPECTED_GROUP_MATCHES);
    expect(knockoutPredictions.length).toBe(EXPECTED_KNOCKOUT_MATCHES);
    expect(matchPredictions.length + knockoutPredictions.length).toBe(104);

    // 11c. Soft expectations for surfaces the spec calls out but that may
    // not yet exist in the live UI. Reported as test failures so the
    // orchestrator gets a clear bug list, but they don't block the rest
    // of the run.
    const lockSection = page.locator(".bracket-final-section");
    await expect
      .soft(
        lockSection,
        "Final/save section should surface the predicted tournament winner",
      )
      .toContainText(/winner|champion|wins it|champions/i);

    const multiplierTable = lockSection.locator(
      "table, .bracket-multiplier-table, [data-testid='lock-multiplier-table']",
    );
    await expect
      .soft(
        multiplierTable.first(),
        "Final/save section should expose an early-save multiplier table",
      )
      .toBeVisible();

    const ctaBoldest = page.getByRole("link", { name: /back your boldest/i });
    const ctaMarket = page.getByRole("link", { name: /view market/i });
    const ctaCount =
      (await ctaBoldest.count()) + (await ctaMarket.count());
    expect
      .soft(
        ctaCount,
        "Final/save section should expose a 'Back your boldest pick' (or 'view market') CTA",
      )
      .toBeGreaterThan(0);

    await snap(page, SCREENSHOTS.lockSummary);

    // ------------------------------------------------------------------
    // 12. Hard reload — picks must survive via localStorage.
    // ------------------------------------------------------------------
    await page.reload({ waitUntil: "networkidle" });
    await waitForHydration(page);

    const afterReload = await getPickCounts(page);
    expect(afterReload.groups).toBe(
      `${EXPECTED_GROUP_MATCHES}/${EXPECTED_GROUP_MATCHES}`,
    );
    expect(afterReload.knockouts).toBe(
      `${EXPECTED_KNOCKOUT_MATCHES}/${EXPECTED_KNOCKOUT_MATCHES}`,
    );

    const draftAfter = await page.evaluate(() => {
      const keys = Object.keys(window.localStorage).filter((k) =>
        k.startsWith("vtorn:bracket:v2:fifa-wc-2026:"),
      );
      if (keys.length === 0) return null;
      try {
        return JSON.parse(window.localStorage.getItem(keys[0]!) ?? "null");
      } catch {
        return null;
      }
    });
    expect(draftAfter).not.toBeNull();
    const mp2 = Object.keys(
      (draftAfter as { matchPredictions?: Record<string, unknown> })
        .matchPredictions ?? {},
    );
    const kp2 = Object.keys(
      (draftAfter as { knockoutPredictions?: Record<string, unknown> })
        .knockoutPredictions ?? {},
    );
    expect(mp2.length + kp2.length).toBe(104);

    await snap(page, SCREENSHOTS.afterReload);
  });
});
