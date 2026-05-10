/**
 * Vitest — MatchCard renders the right middle column for each state.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import { MatchCard } from "@/components/ui/MatchCard";

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

describe("<MatchCard>", () => {
  it("shows kickoff time and date for state=pre", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "ARG", name: "Argentina" }}
        away={{ code: "MEX", name: "Mexico" }}
        state="pre"
        kickoffUtc="2026-06-15T18:00:00Z"
        groupId="A"
        venue="Estadio Azteca"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Argentina");
    expect(text).toContain("Mexico");
    expect(text).toContain("Group A");
    expect(text).toContain("Estadio Azteca");
  });

  it("shows score and clock for state=live", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "ARG", name: "Argentina", score: 2 }}
        away={{ code: "FRA", name: "France", score: 1 }}
        state="live"
        clockLabel="73'"
        groupId="C"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/2\s*:\s*1/);
    expect(text).toContain("73'");
    expect(text).toContain("LIVE");
  });

  it("shows final score and FT badge for state=final", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "ARG", name: "Argentina", score: 3 }}
        away={{ code: "FRA", name: "France", score: 3 }}
        state="final"
        groupId="C"
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/3\s*-\s*3/);
    expect(text).toContain("FT");
  });

  it("renders as a link when href is provided", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "ARG", name: "Argentina" }}
        away={{ code: "MEX", name: "Mexico" }}
        state="pre"
        kickoffUtc="2026-06-15T18:00:00Z"
        href="/match/abc"
      />,
    );
    const link = container.querySelector("a.vt-match-card");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("/match/abc");
  });
});
