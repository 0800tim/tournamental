/**
 * Vitest, /leaderboard audience tab triplet.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §5
 * Three tabs (Humans / Bots / My Pools); Humans is the default landing;
 * clicking a tab switches `aria-selected`. Roving-tabindex pattern means
 * only the active tab has tabIndex=0.
 */

import { describe, it, expect } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { LeaderboardTabs } from "@/app/leaderboard/LeaderboardTabs";

function tabByName(container: HTMLElement, label: RegExp): HTMLButtonElement {
  const tabs = container.querySelectorAll<HTMLButtonElement>("[role='tab']");
  for (const t of Array.from(tabs)) {
    if (label.test(t.textContent ?? "")) return t;
  }
  throw new Error(`tab not found: ${label}`);
}

describe("<LeaderboardTabs>", () => {
  it("renders three tabs with Humans active by default", () => {
    const { container } = render(<LeaderboardTabs />);
    const humans = tabByName(container, /humans/i);
    const bots = tabByName(container, /bots/i);
    const pools = tabByName(container, /my pools/i);
    expect(humans.getAttribute("aria-selected")).toBe("true");
    expect(bots.getAttribute("aria-selected")).toBe("false");
    expect(pools.getAttribute("aria-selected")).toBe("false");
  });

  it("honours initialScope", () => {
    const { container } = render(<LeaderboardTabs initialScope="bots" />);
    expect(tabByName(container, /humans/i).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(tabByName(container, /bots/i).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("switches active tab on click", () => {
    const { container } = render(<LeaderboardTabs />);
    fireEvent.click(tabByName(container, /bots/i));
    expect(tabByName(container, /bots/i).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(tabByName(container, /humans/i).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("renders My Pools empty-state with deep link to /pools", () => {
    const { container } = render(<LeaderboardTabs />);
    fireEvent.click(tabByName(container, /my pools/i));
    expect(container.textContent).toMatch(/aren't in any Pools yet/i);
    const link = container.querySelector("a[href='/pools']");
    expect(link).toBeTruthy();
  });

  it("ArrowRight moves selection to the next tab (keyboard nav)", () => {
    const { container } = render(<LeaderboardTabs />);
    const humans = tabByName(container, /humans/i);
    fireEvent.keyDown(humans, { key: "ArrowRight" });
    expect(tabByName(container, /bots/i).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("End jumps to the last tab", () => {
    const { container } = render(<LeaderboardTabs />);
    const humans = tabByName(container, /humans/i);
    fireEvent.keyDown(humans, { key: "End" });
    expect(tabByName(container, /my pools/i).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("applies a roving-tabindex (only active tab has tabIndex=0)", () => {
    const { container } = render(<LeaderboardTabs />);
    expect(tabByName(container, /humans/i).tabIndex).toBe(0);
    expect(tabByName(container, /bots/i).tabIndex).toBe(-1);
    expect(tabByName(container, /my pools/i).tabIndex).toBe(-1);
  });
});
