/**
 * Vitest — the hamburger burger must render on every viewport size:
 * jsdom default, mobile (375x812), and desktop (1440x900). Removing the
 * left side-rail means the burger is the only entry to the menu drawer
 * on desktop (in addition to the new always-visible desktop nav row),
 * so it has to be unconditional.
 *
 * NOTE: the BottomNav also surfaces a "Menu" tab with aria-label="Open
 * menu" on mobile, so we assert by the AppBar-specific class instead of
 * by label to disambiguate.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));
vi.mock("@/lib/auth/supabase", () => ({
  browserClient: () => null,
}));
vi.mock("@/lib/auth/config", () => ({
  readPublicConfig: () => null,
}));

import { AppShell } from "@/components/shell/AppShell";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    writable: true,
    configurable: true,
  });
  window.dispatchEvent(new Event("resize"));
}

const ORIG_W = window.innerWidth;
const ORIG_H = window.innerHeight;

afterEach(() => {
  setViewport(ORIG_W, ORIG_H);
});

function findBurger(container: HTMLElement) {
  // The hamburger is the action button with class vt-appbar-menu.
  return container.querySelector(
    ".vt-appbar-row-main .vt-appbar-menu",
  ) as HTMLButtonElement | null;
}

describe("AppBar burger across viewports", () => {
  it("renders the burger at jsdom default size", () => {
    const { container } = render(
      <AppShell title="Home">
        <p>x</p>
      </AppShell>,
    );
    const burger = findBurger(container);
    expect(burger).toBeTruthy();
    expect(burger?.getAttribute("aria-label")).toBe("Open menu");
  });

  it("renders the burger at mobile size 375x812", () => {
    setViewport(375, 812);
    const { container } = render(
      <AppShell title="Home">
        <p>x</p>
      </AppShell>,
    );
    expect(findBurger(container)).toBeTruthy();
  });

  it("renders the burger at desktop size 1440x900", () => {
    setViewport(1440, 900);
    const { container } = render(
      <AppShell title="Home">
        <p>x</p>
      </AppShell>,
    );
    expect(findBurger(container)).toBeTruthy();
  });
});
