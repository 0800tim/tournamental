/**
 * Phase-1 fidelity FSM tests.
 *
 * The class is engine-aware (owns an AnimationMixer) so we drive it
 * with real `three.js` primitives — but a tiny synthetic skeleton +
 * synthetic clips, no GPU. The mixer's `update(delta)` does its work
 * purely in CPU, so this is fast enough for vitest.
 *
 * Covers every transition in the state table plus some adversarial
 * cases (back-to-back kicks, goal during sprint, etc.).
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import type { AnimTag, EventMessage } from "@tournamental/spec";
import {
  AvatarAnimationStateMachine,
  STATE_TABLE,
  locomotionForSpeed,
  deriveNextState,
  eventToOneShot,
} from "../src/animation-state-machine.js";

/** Build a synthetic clip for `tag` long enough to test minDwell + maxDwell. */
function makeClip(tag: AnimTag, durationSec = 0.5): THREE.AnimationClip {
  const track = new THREE.NumberKeyframeTrack(".scale[x]", [0, durationSec], [1, 1]);
  const clip = new THREE.AnimationClip(tag, durationSec, [track]);
  return clip;
}

/** Build the full clip table; every tag gets a 0.5s synthetic clip. */
function makeClipTable(): Map<AnimTag, THREE.AnimationClip | null> {
  const out = new Map<AnimTag, THREE.AnimationClip | null>();
  for (const tag of Object.keys(STATE_TABLE) as AnimTag[]) {
    out.set(tag, makeClip(tag));
  }
  return out;
}

/** Minimal Object3D the mixer can bind to; doesn't need to be a real skeleton. */
function makeRoot(): THREE.Object3D {
  const root = new THREE.Object3D();
  root.name = "synthetic_root";
  return root;
}

/** Build an FSM with a controllable wall-clock so we can fast-forward. */
function makeFsm(initial: AnimTag = "idle") {
  let now = 0;
  const root = makeRoot();
  const fsm = new AvatarAnimationStateMachine({
    root,
    clips: makeClipTable(),
    initialState: initial,
    now: () => now,
  });
  return {
    fsm,
    advance(ms: number, speed: number) {
      now += ms;
      fsm.tick(ms / 1000, speed);
    },
    setNow(ms: number) {
      now = ms;
    },
    now: () => now,
  };
}

describe("locomotionForSpeed", () => {
  it("classifies the canonical thresholds", () => {
    expect(locomotionForSpeed(0)).toBe("idle");
    expect(locomotionForSpeed(0.29)).toBe("idle");
    expect(locomotionForSpeed(0.3)).toBe("walk");
    expect(locomotionForSpeed(1.49)).toBe("walk");
    expect(locomotionForSpeed(1.5)).toBe("run");
    expect(locomotionForSpeed(5.99)).toBe("run");
    expect(locomotionForSpeed(6.0)).toBe("sprint");
    expect(locomotionForSpeed(15)).toBe("sprint");
  });
});

describe("deriveNextState", () => {
  it("returns the locomotion classification when nothing is pending", () => {
    expect(deriveNextState("idle", "run", null, 100)).toBe("run");
    expect(deriveNextState("walk", "sprint", null, 100)).toBe("sprint");
  });

  it("immediately yields locomotion → one-shot when pending fires", () => {
    expect(deriveNextState("run", "run", "kick", 100)).toBe("kick");
  });

  it("respects minDwell on a one-shot before swapping to another one-shot", () => {
    // tackle minDwell = 80ms, kick wants to override at 50ms — too soon.
    expect(deriveNextState("tackle", "run", "kick", 50)).toBe("tackle");
    expect(deriveNextState("tackle", "run", "kick", 100)).toBe("kick");
  });

  it("ages a one-shot out via maxDwell back to locomotion", () => {
    expect(deriveNextState("celebrate", "idle", null, 1000)).toBe("celebrate");
    expect(deriveNextState("celebrate", "idle", null, 4500)).toBe("idle");
  });

  it("a sticky locomotion (dribble) stays under no pending", () => {
    expect(deriveNextState("dribble", "run", null, 1000)).toBe("run");
  });
});

