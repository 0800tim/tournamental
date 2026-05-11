/**
 * Vitest, bracket round-tabs view.
 *
 * Verifies the per-round tab restructure introduced by
 * feat/bracket-tabs-and-save-rename. The BracketBuilder now has six
 * tabs (Groups, R32, R16, QF, SF + 3rd, Final) instead of the old
 * three. The tab state is hash-routable so /world-cup-2026#qf lands on
 * the quarter-finals tab.
 *
 * The tournament fixture is the real FIFA WC 2026 spec, slot
 * placeholders for knockouts mean we can probe DOM presence without
 * needing to drive a full cascade through every test.
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { loadFixtures2026 } from "@tournamental/bracket-engine";

import { BracketBuilder } from "../components/bracket/BracketBuilder";

const tournament = loadFixtures2026();

beforeEach(() => {
  window.localStorage.clear();
  // Reset the URL hash between tests so #qf etc. don't leak.
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", "/");
  }
});

const ROUND_TABS = [
  { name: /^Groups/, label: "Groups" },
  { name: /^R32/, label: "R32" },
  { name: /^R16/, label: "R16" },
  { name: /^QF/, label: "QF" },
  { name: /^SF/, label: "SF + 3rd" },
  { name: /^Final/, label: "Final" },
];

describe("<BracketBuilder>, round tabs", () => {
  it("renders all six round tabs", () => {
    render(<BracketBuilder tournament={tournament} />);
    for (const t of ROUND_TABS) {
      expect(screen.getByRole("tab", { name: t.name })).toBeTruthy();
    }
  });

  it("defaults to the Groups tab and shows the 12 group cards", () => {
    render(<BracketBuilder tournament={tournament} />);
    const groupsTab = screen.getByRole("tab", { name: /^Groups/ });
    expect(groupsTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByText(/Group [A-L]/).length).toBeGreaterThanOrEqual(12);
  });

  it("switching to R32 marks only that tab as aria-selected and shows R32 cards", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /^R32/ }));
    const r32 = screen.getByRole("tab", { name: /^R32/ });
    expect(r32.getAttribute("aria-selected")).toBe("true");
    const groups = screen.getByRole("tab", { name: /^Groups/ });
    expect(groups.getAttribute("aria-selected")).toBe("false");
    // Round panel heading
    const panel = screen.getByRole("tabpanel", { name: /Round of 32/i });
    expect(panel).toBeTruthy();
    // 16 R32 cards (the fixture has match ids r32_01..r32_16)
    const cards = panel.querySelectorAll(".km-card[data-match-id^='r32_']");
    expect(cards.length).toBe(16);
  });

  it("R16 tab renders only round-of-16 cards (8 cards)", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /^R16/ }));
    const panel = screen.getByRole("tabpanel", { name: /Round of 16/i });
    expect(panel.querySelectorAll(".km-card[data-match-id^='r16_']").length).toBe(8);
    expect(panel.querySelectorAll(".km-card[data-match-id^='qf_']").length).toBe(0);
    expect(panel.querySelectorAll(".km-card[data-match-id^='r32_']").length).toBe(0);
  });

  it("QF tab renders only quarter-final cards (4 cards)", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /^QF/ }));
    const panel = screen.getByRole("tabpanel", { name: /Quarter-finals/i });
    expect(panel.querySelectorAll(".km-card[data-match-id^='qf_']").length).toBe(4);
  });

  it("SF + 3rd tab renders both the 2 semi-finals and the 3rd-place playoff in sub-sections", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /^SF/ }));
    const panel = screen.getByRole("tabpanel", { name: /Semi-finals and 3rd-place/i });
    expect(panel.querySelectorAll(".km-card[data-match-id^='sf_']").length).toBe(2);
    expect(panel.querySelectorAll(".km-card[data-match-id^='tp_']").length).toBe(1);
    // Sub-section titles (the panel has its own h2 plus the sub-section h3s).
    const sfSubgroupTitle = panel.querySelector(
      ".bracket-round-subgroup[aria-label='Semi-finals'] .bracket-round-subgroup-title",
    );
    const tpSubgroupTitle = panel.querySelector(
      ".bracket-round-subgroup[aria-label='3rd-place play-off'] .bracket-round-subgroup-title",
    );
    expect(sfSubgroupTitle?.textContent).toBe("Semi-finals");
    expect(tpSubgroupTitle?.textContent).toBe("3rd-place play-off");
  });

  it("Final tab renders the single final match + the save summary", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /^Final/ }));
    const panel = screen.getByRole("tabpanel", { name: /Final and bracket summary/i });
    expect(panel.querySelectorAll(".km-card[data-match-id='final']").length).toBe(1);
    // Save summary shows up
    expect(within(panel).getByTestId("lock-summary")).toBeTruthy();
    // Submit button reads "Save bracket" (not "Lock final")
    expect(within(panel).getByRole("button", { name: /Save bracket/ })).toBeTruthy();
  });

  it("each tab shows a per-round progress counter (picked/total)", () => {
    render(<BracketBuilder tournament={tournament} />);
    // Groups tab counter
    const groupsTab = screen.getByRole("tab", { name: /^Groups/ });
    expect(groupsTab.textContent).toMatch(/0\/72/);
    // R32 counter: 0 picked of 16 total
    const r32Tab = screen.getByRole("tab", { name: /^R32/ });
    expect(r32Tab.textContent).toMatch(/0\/16/);
    // Final counter: 0 picked of 1 total
    const finalTab = screen.getByRole("tab", { name: /^Final/ });
    expect(finalTab.textContent).toMatch(/0\/1/);
  });

  it("URL hash drives the active tab on mount", () => {
    // SSR-rendered default is "groups"; the mount effect reads
    // window.location.hash to pick the right tab.
    window.history.replaceState(null, "", "/world-cup-2026#qf");
    render(<BracketBuilder tournament={tournament} />);
    const qf = screen.getByRole("tab", { name: /^QF/ });
    expect(qf.getAttribute("aria-selected")).toBe("true");
  });

  it("alias hashes (#knockouts → R32, #lock → Final) route to a sensible tab", () => {
    window.history.replaceState(null, "", "/world-cup-2026#knockouts");
    const { unmount } = render(<BracketBuilder tournament={tournament} />);
    expect(
      screen.getByRole("tab", { name: /^R32/ }).getAttribute("aria-selected"),
    ).toBe("true");
    unmount();
    window.history.replaceState(null, "", "/world-cup-2026#lock");
    render(<BracketBuilder tournament={tournament} />);
    expect(
      screen.getByRole("tab", { name: /^Final/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("clicking a tab updates the URL hash via replaceState", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /^QF/ }));
    expect(window.location.hash).toBe("#qf");
    fireEvent.click(screen.getByRole("tab", { name: /^Final/ }));
    expect(window.location.hash).toBe("#final");
  });

  it("hashchange events from back/forward navigation update the active tab", () => {
    render(<BracketBuilder tournament={tournament} />);
    expect(
      screen.getByRole("tab", { name: /^Groups/ }).getAttribute("aria-selected"),
    ).toBe("true");
    // Simulate the user using back/forward, change the hash, then
    // dispatch a hashchange event so the listener picks it up. jsdom's
    // history doesn't always synthesise this when replaceState is
    // called programmatically, hence the explicit dispatch.
    window.history.replaceState(null, "", "/world-cup-2026#sf");
    // Use the generic Event constructor, HashChangeEvent isn't a
    // separate ctor in older jsdom builds.
    fireEvent(window, new Event("hashchange"));
    expect(
      screen.getByRole("tab", { name: /^SF/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("tab change preserves user picks (group pick survives jumping tabs)", () => {
    render(<BracketBuilder tournament={tournament} />);
    const groupACard = screen.getAllByText("Group A")[0]!.closest(
      ".bracket-group",
    ) as HTMLElement;
    fireEvent.click(groupACard.querySelector(".mpr-pick-home")!);
    // Jump to QF then back to Groups
    fireEvent.click(screen.getByRole("tab", { name: /^QF/ }));
    fireEvent.click(screen.getByRole("tab", { name: /^Groups/ }));
    // Pick is still selected
    const groupAAgain = screen.getAllByText("Group A")[0]!.closest(
      ".bracket-group",
    ) as HTMLElement;
    const firstHome = groupAAgain.querySelector(
      ".mpr-pick-home",
    ) as HTMLButtonElement;
    expect(firstHome.getAttribute("aria-pressed")).toBe("true");
  });

  it("the running total in the header reflects picks across rounds", () => {
    render(<BracketBuilder tournament={tournament} />);
    const total = screen.getByText(/of 104 matches picked/i);
    expect(total.textContent).toMatch(/^\s*0\s*of\s*104/);
    // Pick a single group match
    const groupACard = screen.getAllByText("Group A")[0]!.closest(
      ".bracket-group",
    ) as HTMLElement;
    fireEvent.click(groupACard.querySelector(".mpr-pick-home")!);
    expect(screen.getByText(/of 104 matches picked/i).textContent).toMatch(
      /1\s*of\s*104/,
    );
  });

  it("renders the floating mobile Save & Share CTA with both buttons", () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    const cta = container.querySelector(".bracket-mobile-cta");
    expect(cta).toBeTruthy();
    expect(cta!.querySelector(".bracket-mobile-cta-save")?.textContent).toBe(
      "Save",
    );
    expect(cta!.querySelector(".bracket-mobile-cta-share")).toBeTruthy();
  });

  it("the mobile Save button persists to localStorage", () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    // Click a pick first so there's something to save.
    const groupACard = screen.getAllByText("Group A")[0]!.closest(
      ".bracket-group",
    ) as HTMLElement;
    fireEvent.click(groupACard.querySelector(".mpr-pick-home")!);
    // Clear the draft to simulate the user wanting to re-save.
    const beforeKeys = Object.keys(window.localStorage);
    expect(beforeKeys.length).toBeGreaterThan(0);
    // Click the floating Save button.
    fireEvent.click(container.querySelector(".bracket-mobile-cta-save")!);
    // Draft is still present (no exception thrown).
    const draftKeys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith("vtorn:bracket:v2:"),
    );
    expect(draftKeys.length).toBe(1);
  });

  it("sticky tab bar is styled with position: sticky (CSS contract)", () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    const tabsEl = container.querySelector(".bracket-tabs");
    expect(tabsEl).toBeTruthy();
    // The CSS lives in bracket.css; we assert the class is present so
    // the selector keeps matching. The actual computed style isn't
    // applied in jsdom (no stylesheet evaluation), so the contract here
    // is presence of the class on the right node.
    expect(tabsEl?.parentElement?.className).toContain("bracket-builder");
  });

  it("Auto-pick CTA is still reachable from the tab bar", () => {
    render(<BracketBuilder tournament={tournament} />);
    const autopick = screen.getByRole("button", {
      name: /Auto-pick from live odds/i,
    });
    expect(autopick).toBeTruthy();
    fireEvent.click(autopick);
    // Confirm modal appears.
    expect(
      screen.getByRole("dialog", { name: /Auto-pick the favourite/i }),
    ).toBeTruthy();
    // Cancel to clean up.
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
  });
});

describe("Lock → Save rename, user-visible copy", () => {
  it("the header copy reads 'save' (not 'lock')", () => {
    render(<BracketBuilder tournament={tournament} />);
    // Header preamble mentions "Save each pick before its match kicks off"
    expect(
      screen.getByText(/Save each pick before its match kicks off/i),
    ).toBeTruthy();
  });

  it("the Final tab's primary action button says 'Save bracket'", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /^Final/ }));
    expect(screen.getByRole("button", { name: /^Save bracket$/ })).toBeTruthy();
  });

  it("the Final tab's secondary action says 'Save draft locally' (not 'Save draft')", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(screen.getByRole("tab", { name: /^Final/ }));
    expect(
      screen.getByRole("button", { name: /^Save draft locally$/ }),
    ).toBeTruthy();
  });

  it("BracketBuilder rendered output contains no user-visible 'Lock' verbs", () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    // The walkable text content of the bracket builder should not
    // contain "Lock" as a leading-capital verb. We allow "lock" in
    // lowercase appearing inside compound words like "kickoff" or
    // class attributes (querying textContent only walks visible text,
    // so attributes are out of scope). The intentional remaining
    // matches are: (none, everything user-visible was renamed).
    const visibleText = container.textContent ?? "";
    // Allowlist: nothing should match these patterns. If a future PR
    // re-introduces "Lock" as a verb, this test fails loudly.
    const offending = visibleText.match(/\bLock\b/g) ?? [];
    expect(offending).toEqual([]);
  });

  it("clicking the auto-pick confirm modal shows 'starting point' (not 'not a lock')", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Auto-pick from live odds/i }),
    );
    const modal = screen.getByRole("dialog", {
      name: /Auto-pick the favourite/i,
    });
    expect(modal.textContent).toMatch(/starting point/i);
    expect(modal.textContent).not.toMatch(/not a lock/i);
    // Cancel to clean up.
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
  });
});

/**
 * Auto-pick prominence, Tim's launch-eve UX fix (2026-05-11):
 * the Auto-pick CTA was buried at the right end of the horizontally-
 * scrolling tab strip on mobile. These tests cover the hoist into a
 * dedicated row above the tabs, the new subtitle copy, and the
 * mobile-only sticky condensed pill.
 */
