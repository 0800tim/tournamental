/**
 * MatchStatsHUD component tests (jsdom).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMatchStore } from "@vtorn/spec-client";
import type { EventMessage, MatchInit, StateFrame } from "@vtorn/spec";
import { SPEC_VERSION } from "@vtorn/spec";
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

beforeEach(() => {
  cleanup();
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

  it("renders the team names + 0-0 score after init", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
    });
    render(<MatchStatsHUD store={store} />);
    expect(screen.getByTestId("msh-home-name").textContent).toBe("ARG");
    expect(screen.getByTestId("msh-away-name").textContent).toBe("FRA");
    expect(screen.getByTestId("msh-home-score").textContent).toBe("0");
    expect(screen.getByTestId("msh-away-score").textContent).toBe("0");
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
    expect(screen.getByTestId("msh-home-score").textContent).toBe("1");
    expect(screen.getByTestId("msh-away-score").textContent).toBe("0");
  });

  it("scorers ticker lists goals in chronological order", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
      // Set the playhead via a state frame
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
    const rows = screen.getAllByTestId("msh-scorer-row");
    expect(rows[0].dataset.side).toBe("home");
    expect(rows[1].dataset.side).toBe("away");
  });

  it("shots / fouls / cards / saves render in the stats panel", () => {
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
    expect(screen.getByTestId("msh-stat-shots").textContent).toContain("1");
    expect(screen.getByTestId("msh-stat-yellows").textContent).toContain("1");
    expect(screen.getByTestId("msh-stat-reds").textContent).toContain("1");
    expect(screen.getByTestId("msh-stat-saves").textContent).toContain("1");
  });

  it("renders mobile-tab toggles", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
    });
    render(<MatchStatsHUD store={store} />);
    const tabs = screen.getByTestId("msh-mobile-tabs");
    expect(tabs.children).toHaveLength(4);
    expect(tabs.dataset.active).toBe("score");
  });

  it("clicking a mobile tab updates the active state", async () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
    });
    render(<MatchStatsHUD store={store} />);
    const tabs = screen.getByTestId("msh-mobile-tabs");
    const buttons = tabs.querySelectorAll("button");
    act(() => {
      (buttons[1] as HTMLButtonElement).click();
    });
    expect(tabs.dataset.active).toBe("stats");
  });

  it("clock display reads the latest clockDisplay or playhead minute", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
      // No clockDisplay, but a state frame at 23:00
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
    expect(screen.getByTestId("msh-clock").textContent).toBe("23'");
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
    expect(screen.getByTestId("msh-clock").textContent).toBe("23:00");
  });

  it("subs ticker is empty by default", () => {
    const store = createMatchStore();
    act(() => {
      store.getState().applyMessage(init);
    });
    render(<MatchStatsHUD store={store} />);
    expect(screen.getByTestId("msh-subs").dataset.empty).toBe("1");
  });
});