describe("eventToOneShot", () => {
  const cases: Array<{ name: string; ev: EventMessage; pid: string; want: AnimTag | null }> = [
    {
      name: "passer → pass",
      ev: { type: "event.pass", t: 0, from: "P1", to: "P2", target: [0, 0] },
      pid: "P1",
      want: "pass",
    },
    {
      name: "non-passer → null",
      ev: { type: "event.pass", t: 0, from: "P1", to: "P2", target: [0, 0] },
      pid: "P2",
      want: null,
    },
    {
      name: "shooter → shoot",
      ev: { type: "event.shot", t: 0, player: "P1", target: [0, 0, 0], on_target: true },
      pid: "P1",
      want: "shoot",
    },
    {
      name: "tackler → tackle",
      ev: { type: "event.tackle", t: 0, player: "P1", victim: "P2", success: true },
      pid: "P1",
      want: "tackle",
    },
    {
      name: "victim → fall",
      ev: { type: "event.tackle", t: 0, player: "P1", victim: "P2", success: true },
      pid: "P2",
      want: "fall",
    },
    {
      name: "fouler → tackle",
      ev: { type: "event.foul", t: 0, player: "P1", victim: "P2", severity: "yellow" },
      pid: "P1",
      want: "tackle",
    },
    {
      name: "scorer → celebrate",
      ev: { type: "event.goal", t: 0, player: "P1", team: "T1" },
      pid: "P1",
      want: "celebrate",
    },
    {
      name: "non-scorer → null",
      ev: { type: "event.goal", t: 0, player: "P1", team: "T1" },
      pid: "P2",
      want: null,
    },
    {
      name: "penalty taker → shoot",
      ev: { type: "event.penalty_attempt", t: 0, player: "P1", team: "T1", outcome: "scored" },
      pid: "P1",
      want: "shoot",
    },
    {
      name: "penalty saver → catch",
      ev: { type: "event.penalty_attempt", t: 0, player: "P1", team: "T1", outcome: "saved", keeper: "GK" },
      pid: "GK",
      want: "catch",
    },
    {
      name: "save → catch",
      ev: { type: "event.save", t: 0, keeper: "GK" },
      pid: "GK",
      want: "catch",
    },
    {
      name: "score_change → null (HUD only)",
      ev: { type: "event.score_change", t: 0, home: 1, away: 0 },
      pid: "P1",
      want: null,
    },
  ];
  it.each(cases)("$name", ({ ev, pid, want }) => {
    expect(eventToOneShot(pid, ev)).toBe(want);
  });
});

