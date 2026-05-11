/**
 * bracket-driver — small Playwright helper toolbox for the bracket-cascade
 * e2e suite.
 *
 * Pure thin wrappers around `page.locator()` / `page.evaluate()`; no test
 * assertions live here, so the spec stays the single source of truth for
 * what the test actually proves.
 *
 * The helpers know the DOM contracts written down in the bracket
 * components:
 *
 *   - GroupCard          → `.bracket-group` cards with `.mpr-row` matches
 *   - MatchPredictionRow → `.mpr-pick-home` / `.mpr-pick-draw` / `.mpr-pick-away`
 *   - KnockoutMatch      → `[data-match-id]` cards with `.km-home` / `.km-away`
 *                          buttons; winning side gets `.is-winner`
 *   - BracketBuilder     → tab buttons `Groups X/72`, `R32 X/16`, `R16 X/8`,
 *                          `QF X/4`, `SF + 3rd X/3`, `Final X/1`
 *
 * Cascade timing: every knockout pick triggers a multi-pass cascade
 * recompute in BracketBuilder. We add a tiny settle delay (~200ms) between
 * picks to let React commit + DOM repaint before the next click reads slot
 * state. That's the same window a human user sees.
 */

import type { Locator, Page } from "@playwright/test";

export type GroupSide = "home_win" | "draw" | "away_win";
export type KnockoutSide = "home" | "away";
export type KnockoutStage =
  | "r32"
  | "r16"
  | "qf"
  | "sf"
  | "third_place"
  | "final";

const SETTLE_MS = 200;

/** Delete the v2 draft + local-user-id keys so the test starts from zero. */
export async function clearBracketLocalStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      const remove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        if (k && (k.startsWith("vtorn:bracket:") || k === "vtorn:local_user_id")) {
          remove.push(k);
        }
      }
      for (const k of remove) window.localStorage.removeItem(k);
    } catch {
      /* localStorage might be access-denied (rare); test will fail loudly later */
    }
  });
}

/** Click the chosen outcome on every visible group-stage match (72 total). */
export async function pickAllGroupMatches(page: Page, side: GroupSide): Promise<number> {
  // Make sure we're on the groups tab.
  const groupsTab = page.getByRole("tab", { name: /^Groups/ });
  await groupsTab.click();

  const btnClass =
    side === "home_win"
      ? ".mpr-pick-home"
      : side === "away_win"
        ? ".mpr-pick-away"
        : ".mpr-pick-draw";

  const buttons = page.locator(`.bracket-group .mpr-row ${btnClass}`);
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    await buttons.nth(i).click();
  }
  return count;
}

/**
 * Click home/away on every knockout card matching the given stage.
 *
 * Stages map to the engine ids as follows:
 *   r32         → match-id prefix `r32_`
 *   r16         → `r16_`
 *   qf          → `qf_`
 *   sf          → `sf_` (excludes the third-place playoff)
 *   third_place → `tp_`
 *   final       → exactly `final`
 */
export async function pickAllKnockoutsForRound(
  page: Page,
  stage: KnockoutStage,
  side: KnockoutSide,
): Promise<number> {
  // Each round is its own tab now; navigate to the matching one. The
  // 3rd-place playoff lives on the same tab as the semi-finals.
  const tabPatternByStage: Record<KnockoutStage, RegExp> = {
    r32: /^R32/,
    r16: /^R16/,
    qf: /^QF/,
    sf: /^SF/,
    third_place: /^SF/,
    final: /^Final/,
  };
  await page.getByRole("tab", { name: tabPatternByStage[stage] }).click();

  const cards = await listKnockoutCardsForStage(page, stage);
  for (const id of cards) {
    const card = page.locator(`.km-card[data-match-id="${id}"]`);
    const button = card.locator(side === "home" ? ".km-home" : ".km-away");
    // Wait for the button to be enabled (slots resolved by upstream cascade).
    await button.waitFor({ state: "visible" });
    await button.click({ trial: false });
    await page.waitForTimeout(SETTLE_MS);
  }
  return cards.length;
}

