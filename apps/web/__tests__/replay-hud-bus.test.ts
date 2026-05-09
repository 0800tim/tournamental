/**
 * Phase-4 ReplayHUD bus + helpers — pure-logic tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  replayBadgeVisible,
  replayHudBus,
  scorerOpacity,
  slowMoLabel,
  type ReplayHudState,
} from "@/lib/director/replay-hud-bus";

beforeEach(() => {
  replayHudBus.reset();
});

describe("replayHudBus", () => {
  it("starts with broadcast cam and rate=1", () => {
    const c = replayHudBus.current();
    expect(c.cam).toBe("broadcast");
    expect(c.slowMoRate).toBe(1);
  });

  it("publish merges partial state with previous", () => {
    replayHudBus.publish({ cam: "goal-replay", slowMoRate: 0.25 });
    const c1 = replayHudBus.current();
    expect(c1.cam).toBe("goal-replay");
    expect(c1.slowMoRate).toBe(0.25);
    expect(c1.scoreHome).toBe(0);

    replayHudBus.publish({ scoreHome: 1 });
    const c2 = replayHudBus.current();
    expect(c2.cam).toBe("goal-replay");
    expect(c2.scoreHome).toBe(1);
  });

  it("subscribe fires immediately with current state", () => {
    replayHudBus.publish({ cam: "goal-replay" });
    let received: ReplayHudState | null = null;
    const unsub = replayHudBus.subscribe((s) => {
      received = s;
    });
    expect(received).not.toBeNull();
    expect(received!.cam).toBe("goal-replay");
    unsub();
  });

  it("subscribe fires on each subsequent publish", () => {
    const calls: ReplayHudState[] = [];
    const unsub = replayHudBus.subscribe((s) => calls.push(s));
    replayHudBus.publish({ scoreHome: 1 });
    replayHudBus.publish({ scoreHome: 2 });
    expect(calls.length).toBe(3);
    expect(calls[2].scoreHome).toBe(2);
    unsub();
  });

  it("unsubscribe stops further notifications", () => {
    const calls: ReplayHudState[] = [];
    const unsub = replayHudBus.subscribe((s) => calls.push(s));
    unsub();
    replayHudBus.publish({ scoreHome: 99 });
    expect(calls.length).toBe(1);
  });
});

describe("replayBadgeVisible", () => {
  it("returns true for goal-replay and player-track cams", () => {
    expect(replayBadgeVisible({ ...replayHudBus.current(), cam: "goal-replay" })).toBe(true);
    expect(replayBadgeVisible({ ...replayHudBus.current(), cam: "player-track" })).toBe(true);
  });

  it("returns false for broadcast / behind-goal", () => {
    expect(replayBadgeVisible({ ...replayHudBus.current(), cam: "broadcast" })).toBe(false);
    expect(replayBadgeVisible({ ...replayHudBus.current(), cam: "behind-goal" })).toBe(false);
  });
});

describe("scorerOpacity", () => {
  it("returns 0 when not in replay", () => {
    const s = { ...replayHudBus.current(), cam: "broadcast" as const };
    expect(scorerOpacity(s)).toBe(0);
  });

  it("ramps from 0 to 1 over 0.4 s", () => {
    const base = { ...replayHudBus.current(), cam: "goal-replay" as const };
    expect(scorerOpacity({ ...base, secsSinceCut: 0 })).toBe(0);
    expect(scorerOpacity({ ...base, secsSinceCut: 0.2 })).toBeCloseTo(0.5, 2);
    expect(scorerOpacity({ ...base, secsSinceCut: 0.4 })).toBe(1);
    expect(scorerOpacity({ ...base, secsSinceCut: 5 })).toBe(1);
  });
});

describe("slowMoLabel", () => {
  it("returns null for normal rate", () => {
    expect(slowMoLabel(1)).toBeNull();
    expect(slowMoLabel(1.0001)).toBeNull();
  });

  it("formats 0.25 as 0.25×", () => {
    expect(slowMoLabel(0.25)).toBe("0.25×");
  });

  it("strips trailing zeros (0.5 → 0.5×)", () => {
    expect(slowMoLabel(0.5)).toBe("0.5×");
  });

  it("formats 0.1 correctly", () => {
    expect(slowMoLabel(0.1)).toBe("0.1×");
  });
});
