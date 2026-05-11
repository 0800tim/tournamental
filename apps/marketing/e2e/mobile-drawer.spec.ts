/**
 * Mobile drawer e2e, verifies the slide-in nav drawer opens, dismisses
 * via every documented interaction, and that every link inside it is
 * reachable + visible at mobile-width.
 *
 * Gated on RUN_MARKETING_E2E=1, same as the existing readability spec,
 * so CI without browsers installed doesn't break.
 */
import { test, expect, type Page } from "@playwright/test";

const RUN = process.env.RUN_MARKETING_E2E === "1";

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

async function gotoMobile(page: Page, path = "/"): Promise<void> {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto(path);
}

test.describe("Mobile drawer", () => {
  test.skip(!RUN, "Set RUN_MARKETING_E2E=1 to run this spec");

  test("opens on hamburger tap", async ({ page }) => {
    await gotoMobile(page);
    const drawer = page.locator("#mobile-menu");
    await expect(drawer).toHaveAttribute("data-state", "closed");
    await page.locator("#mobile-menu-toggle").tap();
    await expect(drawer).toHaveAttribute("data-state", "open");
    // The close button receives focus.
    const closeBtn = page.locator("#mobile-menu-close");
    await expect(closeBtn).toBeFocused();
  });

  test("backdrop click closes the drawer", async ({ page }) => {
    await gotoMobile(page);
    await page.locator("#mobile-menu-toggle").tap();
    const drawer = page.locator("#mobile-menu");
    await expect(drawer).toHaveAttribute("data-state", "open");
    await page.locator("#mobile-menu-scrim").click({ position: { x: 10, y: 100 } });
    await expect(drawer).toHaveAttribute("data-state", "closed");
  });

  test("escape closes the drawer", async ({ page }) => {
    await gotoMobile(page);
    await page.locator("#mobile-menu-toggle").tap();
    await expect(page.locator("#mobile-menu")).toHaveAttribute("data-state", "open");
    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-menu")).toHaveAttribute("data-state", "closed");
  });

  test("close button dismisses the drawer", async ({ page }) => {
    await gotoMobile(page);
    await page.locator("#mobile-menu-toggle").tap();
    await expect(page.locator("#mobile-menu")).toHaveAttribute("data-state", "open");
    await page.locator("#mobile-menu-close").tap();
    await expect(page.locator("#mobile-menu")).toHaveAttribute("data-state", "closed");
  });

  test("swipe right closes the drawer", async ({ page }) => {
    await gotoMobile(page);
    await page.locator("#mobile-menu-toggle").tap();
    const drawer = page.locator("#mobile-menu");
    await expect(drawer).toHaveAttribute("data-state", "open");
    // Synthesise a touch swipe rightward across the drawer.
    const box = await drawer.boundingBox();
    if (!box) throw new Error("drawer has no bounding box");
    await page.touchscreen.tap(box.x + 40, box.y + 200);
    // Playwright's touchscreen API doesn't model multi-touch
    // pan-and-release; we approximate by dispatching the touch events
    // directly. The handler in Header.astro reads clientX from
    // touches[0] so this is sufficient.
    await page.evaluate(({ x, y }) => {
      const drawer = document.getElementById("mobile-menu");
      if (!drawer) return;
      const t = (clientX: number) => ({
        clientX,
        clientY: y,
        identifier: 1,
        target: drawer,
        pageX: clientX,
        pageY: y,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: 1,
        screenX: clientX,
        screenY: y,
      });
      const dispatch = (type: string, clientX: number) => {
        const ev = new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === "touchend" ? [] : [t(clientX) as unknown as Touch],
          targetTouches: type === "touchend" ? [] : [t(clientX) as unknown as Touch],
          changedTouches: [t(clientX) as unknown as Touch],
        });
        drawer.dispatchEvent(ev);
      };
      dispatch("touchstart", x);
      dispatch("touchmove", x + 100);
      dispatch("touchend", x + 100);
    }, { x: box.x + 40, y: box.y + 200 });
    await expect(drawer).toHaveAttribute("data-state", "closed");
  });

  test("every nav link inside the drawer is reachable + visible", async ({ page }) => {
    await gotoMobile(page);
    await page.locator("#mobile-menu-toggle").tap();
    const links = page.locator("#mobile-menu .vt-mobile-link");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < count; i += 1) {
      const link = links.nth(i);
      await expect(link).toBeVisible();
      const href = await link.getAttribute("href");
      expect(href).toBeTruthy();
    }
    // CTA is also present at the foot of the drawer.
    const cta = page.locator("#mobile-menu .vt-mobile-cta");
    await expect(cta).toBeVisible();
    expect(await cta.getAttribute("href")).toContain("play.tournamental.com");
  });
});
