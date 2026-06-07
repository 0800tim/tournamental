/**
 * Vitest, /leaderboard single-row tab strip.
 *
 * Spec: docs/superpowers/specs/2026-06-07-bot-arena-design.md §5
 * Five tabs in one row (Humans / Bots / Global / Country / My Pools);
 * Humans is the default landing; clicking a tab switches
 * `aria-selected`. Roving-tabindex pattern means only the active tab
 * has tabIndex=0. End jumps to the last tab. My Pools renders three
 * mock pools with View-pool links to /s/<slug>; falls back to the
 * empty state when no pools are present.
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
  it("renders five tabs with Humans active by default", () => {
    const { container } = render(<LeaderboardTabs />);
    const expected: ReadonlyArray<RegExp> = [
      /humans/i,
      /bots/i,
      /global/i,
      /country/i,
      /my pools/i,
    ];
    for (const re of expected) {
      // throws if missing
      tabByName(container, re);
    }
    expect(tabByName(container, /humans/i).getAttribute("aria-selected")).toBe("true");
    expect(tabByName(container, /bots/i).getAttribute("aria-selected")).toBe("false");
  });

  it("honours initialTab", () => {
    const { container } = render(<LeaderboardTabs initialTab="bots" />);
    expect(tabByName(container, /humans/i).getAttribute("aria-selected")).toBe(
      "false",
    );
    expect(tabByName(container, /bots/i).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("switches active tab on click", () => {
    const { container } = render(<LeaderboardTabs />);
    fireEvent.click(tabByName(container, /global/i));
    expect(tabByName(container, /global/i).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(tabByName(container, /humans/i).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("renders My Pools with at least one View pool link to /s/<slug>", () => {
    const { container } = render(<LeaderboardTabs />);
    fireEvent.click(tabByName(container, /my pools/i));
    const link = container.querySelector("a[href^='/s/']");
    expect(link).toBeTruthy();
    expect(link?.textContent ?? "").toMatch(/view pool/i);
  });

  it("ArrowRight moves selection to the next tab (keyboard nav)", () => {
    const { container } = render(<LeaderboardTabs />);
    const humans = tabByName(container, /humans/i);
    fireEvent.keyDown(humans, { key: "ArrowRight" });
    expect(tabByName(container, /bots/i).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("End jumps to My Pools (the last tab)", () => {
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
    expect(tabByName(container, /global/i).tabIndex).toBe(-1);
    expect(tabByName(container, /country/i).tabIndex).toBe(-1);
    expect(tabByName(container, /my pools/i).tabIndex).toBe(-1);
  });
});
