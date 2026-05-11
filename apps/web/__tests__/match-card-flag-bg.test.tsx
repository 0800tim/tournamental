/**
 * Vitest, MatchCard TVNZ-style flag-as-background visual contract.
 *
 *   - Each half cell renders the country flag SVG as `style.backgroundImage`.
 *   - The UPCOMING/LIVE/FINAL pill renders the correct text for each state.
 *   - 3-letter codes appear in the correct left/right slots.
 *   - The centre badge renders "vs" for pre, scoreline for live/final.
 *   - href makes the whole card a tap-target anchor pointing at the URL.
 *   - flagSrc override wins over the default `/flags/<CODE>.svg`.
 */

// @vitest-environment jsdom

import React from "react";
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

describe("MatchCard, flag-as-background", () => {
  it("renders the home flag SVG URL as the home half's backgroundImage", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "MEX", name: "Mexico" }}
        away={{ code: "CAN", name: "Canada" }}
        state="pre"
        kickoffUtc="2026-06-11T18:00:00Z"
      />,
    );
    const home = container.querySelector<HTMLDivElement>(
      '[data-testid="vt-match-card-flag-home"]',
    );
    expect(home).toBeTruthy();
    expect(home!.style.backgroundImage).toContain("/flags/MEX.svg");
  });

  it("renders the away flag SVG URL as the away half's backgroundImage", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "MEX", name: "Mexico" }}
        away={{ code: "CAN", name: "Canada" }}
        state="pre"
        kickoffUtc="2026-06-11T18:00:00Z"
      />,
    );
    const away = container.querySelector<HTMLDivElement>(
      '[data-testid="vt-match-card-flag-away"]',
    );
    expect(away).toBeTruthy();
    expect(away!.style.backgroundImage).toContain("/flags/CAN.svg");
  });

  it("renders UPCOMING pill by default for state=pre", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "ARG", name: "Argentina" }}
        away={{ code: "MEX", name: "Mexico" }}
        state="pre"
        kickoffUtc="2026-06-15T18:00:00Z"
      />,
    );
    const pill = container.querySelector<HTMLElement>(
      '[data-testid="vt-match-card-pill"]',
    );
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain("UPCOMING");
    expect(pill!.dataset.state).toBe("pre");
  });

  it("renders LIVE pill for state=live", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "ARG", name: "Argentina", score: 1 }}
        away={{ code: "MEX", name: "Mexico", score: 0 }}
        state="live"
        clockLabel="42'"
      />,
    );
    const pill = container.querySelector<HTMLElement>(
      '[data-testid="vt-match-card-pill"]',
    );
    expect(pill!.textContent).toContain("LIVE");
    expect(pill!.dataset.state).toBe("live");
  });

  it("renders FINAL pill for state=final", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "ARG", name: "Argentina", score: 3 }}
        away={{ code: "FRA", name: "France", score: 3 }}
        state="final"
      />,
    );
    const pill = container.querySelector<HTMLElement>(
      '[data-testid="vt-match-card-pill"]',
    );
    expect(pill!.textContent).toContain("FINAL");
    expect(pill!.dataset.state).toBe("final");
  });

  it("renders the 3-letter codes at the correct sides", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "MEX", name: "Mexico" }}
        away={{ code: "CAN", name: "Canada" }}
        state="pre"
        kickoffUtc="2026-06-11T18:00:00Z"
      />,
    );
    const homeCode = container.querySelector<HTMLElement>(
      '[data-testid="vt-match-card-code-home"]',
    );
    const awayCode = container.querySelector<HTMLElement>(
      '[data-testid="vt-match-card-code-away"]',
    );
    expect(homeCode?.textContent).toBe("MEX");
    expect(homeCode?.dataset.side).toBe("home");
    expect(awayCode?.textContent).toBe("CAN");
    expect(awayCode?.dataset.side).toBe("away");
  });

  it("renders a 'vs' centre badge for state=pre", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "MEX", name: "Mexico" }}
        away={{ code: "CAN", name: "Canada" }}
        state="pre"
        kickoffUtc="2026-06-11T18:00:00Z"
      />,
    );
    const centre = container.querySelector<HTMLElement>(
      '[data-testid="vt-match-card-centre"]',
    );
    expect(centre).toBeTruthy();
    expect(centre!.className).toContain("is-vs");
    expect(centre!.textContent?.trim()).toBe("vs");
  });

  it("renders the live scoreline in the centre badge for state=live", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "ARG", name: "Argentina", score: 2 }}
        away={{ code: "FRA", name: "France", score: 1 }}
        state="live"
        clockLabel="73'"
      />,
    );
    const centre = container.querySelector<HTMLElement>(
      '[data-testid="vt-match-card-centre"]',
    );
    expect(centre!.className).toContain("is-score");
    expect(centre!.textContent ?? "").toMatch(/2\s*:\s*1/);
  });

  it("navigates to the match preview when href is provided", () => {
    const { container } = render(
      <MatchCard
        home={{ code: "MEX", name: "Mexico" }}
        away={{ code: "CAN", name: "Canada" }}
        state="pre"
        kickoffUtc="2026-06-11T18:00:00Z"
        href="/match/wc26-m01/preview"
      />,
    );
    const link = container.querySelector<HTMLAnchorElement>("a.vt-match-card");
    expect(link).toBeTruthy();
    expect(link!.getAttribute("href")).toBe("/match/wc26-m01/preview");
    // Make sure both flag halves still render inside the anchor.
    expect(
      link!.querySelector('[data-testid="vt-match-card-flag-home"]'),
    ).toBeTruthy();
    expect(
      link!.querySelector('[data-testid="vt-match-card-flag-away"]'),
    ).toBeTruthy();
  });

  it("honours a flagSrc override over the default /flags/<CODE>.svg path", () => {
    const { container } = render(
      <MatchCard
        home={{
          code: "XYZ",
          name: "Xanadu",
          flagSrc: "/sponsor-flags/xyz-custom.svg",
        }}
        away={{ code: "CAN", name: "Canada" }}
        state="pre"
        kickoffUtc="2026-06-11T18:00:00Z"
      />,
    );
    const home = container.querySelector<HTMLDivElement>(
      '[data-testid="vt-match-card-flag-home"]',
    );
    expect(home!.style.backgroundImage).toContain("/sponsor-flags/xyz-custom.svg");
    expect(home!.style.backgroundImage).not.toContain("/flags/XYZ.svg");
  });
});
