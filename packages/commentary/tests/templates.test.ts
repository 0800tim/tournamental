import { describe, it, expect } from "vitest";
import { generateCommentary, type CommentaryContext } from "../src/templates";
import type { EventMessage } from "@vtorn/spec";

function makeCtx(overrides: Partial<CommentaryContext> = {}): CommentaryContext {
  const players = new Map();
  players.set("P_MESSI", { id: "P_MESSI", name: "Lionel Andrés Messi Cuccittini", number: 10, position: "ST", team_id: "ARG" });
  players.set("P_MBAPPE", { id: "P_MBAPPE", name: "Kylian Mbappé Lottin", number: 10, position: "ST", team_id: "FRA" });
  const teams = new Map();
  teams.set("ARG", { id: "ARG", name: "Argentina", short_name: "ARG", players: [], kit: { primary: "#75AADB", secondary: "#FFFFFF", text: "#000" } });
  teams.set("FRA", { id: "FRA", name: "France", short_name: "FRA", players: [], kit: { primary: "#0055A4", secondary: "#FFFFFF", text: "#000" } });
  return {
    players,
    teams,
    score: { ARG: 0, FRA: 0 },
    minute: 23,
    enthusiastic: true,
    ...overrides,
  };
}

describe("generateCommentary", () => {
  it("emits a celebratory line for event.goal with last-name", () => {
    const ev = {
      type: "event.goal",
      t: 1380000,
      player: "P_MESSI",
      team: "ARG",
    } as EventMessage;
    const lines = generateCommentary(ev, makeCtx());
    const goal = lines.find((l) => l.intent === "celebration");
    expect(goal).toBeDefined();
    expect(goal!.text).toMatch(/Messi/);
    expect(goal!.text).toMatch(/Argentina/);
  });

  it("emits a structural line for period_start", () => {
    const ev = { type: "event.period_start", t: 0, period: 1 } as EventMessage;
    const lines = generateCommentary(ev, makeCtx({ minute: 0 }));
    expect(lines).toHaveLength(1);
    expect(lines[0].channel).toBe("structural");
    expect(lines[0].text).toMatch(/first half/i);
  });

  it("is deterministic for the same event id", () => {
    const ev = {
      type: "event.shot",
      t: 600000,
      player: "P_MBAPPE",
      team: "FRA",
      target: [0, 0, 1],
      on_target: true,
    } as EventMessage;
    const a = generateCommentary(ev, makeCtx());
    const b = generateCommentary(ev, makeCtx());
    expect(a[0].text).toBe(b[0].text);
  });

  it("returns no lines for routine events (event.pass)", () => {
    const ev = { type: "event.pass", t: 1000, player: "P_MESSI", team: "ARG", target: [0,0,0] } as EventMessage;
    const lines = generateCommentary(ev, makeCtx());
    expect(lines).toEqual([]);
  });

  it("describes the penalty shootout start", () => {
    const ev = { type: "event.penalty_shootout_start", t: 7200000 } as EventMessage;
    const lines = generateCommentary(ev, makeCtx({ minute: 120 }));
    expect(lines[0].text).toMatch(/penalties/i);
  });

  it("calls the shootout winner by team name", () => {
    const ev = {
      type: "event.penalty_shootout_end",
      t: 7600000,
      winner: "ARG",
      score: { home: 4, away: 2 },
    } as EventMessage;
    const lines = generateCommentary(ev, makeCtx({ minute: 120 }));
    expect(lines[0].text).toMatch(/Argentina win/);
  });
});
