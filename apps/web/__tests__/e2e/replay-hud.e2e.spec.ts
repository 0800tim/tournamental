/**
 * Playwright e2e for the broadcast match-stats HUD.
 *
 * Validates the `fix/replay-clock-scoreboard-stats-hud` work:
 *
 *   1. The match clock advances monotonically (no oscillation between
 *      0 and the live clock).
 *   2. The scoreline updates as goals fire, `1-0` after Messi at 23',
 *      `2-0` after Di María at 36'.
 *   3. The scorers ticker is populated in chronological order.
 *
 * The test is gated on `VTORN_RUN_REPLAY_HUD_E2E=1` so it only runs on
 * lanes with a live dev server + the AR-FR manifest deployed under
 * `/data/arfr-stream/`. CI lanes that don't have the gzipped manifest
 * skip cleanly.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="node" />

// @ts-expect-error - playwright-test types not always available in editor
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.VTORN_BASE_URL ?? "http://localhost:3300";
const MATCH_ID = "fifa-wc-2022-final-arg-fra-2022-12-18";

test.describe("Broadcast match-stats HUD", () => {
  test.skip(!process.env.VTORN_RUN_REPLAY_HUD_E2E, "set VTORN_RUN_REPLAY_HUD_E2E=1 to run");

  test("clock ticks monotonically and scoreboard updates after Messi 23' + Di María 36'", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (err: Error) => consoleErrors.push(err.message));
    page.on("console", (msg: { type(): string; text(): string }) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // 60× time scale: we want to cross 36 minutes of match time in ~36s of
    // wall clock.
    await page.goto(
      `${BASE_URL}/match/${MATCH_ID}?time-scale=60`,
    );

    // Wait for the HUD to appear.
    await page.waitForSelector('[data-testid="match-stats-hud"]', { timeout: 15_000 });
    await page.waitForSelector('[data-testid="msh-clock"]');

    // Capture the clock readings over a 4-second window. The bug Tim
    // reported was the clock alternating between 0 and the live time;
    // a fix means consecutive samples should never go backwards by
    // more than a tiny lerp tolerance.
    const samples: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const t = await page
        .locator('[data-testid="msh-clock"]')
        .first()
        .textContent();
      if (t) samples.push(t.trim());
      await page.waitForTimeout(330);
    }
    // Convert "MM'" or "MM:SS" to seconds for monotonicity check.
    const secs = samples.map(parseClockToSec);
    for (let i = 1; i < secs.length; i += 1) {
      // Tolerate a tiny backward step (≤1s) for lerp rounding;
      // the bug was alternation back to 0 every other tick.
      expect(secs[i]).toBeGreaterThanOrEqual(secs[i - 1] - 1);
    }
    // And the clock should have advanced overall.
    expect(secs[secs.length - 1]).toBeGreaterThan(secs[0]);

    // Wait for the scoreboard to advance to 1-0 (Messi 23'). At
    // time-scale=60 we cross 23 minutes in ~23 seconds.
    await page.waitForFunction(
      () => {
        const home = document
          .querySelector('[data-testid="msh-home-score"]')
          ?.textContent?.trim();
        return home === "1";
      },
      undefined,
      { timeout: 60_000 },
    );

    // Then 2-0 after Di María 36'.
    await page.waitForFunction(
      () => {
        const home = document
          .querySelector('[data-testid="msh-home-score"]')
          ?.textContent?.trim();
        return home === "2";
      },
      undefined,
      { timeout: 60_000 },
    );

    // The scorers ticker should have at least Messi + Di María listed.
    const scorerNames = await page
      .locator('[data-testid="msh-scorer-name"]')
      .allTextContents();
    expect(scorerNames.length).toBeGreaterThanOrEqual(2);
    expect(scorerNames[0]).toMatch(/Messi/i);
    expect(scorerNames[1]).toMatch(/Di María|Di Mar/i);

    expect(consoleErrors).toEqual([]);
  });
});

function parseClockToSec(s: string): number {
  // "MM'" → minutes
  const minOnly = /^(\d+)'$/.exec(s);
  if (minOnly) return Number(minOnly[1]) * 60;
  // "MM:SS"
  const mmss = /^(\d+):(\d{2})$/.exec(s);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  // "H:MM:SS"
  const hmmss = /^(\d+):(\d{2}):(\d{2})$/.exec(s);
  if (hmmss) return Number(hmmss[1]) * 3600 + Number(hmmss[2]) * 60 + Number(hmmss[3]);
  return 0;
}
