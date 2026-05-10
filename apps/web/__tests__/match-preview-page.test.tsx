/**
 * Vitest — `/match/[id]/preview` server component renders for a known
 * group fixture, a knockout id, the final, and 404s for unknown ids.
 * Also covers the client tab component: each tab renders without
 * error and tab switching updates the URL hash.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, fireEvent, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

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

import MatchPreviewPage from "../app/match/[id]/preview/page";
import {
  MatchPreviewTabs,
  TAB_IDS,
} from "../app/match/[id]/preview/_components/MatchPreviewTabs";
import {
  resolveMatch,
  headToHead,
  lineupFor,
  statsFor,
  expectedScoreline,
} from "../app/match/[id]/preview/_lib/match-data";
import { loadFixtures2026 } from "@vtorn/bracket-engine";

describe("/match/[id]/preview server component", () => {
  it("renders match #1 (group A: MEX vs RSA) — both teams + Group A", () => {
    const { container } = render(<MatchPreviewPage params={{ id: "1" }} />);
    const html = container.textContent ?? "";
    expect(html).toContain("Mexico");
    expect(html).toContain("South Africa");
    expect(html).toContain("Group A");
  });

  it("renders the final by knockout id", () => {
    const { container } = render(<MatchPreviewPage params={{ id: "final" }} />);
    const html = container.textContent ?? "";
    expect(html).toContain("Final");
    // Final's slot occupants are unresolved (no picks) → labelled TBD.
    expect(html).toMatch(/TBD/);
  });

  it("renders an R32 match by id", () => {
    const { container } = render(<MatchPreviewPage params={{ id: "r32_01" }} />);
    const html = container.textContent ?? "";
    expect(html).toContain("Round of 32");
  });

  it("returns 404 for unknown ids", () => {
    expect(() => {
      render(<MatchPreviewPage params={{ id: "not-a-match" }} />);
    }).toThrow(/NEXT_NOT_FOUND/);
  });

  it("renders all 5 tab buttons", () => {
    const { container } = render(<MatchPreviewPage params={{ id: "1" }} />);
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(5);
    const labels = Array.from(tabs).map((t) => (t.textContent ?? "").trim());
    expect(labels).toEqual(["Predict", "H2H", "Form", "Lineup", "Stats"]);
  });
});

describe("MatchPreviewTabs client behaviour", () => {
  beforeEach(() => {
    // Reset hash before each test.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "#");
    }
  });

  function makeProps() {
    const tournament = loadFixtures2026();
    const match = resolveMatch(tournament, "1")!;
    const home = match.homeCode!;
    const away = match.awayCode!;
    const homeTeam = tournament.teams.find((t) => t.id === home)!;
    const awayTeam = tournament.teams.find((t) => t.id === away)!;
    return {
      match,
      homeTeam,
      awayTeam,
      homeName: homeTeam.name,
      awayName: awayTeam.name,
      homeForm: [],
      awayForm: [],
      h2h: headToHead(home, away),
      homeLineup: lineupFor(home),
      awayLineup: lineupFor(away),
      homeStats: statsFor(home),
      awayStats: statsFor(away),
      expected: expectedScoreline(home, away),
    } as const;
  }

  it("renders all 5 tabpanels", () => {
    const { container } = render(<MatchPreviewTabs {...makeProps()} />);
    const panels = container.querySelectorAll('[role="tabpanel"]');
    expect(panels.length).toBe(5);
  });

  it("clicking a tab updates the URL hash and switches the active panel", () => {
    const { container } = render(<MatchPreviewTabs {...makeProps()} />);
    for (const id of TAB_IDS) {
      const btn = container.querySelector(
        `[role="tab"][data-tab-id="${id}"]`,
      ) as HTMLButtonElement;
      expect(btn).toBeTruthy();
      act(() => {
        fireEvent.click(btn);
      });
      expect(window.location.hash).toBe(`#${id}`);
      expect(btn.getAttribute("aria-selected")).toBe("true");
      const panel = container.querySelector(`#mp-panel-${id}`)!;
      expect(panel.hasAttribute("hidden")).toBe(false);
    }
  });

  it("ArrowRight on tablist cycles to the next tab", () => {
    const { container } = render(<MatchPreviewTabs {...makeProps()} />);
    const tablist = container.querySelector('[role="tablist"]') as HTMLElement;
    // Default is predict (index 0); arrow right → h2h.
    act(() => {
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
    });
    expect(window.location.hash).toBe("#h2h");
  });

  it("each tab content renders without throwing", () => {
    const { container } = render(<MatchPreviewTabs {...makeProps()} />);
    // Walk through every tab and ensure it has non-empty content.
    for (const id of TAB_IDS) {
      const btn = container.querySelector(
        `[role="tab"][data-tab-id="${id}"]`,
      ) as HTMLButtonElement;
      act(() => {
        fireEvent.click(btn);
      });
      const panel = container.querySelector(`#mp-panel-${id}`) as HTMLElement;
      expect(panel).toBeTruthy();
      // Each panel has at least some text content (no silent breakage).
      expect((panel.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });
});

describe("MatchPredictionRow + KnockoutMatch view-match link", () => {
  it("MatchPredictionRow now exposes a `View match` link", async () => {
    const { MatchPredictionRow } = await import(
      "../components/bracket/MatchPredictionRow"
    );
    const tournament = loadFixtures2026();
    const home = tournament.teams[0]!;
    const away = tournament.teams[1]!;
    const onChange = vi.fn();
    const { container } = render(
      <MatchPredictionRow
        matchId="1"
        homeTeam={home}
        awayTeam={away}
        onChange={onChange}
      />,
    );
    const link = container.querySelector(
      "a.mpr-view-link",
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/match/1/preview");
  });
});

describe("match-data direction-insensitive H2H", () => {
  it("ARG-FRA and FRA-ARG return the same totals (orientation flipped)", () => {
    const a = headToHead("ARG", "FRA");
    const b = headToHead("FRA", "ARG");
    // From ARG's POV homeWins is ARG's tally; from FRA's POV the
    // value moves into awayWins. Draws is symmetrical.
    expect(a.homeWins).toBe(b.awayWins);
    expect(a.awayWins).toBe(b.homeWins);
    expect(a.draws).toBe(b.draws);
    expect(a.meetings.length).toBe(b.meetings.length);
  });
});
