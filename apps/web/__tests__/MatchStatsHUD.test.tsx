/**
 * MatchStatsHUD component tests (jsdom).
 *
 * Verifies the broadcast HUD shell composes the centred scoreboard
 * + the right-edge collapsible card stack, and that the data flows
 * (scorers, stats, subs) still render correctly after the UI polish.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { createMatchStore } from "@tournamental/spec-client";
import type { EventMessage, MatchInit, StateFrame } from "@tournamental/spec";
import { SPEC_VERSION } from "@tournamental/spec";
import { MatchStatsHUD } from "@/components/MatchStatsHUD";

const init: MatchInit = {
  type: "match.init",
  spec_version: SPEC_VERSION,
  match_id: "test",
  sport: "soccer",
  field: { length: 100, width: 64, units: "m" },
  teams: [
    {
      id: "ARG",
      name: "Argentina",
      short_name: "ARG",
      kit: { primary: "#75AADB", secondary: "#FFFFFF" },
      players: [
        { id: "ARG_10", name: "Messi", number: 10, position: "ST" },
        { id: "ARG_9", name: "Di María", number: 11, position: "RW" },
      ],
    },
    {
      id: "FRA",
      name: "France",
      short_name: "FRA",
      kit: { primary: "#0055A4", secondary: "#FFFFFF" },
      players: [
        { id: "FRA_10", name: "Mbappé", number: 10, position: "ST" },
      ],
    },
  ],
  start_time: "2022-12-18T15:00:00Z",
  producer: "test",
};

function expandCard(testid: string) {
  // Cards default to collapsed; some tests need the body in the DOM to
  // assert on its descendants. The chevron button is the toggle.
  const toggle = screen.getByTestId(`hud-card-toggle-${testid}`);
  act(() => {
    fireEvent.click(toggle);
  });
}

beforeEach(() => {
  cleanup();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});
afterEach(() => {
  cleanup();
});

describe("MatchStatsHUD", () => {
  it("renders nothing before init has arrived", () => {
    const store = createMatchStore();
    const { container } = render(<MatchStatsHUD store={store} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the centred scoreboard with home + away codes and 0-0 score", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
    });
    render(<MatchStatsHUD store={store} />);
    expect(screen.getByTestId("match-scoreboard")).toBeTruthy();
    expect(screen.getByTestId("msb-home-name").textContent).toBe("ARG");
    expect(screen.getByTestId("msb-away-name").textContent).toBe("FRA");
    expect(screen.getByTestId("msb-home-score").textContent).toBe("0");
    expect(screen.getByTestId("msb-away-score").textContent).toBe("0");
  });

  it("scoreboard updates when an event.score_change arrives", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
    });
    render(<MatchStatsHUD store={store} />);
    act(() => {
      store.getState().applyMessage({
        type: "event.score_change",
        t: 1_380_001,
        home: 1,
        away: 0,
      } as EventMessage);
    });
    expect(screen.getByTestId("msb-home-score").textContent).toBe("1");
    expect(screen.getByTestId("msb-away-score").textContent).toBe("0");
  });

  it("scorers card lists goals in chronological order once expanded", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
      const frame: StateFrame = {
        type: "state",
        t: 5_000_000,
        ball: { pos: [0, 0, 0] },
        players: [],
      };
      store.getState().applyMessage(frame);
      [
        { type: "event.goal", t: 1_380_000, player: "ARG_10", team: "ARG" },
        { type: "event.score_change", t: 1_380_001, home: 1, away: 0 },
        { type: "event.goal", t: 2_160_000, player: "ARG_9", team: "ARG" },
        { type: "event.score_change", t: 2_160_001, home: 2, away: 0 },
        { type: "event.goal", t: 4_800_000, player: "FRA_10", team: "FRA" },
        { type: "event.score_change", t: 4_800_001, home: 2, away: 1 },
      ].forEach((m) => store.getState().applyMessage(m as EventMessage));
    });
    render(<MatchStatsHUD store={store} />);
    expandCard("scorers");
    const rows = screen.getAllByTestId("msh-scorer-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Messi");
    expect(rows[0].textContent).toContain("23'");
    expect(rows[1].textContent).toContain("Di María");
    expect(rows[1].textContent).toContain("36'");
    expect(rows[2].textContent).toContain("Mbappé");
    expect(rows[2].textContent).toContain("80'");
  });

  it("scorer side data attribute matches home/away", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
      const frame: StateFrame = {
        type: "state",
        t: 5_000_000,
        ball: { pos: [0, 0, 0] },
        players: [],
      };
      store.getState().applyMessage(frame);
      [
        { type: "event.goal", t: 1_380_000, player: "ARG_10", team: "ARG" },
        { type: "event.score_change", t: 1_380_001, home: 1, away: 0 },
        { type: "event.goal", t: 4_800_000, player: "FRA_10", team: "FRA" },
        { type: "event.score_change", t: 4_800_001, home: 1, away: 1 },
      ].forEach((m) => store.getState().applyMessage(m as EventMessage));
    });
    render(<MatchStatsHUD store={store} />);
    expandCard("scorers");
    const rows = screen.getAllByTestId("msh-scorer-row");
    expect(rows[0].dataset.side).toBe("home");
    expect(rows[1].dataset.side).toBe("away");
  });

  it("shots / fouls / cards / saves render in the stats card", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
      const frame: StateFrame = {
        type: "state",
        t: 5_000_000,
        ball: { pos: [0, 0, 0] },
        players: [],
      };
      store.getState().applyMessage(frame);
      [
        { type: "event.shot", t: 100_000, player: "ARG_10", target: [50, 0, 1.5], on_target: true },
        { type: "event.shot", t: 200_000, player: "FRA_10", target: [-50, 0, 1.5], on_target: false },
        { type: "event.foul", t: 300_000, player: "FRA_10", severity: "yellow" },
        { type: "event.foul", t: 400_000, player: "ARG_10", severity: "red" },
        { type: "event.save", t: 500_000, keeper: "ARG_9" },
      ].forEach((m) => store.getState().applyMessage(m as EventMessage));
    });
    render(<MatchStatsHUD store={store} />);
    expandCard("stats");
    expect(screen.getByTestId("msh-stat-shots").textContent).toContain("1");
    expect(screen.getByTestId("msh-stat-yellows").textContent).toContain("1");
    expect(screen.getByTestId("msh-stat-reds").textContent).toContain("1");
    expect(screen.getByTestId("msh-stat-saves").textContent).toContain("1");
  });

  it("renders the three collapsible cards (scorers, stats, subs)", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
    });
    render(<MatchStatsHUD store={store} />);
    expect(screen.getByTestId("hud-card-scorers")).toBeTruthy();
    expect(screen.getByTestId("hud-card-stats")).toBeTruthy();
    expect(screen.getByTestId("hud-card-subs")).toBeTruthy();
  });

  it("clock display reads the latest clockDisplay or playhead minute", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
      const frame: StateFrame = {
        type: "state",
        t: 1_380_000,
        ball: { pos: [0, 0, 0] },
        players: [],
        period: 1,
      };
      store.getState().applyMessage(frame);
    });
    render(<MatchStatsHUD store={store} />);
    expect(screen.getByTestId("msb-clock").textContent).toContain("23'");
  });

  it("clock display prefers clockDisplay when provided by the producer", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
      const frame: StateFrame = {
        type: "state",
        t: 1_380_000,
        ball: { pos: [0, 0, 0] },
        players: [],
        period: 1,
        clock_display: "23:00",
      };
      store.getState().applyMessage(frame);
    });
    render(<MatchStatsHUD store={store} />);
    expect(screen.getByTestId("msb-clock").textContent).toContain("23:00");
  });

  it("subs card shows an empty-state message when there are no subs", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
    });
    render(<MatchStatsHUD store={store} />);
    expandCard("subs");
    // Empty-state copy lives inside the card body.
    expect(screen.getByTestId("msh-subs-empty")).toBeTruthy();
    // And the card shell is flagged as empty for the dimmed styling.
    expect(screen.getByTestId("hud-card-subs").dataset.empty).toBe("1");
  });
});
