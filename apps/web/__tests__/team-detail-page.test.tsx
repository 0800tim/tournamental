/**
 * Vitest — `/team/[code]` server-component renders for known codes and
 * 404s for unknown codes. Smoke-tests the hero (name + FIFA rank chip)
 * and group context.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// next/link → render plain <a>. The team page uses Link for nav only.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// next/navigation.notFound → throw a flagged error so we can assert.
class NotFoundError extends Error {
  readonly digest = "NEXT_NOT_FOUND";
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
}));

import TeamPage from "../app/team/[code]/page";

describe("/team/[code] page", () => {
  it("renders Argentina (ARG) — name, FIFA rank, group J", () => {
    const { container } = render(<TeamPage params={{ code: "ARG" }} />);
    const html = container.textContent ?? "";
    expect(html).toContain("Argentina");
    // FIFA #1 — comes from data file.
    expect(html).toMatch(/FIFA\s*#1(?!\d)/);
    // Argentina is in Group J in the canonical fixtures JSON.
    expect(html).toContain("Group J");
  });

  it("renders Mexico (MEX) — name + Group A", () => {
    const { container } = render(<TeamPage params={{ code: "MEX" }} />);
    const html = container.textContent ?? "";
    expect(html).toContain("Mexico");
    expect(html).toContain("Group A");
  });

  it("accepts lowercase codes", () => {
    const { container } = render(<TeamPage params={{ code: "usa" }} />);
    const html = container.textContent ?? "";
    expect(html).toContain("United States");
  });

  it("returns 404 for unknown codes", () => {
    expect(() => {
      render(<TeamPage params={{ code: "XYZ" }} />);
    }).toThrow(/NEXT_NOT_FOUND/);
  });

  it("renders a quick-pick CTA pointing into the bracket", () => {
    const { container } = render(<TeamPage params={{ code: "ARG" }} />);
    const cta = container.querySelector('[data-testid="td-quick-pick"]') as HTMLAnchorElement | null;
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute("href")).toMatch(/^\/world-cup-2026(#match-\d+)?$/);
  });

  it("renders the real player-card squad grid for teams with player data", () => {
    const { container } = render(<TeamPage params={{ code: "ARG" }} />);
    // ARG is fully populated in apps/web/data/players-2026.json — uses
    // <PlayerCard /> grid, not the stub `.td-squad-card`.
    const realCards = container.querySelectorAll('[data-testid="player-card"]');
    expect(realCards.length).toBeGreaterThan(0);
    // Each card links into /player/<id>.
    const firstHref = realCards[0]?.getAttribute("href");
    expect(firstHref).toMatch(/^\/player\/ARG-/);
  });

  it("falls back to the stub squad when the team has no player data", () => {
    // Pick a code that's in canonical teams.json but has no entries in
    // players-2026.json. ALG has no seed players (seed only covers 24
    // marquee teams).
    const { container } = render(<TeamPage params={{ code: "ALG" }} />);
    const stub = container.querySelectorAll(".td-squad-card");
    expect(stub.length).toBeGreaterThan(0);
  });

  it("renders 5 recent-form dots", () => {
    const { container } = render(<TeamPage params={{ code: "BRA" }} />);
    const dots = container.querySelectorAll(".td-form-dot");
    expect(dots.length).toBe(5);
  });
});
