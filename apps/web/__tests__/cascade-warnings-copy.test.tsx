/**
 * CascadeWarnings sizes its best-thirds copy from the tournament.
 */
import { describe, expect, it } from "vitest";
import {
  loadFixtures2026,
  loadFixturesRwc2027,
  type CascadeWarning,
} from "@tournamental/bracket-engine";

import { CascadeWarnings } from "@/components/bracket/CascadeWarnings";
import { render, screen } from "./helpers/render";

const incomplete: CascadeWarning[] = [
  { code: "annex_c_third_pool_incomplete", message: "Annex C routing requires exactly 4 best-third picks (got 2)" },
  { code: "annex_c_third_pool_incomplete", message: "Annex C routing requires exactly 4 best-third picks (got 2)" },
];

describe("CascadeWarnings best-thirds copy", () => {
  it("names four picks and the Round of 16 for Rugby World Cup 2027", () => {
    render(
      <CascadeWarnings warnings={incomplete} tournament={loadFixturesRwc2027()} currentTab="groups" onJumpToTab={() => {}} mode="details" />,
    );
    expect(
      screen.getByText("The best 3rd-placed teams stage needs all 4 picks before the Round of 16 can fill in."),
    ).toBeTruthy();
    // Duplicate codes collapse to one line.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("names eight picks and the Round of 32 for the 2026 World Cup", () => {
    render(
      <CascadeWarnings warnings={incomplete} tournament={loadFixtures2026()} currentTab="groups" onJumpToTab={() => {}} mode="details" />,
    );
    expect(
      screen.getByText("The best 3rd-placed teams stage needs all 8 picks before the Round of 32 can fill in."),
    ).toBeTruthy();
  });
});