/**
 * List every knockout card id present in the DOM that belongs to the given
 * stage. We read straight from the data-match-id attribute so the helper
 * is robust to render order.
 */
export async function listKnockoutCardsForStage(
  page: Page,
  stage: KnockoutStage,
): Promise<string[]> {
  const ids = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".km-card[data-match-id]"),
    ).map((el) => el.dataset.matchId ?? "");
  });

  const filter = (id: string): boolean => {
    if (stage === "third_place") return id.startsWith("tp_");
    if (stage === "final") return id === "final";
    return id.startsWith(`${stage}_`);
  };

  return ids.filter(filter).sort();
}

/**
 * After picking all matches in the upstream stage, every card in the next
 * round should have BOTH home and away populated with a real team-name
 * span (`.km-team-name`) — i.e. no `.km-tbd` placeholders like
 * "Winner r32_05".
 *
 * Throws an Error listing the offending match-ids when placeholders remain.
 * The caller turns that into an `expect.fail()` or `expect()` assertion;
 * the helper itself is assertion-free so the report is structured.
 */
export async function assertNoPlaceholders(
  page: Page,
  stage: "r16" | "qf" | "sf" | "third_place" | "final",
): Promise<void> {
  const ids = await listKnockoutCardsForStage(page, stage);
  const offenders: Array<{ id: string; home: string; away: string }> = [];
  for (const id of ids) {
    const card = page.locator(`.km-card[data-match-id="${id}"]`);
    const homeTbd = await card.locator(".km-home .km-tbd").count();
    const awayTbd = await card.locator(".km-away .km-tbd").count();
    if (homeTbd > 0 || awayTbd > 0) {
      const homeText = (await card.locator(".km-home").innerText()).trim();
      const awayText = (await card.locator(".km-away").innerText()).trim();
      offenders.push({ id, home: homeText, away: awayText });
    }
  }
  if (offenders.length > 0) {
    const detail = offenders
      .map((o) => `${o.id}: home="${o.home}", away="${o.away}"`)
      .join("\n  ");
    throw new Error(
      `[${stage}] ${offenders.length} cell(s) still contain TBD placeholders after upstream picks:\n  ${detail}`,
    );
  }
}

/** Read the small "X/Y" badges from the per-round tabs.
 *
 * "knockouts" returns the sum of R32+R16+QF+SF+Final pick counts so
 * existing callers continue to work without breakdown changes. */
export async function getPickCounts(
  page: Page,
): Promise<{ groups: string; knockouts: string }> {
  const groupsBadge = page
    .getByRole("tab", { name: /^Groups/ })
    .locator(".bracket-tab-count");
  const groups = (await groupsBadge.innerText()).trim();
  const sumOver = async (regex: RegExp): Promise<{ picked: number; total: number }> => {
    const badge = page.getByRole("tab", { name: regex }).locator(".bracket-tab-count");
    const txt = (await badge.innerText()).trim();
    const m = txt.match(/^(\d+)\/(\d+)$/);
    if (!m) return { picked: 0, total: 0 };
    return { picked: Number(m[1]), total: Number(m[2]) };
  };
  const parts = await Promise.all([
    sumOver(/^R32/),
    sumOver(/^R16/),
    sumOver(/^QF/),
    sumOver(/^SF/),
    sumOver(/^Final/),
  ]);
  const picked = parts.reduce((a, p) => a + p.picked, 0);
  const total = parts.reduce((a, p) => a + p.total, 0);
  const knockouts = `${picked}/${total}`;
  return { groups, knockouts };
}

/**
 * Convenience: locate a single knockout card by id.
 * Useful for one-shot picks (the third-place playoff or the final).
 */
export function knockoutCardById(page: Page, id: string): Locator {
  return page.locator(`.km-card[data-match-id="${id}"]`);
}
