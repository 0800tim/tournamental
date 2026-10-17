/**
 * TeamFlag, bracket-pick affordance that gained `selectionRing` + `dim`
 * props for the MPR enrichment work.
 *
 * Asserts:
 *  - selectionRing renders an outline using the supplied accentColor
 *  - dim adds a desaturating CSS class
 *  - the additive props don't break the existing default render path
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { TeamFlag } from "../components/bracket/TeamFlag";

describe("TeamFlag", () => {
  it("renders without selection ring or dim by default", () => {
    const { container } = render(<TeamFlag code="ARG" name="Argentina" />);
    const wrap = container.querySelector("[aria-label='Argentina']") as HTMLElement;
    expect(wrap.dataset.selectionRing).toBeUndefined();
    expect(wrap.dataset.dim).toBeUndefined();
    expect(wrap.style.outline).toBe("");
  });

  it("renders an outline of accentColor when selectionRing is true", () => {
    const { container } = render(
      <TeamFlag
        code="ARG"
        name="Argentina"
        accentColor="#75AADB"
        shape="circle"
        selectionRing
      />,
    );
    const wrap = container.querySelector("[aria-label='Argentina']") as HTMLElement;
    expect(wrap.dataset.selectionRing).toBe("true");
    // jsdom serialises the inline style. Since aa87ef74 (Tim 2026-05-20)
    // the ring is a 4px brand-gold outline on every pick; the kit colour
    // passed in via accentColor only drives the soft glow in CSS.
    expect(wrap.style.outline).toContain("4px");
    expect(wrap.style.outline.toLowerCase()).toContain("solid");
    expect(wrap.style.outline).toContain("--vt-gold-400");
  });

  it("dim flag flips the data-dim hook the CSS reads", () => {
    const { container } = render(
      <TeamFlag code="FRA" name="France" shape="circle" dim />,
    );
    const wrap = container.querySelector("[aria-label='France']") as HTMLElement;
    expect(wrap.dataset.dim).toBe("true");
  });
});