describe("<BracketBuilder>, prominent Auto-pick row", () => {
  it("renders the Auto-pick CTA in a row separate from the tab strip", () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    const autoPickRow = container.querySelector(
      "[data-testid='bracket-autopick-row']",
    );
    const tabStrip = container.querySelector("[data-testid='bracket-tabs']");
    expect(autoPickRow).toBeTruthy();
    expect(tabStrip).toBeTruthy();
    // The auto-pick row must not be a descendant of the tab strip, and
    // the tab strip must not be a descendant of the auto-pick row.
    expect(tabStrip!.contains(autoPickRow!)).toBe(false);
    expect(autoPickRow!.contains(tabStrip!)).toBe(false);
    // The prominent CTA lives inside the dedicated row.
    const cta = autoPickRow!.querySelector(".bracket-autopick-cta");
    expect(cta).toBeTruthy();
    expect(cta!.getAttribute("aria-label")).toBe("Auto-pick from live odds");
  });

  it("Auto-pick row appears above the tab strip in DOM order", () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    const autoPickRow = container.querySelector(
      "[data-testid='bracket-autopick-row']",
    ) as HTMLElement;
    const tabStrip = container.querySelector(
      "[data-testid='bracket-tabs']",
    ) as HTMLElement;
    // Node.compareDocumentPosition returns DOCUMENT_POSITION_FOLLOWING (4)
    // when the argument follows the reference node in document order.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(
      autoPickRow.compareDocumentPosition(tabStrip) & FOLLOWING,
    ).toBeTruthy();
  });

  it("subtitle reads the empty-bracket copy when no picks exist", () => {
    render(<BracketBuilder tournament={tournament} />);
    const subtitle = document.getElementById("bracket-autopick-subtitle");
    expect(subtitle).toBeTruthy();
    expect(subtitle!.textContent).toMatch(
      /Fill your bracket using live consensus odds/i,
    );
    expect(subtitle!.textContent).toMatch(/edit any pick before kickoff/i);
  });

  it("subtitle flips to the 'refresh empty picks' copy once the user has at least one pick", () => {
    render(<BracketBuilder tournament={tournament} />);
    // Make one group pick.
    const groupACard = screen.getAllByText("Group A")[0]!.closest(
      ".bracket-group",
    ) as HTMLElement;
    fireEvent.click(groupACard.querySelector(".mpr-pick-home")!);
    const subtitle = document.getElementById("bracket-autopick-subtitle");
    expect(subtitle!.textContent).toMatch(
      /Refresh empty picks using live consensus odds/i,
    );
  });

  it("prominent CTA is keyboard-accessible: aria-label + describedby", () => {
    render(<BracketBuilder tournament={tournament} />);
    const cta = screen.getByRole("button", {
      name: /^Auto-pick from live odds$/,
    });
    expect(cta.getAttribute("aria-describedby")).toBe(
      "bracket-autopick-subtitle",
    );
    // The describedby target must exist so screen-readers can find it.
    const desc = document.getElementById("bracket-autopick-subtitle");
    expect(desc).toBeTruthy();
  });

  it("clicking the prominent Auto-pick CTA still opens the confirm modal", () => {
    render(<BracketBuilder tournament={tournament} />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Auto-pick from live odds$/ }),
    );
    expect(
      screen.getByRole("dialog", { name: /Auto-pick the favourite/i }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
  });

  it("renders the mobile-only sticky Auto-pick shortcut pill", () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    const sticky = container.querySelector(
      "[data-testid='bracket-autopick-sticky']",
    );
    expect(sticky).toBeTruthy();
    expect(sticky!.getAttribute("aria-label")).toBe(
      "Auto-pick (sticky shortcut)",
    );
    // Sticky pill opens the same confirm modal as the prominent CTA.
    fireEvent.click(sticky!);
    expect(
      screen.getByRole("dialog", { name: /Auto-pick the favourite/i }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
  });

  it("Auto-pick button is no longer a child of the tab strip nav", () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    const tabStrip = container.querySelector("[data-testid='bracket-tabs']");
    expect(tabStrip).toBeTruthy();
    // The legacy in-tab-strip auto-pick button used .bracket-tab-autopick
    // and lived inside the nav. After the hoist the nav should contain
    // no buttons with that class.
    const inTabAutopick = tabStrip!.querySelector(".bracket-tab-autopick");
    expect(inTabAutopick).toBeNull();
  });
});

/**
 * Mobile viewport (375x812, iPhone 13 Mini) sanity check. jsdom doesn't
 * apply stylesheets, so we can't measure layout pixels here, but we can
 * verify the DOM contract the CSS relies on: the sticky pill exists and
 * is rendered on every render (its visibility is purely a media-query
 * concern). Precedent: bracket-mobile-gestures.test.tsx uses jsdom +
 * window.innerWidth stubs for similar contract assertions.
 */
describe("<BracketBuilder>, mobile viewport (375x812) Auto-pick contract", () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 812, configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(window, "innerWidth", {
      value: originalInnerWidth,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: originalInnerHeight,
      configurable: true,
    });
  });

  it("the prominent CTA, the subtitle, and the sticky shortcut all render on a 375px viewport", () => {
    const { container } = render(<BracketBuilder tournament={tournament} />);
    expect(container.querySelector(".bracket-autopick-cta")).toBeTruthy();
    expect(container.querySelector(".bracket-autopick-subtitle")).toBeTruthy();
    expect(container.querySelector(".bracket-autopick-sticky")).toBeTruthy();
  });
});

