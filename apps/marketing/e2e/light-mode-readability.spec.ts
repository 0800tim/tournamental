/**
 * Light-mode readability spec.
 *
 * Walks every public marketing route in both `data-theme="dark"` and
 * `data-theme="light"`, screenshots each, and asserts the first heading
 * has a non-trivial WCAG contrast ratio against the body background.
 *
 * The spec is gated on RUN_MARKETING_E2E=1 so CI without Playwright
 * browsers installed doesn't break. See playwright.config.ts header for
 * run instructions.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const RUN = process.env.RUN_MARKETING_E2E === "1";

// All Astro pages under src/pages/. Keep in sync if pages are added.
const ROUTES = [
  { path: "/", name: "index" },
  { path: "/why", name: "why" },
  { path: "/how-it-works", name: "how-it-works" },
  { path: "/syndicates", name: "syndicates" },
  { path: "/leaderboards", name: "leaderboards" },
  { path: "/world-cup-2026", name: "world-cup-2026" },
  { path: "/open-source", name: "open-source" },
  { path: "/contribute", name: "contribute" },
  { path: "/influencers", name: "influencers" },
  { path: "/start", name: "start" },
  { path: "/legal", name: "legal" },
] as const;

const THEMES = ["dark", "light"] as const;

const SCREENSHOT_DIR = join(process.cwd(), "e2e-screenshots");

/** Parse a CSS rgb()/rgba() colour into [r, g, b]. */
function parseRgb(input: string): [number, number, number] {
  const match = input.match(/rgba?\(([^)]+)\)/);
  if (!match) return [0, 0, 0];
  const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Linearise an sRGB component per WCAG 2.1. */
function linearise(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** Relative luminance per WCAG 2.1. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(linearise);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two CSS colour strings. */
function contrastRatio(a: string, b: string): number {
  const la = luminance(parseRgb(a));
  const lb = luminance(parseRgb(b));
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Resolve the effective background colour by walking up from the
 * heading until we find a non-transparent ancestor; the body has only
 * a radial-gradient image (no solid colour), so we fall back to the
 * html element's background-color.
 */
async function resolveEffectiveBg(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const transparent = (c: string) =>
      c === "transparent" || c === "rgba(0, 0, 0, 0)" || c === "";
    let el: Element | null = document.querySelector(sel);
    while (el && el !== document.documentElement) {
      const c = getComputedStyle(el).backgroundColor;
      if (!transparent(c)) return c;
      el = el.parentElement;
    }
    return getComputedStyle(document.documentElement).backgroundColor;
  }, selector);
}

test.describe("marketing light-mode readability", () => {
  test.skip(!RUN, "Set RUN_MARKETING_E2E=1 to run the marketing readability suite.");

  test.beforeAll(() => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  for (const route of ROUTES) {
    for (const theme of THEMES) {
      test(`${route.name} renders cleanly in ${theme}`, async ({ page, context }) => {
        // The header toggle script in Header.astro reads localStorage
        // ("vtourn:theme") on load and re-applies whatever it finds -
        // which would clobber the ?theme= override set by the pre-paint
        // script in Layout.astro. Pin storage to the theme under test
        // before navigation so both scripts agree on the resolved value.
        await context.addInitScript((t) => {
          try {
            window.localStorage.setItem("vtourn:theme", t);
          } catch (_) {
            /* private mode etc, fall through */
          }
        }, theme);

        // ?theme= is honoured by the pre-paint script in Layout.astro;
        // the same value is in localStorage so the header script agrees.
        await page.goto(`${route.path}?theme=${theme}`);
        await page.waitForLoadState("networkidle");

        // Sanity: the html element ended up with the expected theme.
        const resolved = await page.evaluate(() =>
          document.documentElement.getAttribute("data-theme"),
        );
        expect(resolved).toBe(theme);

        // Every layout marks the html with data-themed for testability.
        const themed = await page.evaluate(() =>
          document.documentElement.hasAttribute("data-themed"),
        );
        expect(themed).toBe(true);

        // Screenshot for manual review. Full page so we catch the footer.
        await page.screenshot({
          path: join(SCREENSHOT_DIR, `${route.name}-${theme}.png`),
          fullPage: true,
        });

        // Pages render the headline as either an H1 (legal, hero) or an
        // H2 via SectionHeading (everything else). Target the first
        // visible heading we find.
        const headingSelector = "h1, h2";
        const heading = page.locator(headingSelector).first();
        await expect(heading).toBeVisible();
        const headingColor = await heading.evaluate(
          (el) => getComputedStyle(el).color,
        );
        const bgColor = await resolveEffectiveBg(page, headingSelector);
        const ratio = contrastRatio(headingColor, bgColor);

        // WCAG AA for body text is 4.5:1, AA-large is 3:1. Headlines on
        // a marketing page should comfortably clear the stricter bar;
        // anything below means the page has washing-out text and needs
        // attention before merging.
        expect(
          ratio,
          `Contrast for ${route.name} in ${theme}: heading ${headingColor} on bg ${bgColor} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
