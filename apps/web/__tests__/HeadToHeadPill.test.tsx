/**
 * HeadToHeadPill, compact W-D-L summary rendered on bracket rows + match
 * preview cards.
 *
 * Asserts:
 *  - compact variant displays "homeWins-draws-awayWins" for given counts
 *  - aria-label captures the record so screen readers get the same info
 *  - empty records render a "no previous meetings" hint
 *  - wide variant renders the same numbers with the [code] N W layout
 */

// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { HeadToHeadPill } from "../components/shared/HeadToHeadPill";

describe("HeadToHeadPill", () => {
  it("compact variant displays '2-1-1' for given counts", () => {
    const { container, getByTestId } = render(
      <HeadToHeadPill
        homeCode="ARG"
        awayCode="FRA"
        counts={{ homeWins: 2, draws: 1, awayWins: 1 }}
      />,
    );
    expect(getByTestId("h2h-record").textContent).toBe("2-1-1");
    // Both team codes are rendered in the pill text.
    const pill = container.querySelector(".h2h-pill") as HTMLElement;
    expect(pill.textContent).toContain("ARG");
    expect(pill.textContent).toContain("FRA");
  });

  it("aria-labels the record for screen readers", () => {
    const { container } = render(
      <HeadToHeadPill
        homeCode="ARG"
        awayCode="FRA"
        counts={{ homeWins: 2, draws: 1, awayWins: 1 }}
      />,
    );
    const pill = container.querySelector(".h2h-pill") as HTMLElement;
    const aria = pill.getAttribute("aria-label") ?? "";
    expect(aria).toContain("ARG");
    expect(aria).toContain("FRA");
    expect(aria).toMatch(/2/);
    expect(aria).toMatch(/1/);
  });

  it("renders 'no previous meetings' for an all-zero record", () => {
    const { container } = render(
      <HeadToHeadPill
        homeCode="NZL"
        awayCode="LUX"
        counts={{ homeWins: 0, draws: 0, awayWins: 0 }}
      />,
    );
    const pill = container.querySelector(".h2h-pill") as HTMLElement;
    expect(pill.textContent).toContain("no previous meetings");
    expect(pill.classList.contains("h2h-pill-empty")).toBe(true);
  });

  it("wide variant displays both teams with their wins", () => {
    const { container } = render(
      <HeadToHeadPill
        homeCode="ARG"
        awayCode="FRA"
        counts={{ homeWins: 4, draws: 3, awayWins: 2 }}
        variant="wide"
      />,
    );
    const pill = container.querySelector(".h2h-pill-wide") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain("ARG");
    expect(pill.textContent).toContain("FRA");
    expect(pill.textContent).toContain("4");
    expect(pill.textContent).toContain("3");
    expect(pill.textContent).toContain("2");
  });
});