describe("AvatarAnimationStateMachine", () => {
  it("initialises in idle when initialState defaults", () => {
    const { fsm } = makeFsm();
    expect(fsm.state).toBe("idle");
  });

  it("transitions idle → walk → run → sprint as speed climbs", () => {
    const ctx = makeFsm("idle");
    ctx.advance(50, 0.0);
    expect(ctx.fsm.state).toBe("idle");
    ctx.advance(50, 1.0);
    expect(ctx.fsm.state).toBe("walk");
    ctx.advance(50, 3.5);
    expect(ctx.fsm.state).toBe("run");
    ctx.advance(50, 8.0);
    expect(ctx.fsm.state).toBe("sprint");
  });

  it("transitions sprint → idle when player stops dead", () => {
    const ctx = makeFsm("sprint");
    ctx.advance(50, 0);
    expect(ctx.fsm.state).toBe("idle");
  });

  it("a kick event interrupts running locomotion immediately", () => {
    const ctx = makeFsm("run");
    ctx.advance(20, 4.0);
    ctx.fsm.consume("P1", { type: "event.shot", t: 0, player: "P1", target: [0, 0, 0], on_target: true });
    ctx.advance(20, 4.0);
    expect(ctx.fsm.state).toBe("shoot");
  });

  it("a goal during a sprint celebrates", () => {
    const ctx = makeFsm("sprint");
    ctx.advance(50, 7.0);
    ctx.fsm.consume("P1", { type: "event.goal", t: 0, player: "P1", team: "T1" });
    ctx.advance(20, 7.0);
    expect(ctx.fsm.state).toBe("celebrate");
  });

  it("celebrate ages out back to locomotion after maxDwell", () => {
    const ctx = makeFsm("idle");
    ctx.fsm.consume("P1", { type: "event.goal", t: 0, player: "P1", team: "T1" });
    ctx.advance(20, 0);
    expect(ctx.fsm.state).toBe("celebrate");
    // celebrate maxDwell = 4000ms.
    ctx.advance(4500, 1.0);
    expect(ctx.fsm.state).toBe("walk");
  });

  it("respects minDwell: a kick fires-then-tackle-too-soon stays in kick", () => {
    const ctx = makeFsm("idle");
    ctx.fsm.consume("P1", { type: "event.shot", t: 0, player: "P1", target: [0, 0, 0], on_target: true });
    ctx.advance(20, 0);
    expect(ctx.fsm.state).toBe("shoot");
    // Try to interrupt with a tackle 30ms in (shoot.minDwell = 80ms).
    ctx.fsm.consume("P1", { type: "event.tackle", t: 0, player: "P1", victim: "P2", success: true });
    ctx.advance(30, 0);
    expect(ctx.fsm.state).toBe("shoot");
    // After minDwell, the tackle wins.
    ctx.advance(80, 0);
    expect(ctx.fsm.state).toBe("tackle");
  });

  it("dispose cleans up without throwing", () => {
    const ctx = makeFsm("run");
    ctx.advance(50, 4.0);
    expect(() => ctx.fsm.dispose()).not.toThrow();
  });

  it("a victim of a foul falls", () => {
    const ctx = makeFsm("run");
    ctx.fsm.consume("P2", { type: "event.foul", t: 0, player: "P1", victim: "P2", severity: "yellow" });
    ctx.advance(20, 4.0);
    expect(ctx.fsm.state).toBe("fall");
  });

  it("a player with no event sees no one-shot", () => {
    const ctx = makeFsm("run");
    ctx.fsm.consume("P_OTHER", { type: "event.shot", t: 0, player: "P1", target: [0, 0, 0], on_target: true });
    ctx.advance(20, 4.0);
    expect(ctx.fsm.state).toBe("run");
  });

  it("STATE_TABLE has a config for every spec AnimTag", () => {
    const expected: AnimTag[] = [
      "idle", "walk", "run", "sprint",
      "kick", "pass", "header", "shoot",
      "tackle", "fall", "celebrate", "throw",
      "catch", "dribble", "jump",
    ];
    for (const tag of expected) {
      expect(STATE_TABLE[tag]).toBeDefined();
      expect(STATE_TABLE[tag].tag).toBe(tag);
    }
  });

  it("locomotion states have minDwell=0 (instant interruption)", () => {
    for (const tag of ["idle", "walk", "run", "sprint"] as AnimTag[]) {
      expect(STATE_TABLE[tag].minDwellMs).toBe(0);
      expect(STATE_TABLE[tag].kind).toBe("locomotion");
    }
  });

  it("one-shot states have positive maxDwell as a safety net", () => {
    for (const tag of ["pass", "kick", "shoot", "tackle", "celebrate"] as AnimTag[]) {
      expect(STATE_TABLE[tag].maxDwellMs).toBeGreaterThan(0);
      expect(STATE_TABLE[tag].kind).toBe("one_shot");
    }
  });

  it("transitions cleanly across all locomotion bands", () => {
    const ctx = makeFsm("idle");
    const trail: AnimTag[] = [];
    for (const speed of [0.1, 0.6, 1.2, 2.0, 3.0, 4.5, 6.0, 7.0, 5.0, 2.0, 0.1]) {
      ctx.advance(50, speed);
      trail.push(ctx.fsm.state);
    }
    expect(trail).toContain("idle");
    expect(trail).toContain("walk");
    expect(trail).toContain("run");
    expect(trail).toContain("sprint");
  });
});
