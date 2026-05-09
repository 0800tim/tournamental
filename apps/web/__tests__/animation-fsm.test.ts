import { describe, expect, it } from "vitest";
import {
  activeTag,
  eventOneShotFor,
  INITIAL_FSM_STATE,
  locomotionFor,
  ONE_SHOT_MS,
  stepFsm,
} from "@/lib/animation-fsm";
import type { EventMessage } from "@vtorn/spec";

describe("locomotionFor", () => {
  it("classifies by speed", () => {
    expect(locomotionFor(0)).toBe("idle");
    expect(locomotionFor(0.49)).toBe("idle");
    expect(locomotionFor(0.5)).toBe("walk");
    expect(locomotionFor(2.49)).toBe("walk");
    expect(locomotionFor(2.5)).toBe("run");
    expect(locomotionFor(4.99)).toBe("run");
    expect(locomotionFor(5)).toBe("sprint");
    expect(locomotionFor(20)).toBe("sprint");
  });
});

describe("eventOneShotFor", () => {
  it("triggers pass for the passer only", () => {
    const ev: EventMessage = { type: "event.pass", t: 0, from: "P1", to: "P2", target: [0, 0] };
    expect(eventOneShotFor("P1", ev, 1000)?.tag).toBe("pass");
    expect(eventOneShotFor("P2", ev, 1000)).toBeNull();
  });

  it("triggers shoot on shot for the shooter", () => {
    const ev: EventMessage = { type: "event.shot", t: 0, player: "P1", target: [0, 0, 0], on_target: true };
    expect(eventOneShotFor("P1", ev, 0)?.tag).toBe("shoot");
  });

  it("triggers tackle for tackler and fall for victim", () => {
    const ev: EventMessage = { type: "event.tackle", t: 0, player: "P1", victim: "P2", success: true };
    expect(eventOneShotFor("P1", ev, 0)?.tag).toBe("tackle");
    expect(eventOneShotFor("P2", ev, 0)?.tag).toBe("fall");
  });

  it("triggers celebrate on goal for the scorer", () => {
    const ev: EventMessage = { type: "event.goal", t: 0, player: "P1", team: "T1" };
    expect(eventOneShotFor("P1", ev, 0)?.tag).toBe("celebrate");
    expect(eventOneShotFor("Pother", ev, 0)).toBeNull();
  });

  it("triggers shoot on penalty_attempt for the shooter", () => {
    const ev: EventMessage = {
      type: "event.penalty_attempt",
      t: 0,
      player: "P1",
      team: "T1",
      outcome: "scored",
    };
    expect(eventOneShotFor("P1", ev, 0)?.tag).toBe("shoot");
  });

  it("returns null for unrelated event types", () => {
    const ev: EventMessage = { type: "event.score_change", t: 0, home: 1, away: 0 };
    expect(eventOneShotFor("P1", ev, 0)).toBeNull();
  });
});

describe("stepFsm", () => {
  it("updates locomotion from speed", () => {
    const out = stepFsm(INITIAL_FSM_STATE, 6, [], "P1", 0);
    expect(out.locomotion).toBe("sprint");
  });

  it("applies a one-shot from a relevant event", () => {
    const ev: EventMessage = { type: "event.shot", t: 0, player: "P1", target: [0, 0, 0], on_target: true };
    const out = stepFsm(INITIAL_FSM_STATE, 0, [ev], "P1", 1000);
    expect(out.oneShot?.tag).toBe("shoot");
    expect(activeTag(out, 1100)).toBe("shoot");
  });

  it("expires a one-shot after its duration", () => {
    const state = {
      locomotion: "idle" as const,
      oneShot: { tag: "pass" as const, startedAt: 0, durationMs: 400 },
    };
    expect(activeTag(state, 100)).toBe("pass");
    expect(activeTag(state, 500)).toBe("idle");
  });

  it("a later event overrides an earlier one in the same step", () => {
    const shot: EventMessage = { type: "event.shot", t: 0, player: "P1", target: [0, 0, 0], on_target: true };
    const goal: EventMessage = { type: "event.goal", t: 1, player: "P1", team: "T1" };
    const out = stepFsm(INITIAL_FSM_STATE, 0, [shot, goal], "P1", 0);
    expect(out.oneShot?.tag).toBe("celebrate");
  });

  it("ONE_SHOT_MS lookup table covers the standard tags", () => {
    expect(ONE_SHOT_MS.pass).toBeGreaterThan(0);
    expect(ONE_SHOT_MS.shoot).toBeGreaterThan(0);
    expect(ONE_SHOT_MS.tackle).toBeGreaterThan(0);
    expect(ONE_SHOT_MS.celebrate).toBeGreaterThan(0);
  });
});
