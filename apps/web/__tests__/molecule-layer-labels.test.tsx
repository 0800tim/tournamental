/**
 * Vitest, `<MoleculeLayerLabels>` left-edge layer guide overlay.
 *
 * Pure DOM (no R3F) so mounts cleanly under jsdom. The component renders
 * two parallel structures, a vertical strip (desktop) and a horizontal
 * pill row (mobile), both controlled by CSS media queries. The unit
 * tests assert that both structures exist in the DOM with the expected
 * label content, order, and accessibility shape.
 *
 * Media-query gating itself is a CSS concern; verifying that the rule
 * fires at the right viewport size belongs in the Playwright e2e suite.
 */

// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";

import { MoleculeLayerLabels } from "@/components/molecule/MoleculeLayerLabels";

describe("<MoleculeLayerLabels>", () => {
  it("renders all 7 labels in apex → base order on the vertical strip", () => {
    const { getByTestId } = render(<MoleculeLayerLabels />);
    const strip = getByTestId("molecule-layer-labels-vertical");
    const items = strip.querySelectorAll(".molecule-layer-labels-item");
    expect(items.length).toBe(7);

    const expected = [
      "Champion",
      "Final",
      "Semis",
      "Quarters",
      "Round of 16",
      "Round of 32",
      "Group Stage",
    ];
    const actual = Array.from(items).map(
      (el) =>
        el.querySelector(".molecule-layer-labels-text")?.textContent?.trim() ?? "",
    );
    expect(actual).toEqual(expected);
  });

  it("marks the Champion label with the champion data-stage and gold dot", () => {
    const { getByTestId } = render(<MoleculeLayerLabels />);
    const strip = getByTestId("molecule-layer-labels-vertical");
    const items = strip.querySelectorAll(".molecule-layer-labels-item");
    // Champion is first (apex).
    const championItem = items[0] as HTMLElement;
    expect(championItem.getAttribute("data-stage")).toBe("champion");
    // The gold dot only renders on the champion label.
    const dot = championItem.querySelector(".molecule-layer-labels-dot");
    expect(dot).not.toBeNull();
    // No other layer carries the dot.
    const allDots = strip.querySelectorAll(".molecule-layer-labels-dot");
    expect(allDots.length).toBe(1);
  });

  it("renders the mobile abbreviated variant alongside the vertical strip", () => {
    const { getByTestId } = render(<MoleculeLayerLabels />);
    const mobile = getByTestId("molecule-layer-labels-mobile");
    const items = mobile.querySelectorAll(".molecule-layer-labels-mobile-item");
    expect(items.length).toBe(7);

    const expected = ["CHAMP", "FINAL", "SF", "QF", "R16", "R32", "GROUP"];
    const actual = Array.from(items).map((el) => el.textContent?.trim() ?? "");
    expect(actual).toEqual(expected);
  });

  it("exposes role=img and a sentence-style aria-label on both variants", () => {
    const { getByTestId } = render(<MoleculeLayerLabels />);
    for (const id of [
      "molecule-layer-labels-vertical",
      "molecule-layer-labels-mobile",
    ]) {
      const el = getByTestId(id);
      expect(el.getAttribute("role")).toBe("img");
      expect(el.getAttribute("aria-label")).toMatch(
        /group stage at the base.*champion at the apex/i,
      );
    }
  });

  it("renders a faint vertical divider line in the vertical strip", () => {
    const { getByTestId } = render(<MoleculeLayerLabels />);
    const strip = getByTestId("molecule-layer-labels-vertical");
    const divider = within(strip).getByText("", { selector: ".molecule-layer-labels-divider" });
    expect(divider).toBeDefined();
    // Aria-hidden so SR users don't hear it as a divider.
    expect(divider.getAttribute("aria-hidden")).toBe("true");
  });

  it("marks the inner label lists as aria-hidden (decorative)", () => {
    const { getByTestId } = render(<MoleculeLayerLabels />);
    const stripList = getByTestId("molecule-layer-labels-vertical").querySelector("ul");
    const mobileList = getByTestId("molecule-layer-labels-mobile").querySelector("ul");
    expect(stripList?.getAttribute("aria-hidden")).toBe("true");
    expect(mobileList?.getAttribute("aria-hidden")).toBe("true");
  });
});
