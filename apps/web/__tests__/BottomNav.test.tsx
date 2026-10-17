/**
 * Vitest, BottomNav active-tab logic + rendering.
 * - 4 tabs render by default with correct labels.
 * - The active tab matches `window.location.pathname` (prefix-aware).
 */

import { describe, it, expect, vi } from "vitest";
import { act, render, waitFor } from "./helpers/render";

import {
  BottomNav,
  DEFAULT_BOTTOM_NAV_TABS,
  isTabActive,
} from "@/components/shell/BottomNav";

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

function setLocation(pathname: string) {
  Object.defineProperty(window, "location", {
    value: new URL(`https://localhost${pathname}`),
    writable: true,
    configurable: true,
  });
}

describe("<BottomNav>", () => {
  it("renders 4 default tabs", () => {
    setLocation("/");
    const { getByText } = render(<BottomNav />);
    expect(getByText("Home")).toBeTruthy();
    // Dock label is the short "Play" (Tim 2026-06-03); the drawer keeps "Play (Predict)".
    expect(getByText("Play")).toBeTruthy();
    // Dock order since the calendar landed: Home, Play, Schedule, Leaderboard.
    expect(getByText("Schedule")).toBeTruthy();
    expect(getByText("Leaderboard")).toBeTruthy();
  });

  it("marks the home tab active on /", async () => {
    setLocation("/");
    const { container } = render(<BottomNav />);
    await waitFor(() => {
      const active = container.querySelector(
        '.vt-bottomnav-tab[aria-current="page"]',
      );
      expect(active?.textContent).toContain("Home");
    });
  });

  it("marks Predict active on /world-cup-2026 sub-routes", async () => {
    setLocation("/world-cup-2026/landing");
    const { container } = render(<BottomNav />);
    await waitFor(() => {
      const active = container.querySelector(
        '.vt-bottomnav-tab[aria-current="page"]',
      );
      expect(active?.textContent).toContain("Play");
    });
  });
});

describe("isTabActive", () => {
  it("matches root only on exact path", () => {
    expect(
      isTabActive(DEFAULT_BOTTOM_NAV_TABS[0], "/"),
    ).toBe(true);
    expect(
      isTabActive(DEFAULT_BOTTOM_NAV_TABS[0], "/anything"),
    ).toBe(false);
  });

  it("matches prefix-tabs on sub-routes", () => {
    const predict = DEFAULT_BOTTOM_NAV_TABS[1];
    expect(isTabActive(predict, "/world-cup-2026")).toBe(true);
    expect(isTabActive(predict, "/world-cup-2026/landing")).toBe(true);
    expect(isTabActive(predict, "/")).toBe(false);
  });
});
