/**
 * Director-policy unit tests.
 *
 * Per `docs/27b-fidelity-phase2-physics-director.md`:
 *
 *   `director-policy.test.ts`: replay event log, assert correct cut
 *   sequence.
 *
 * Drive the policy with a synthetic event log + a mock clock; assert
 * the camera transitions hit the spec table.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import type { EventMessage } from "@tournamental/spec";
import {
  DirectorPolicy,
  simulateDirectorTimeline,
} from "../director-policy.js";
import { CutBlender, easeInOutCosine } from "../cut-blender.js";
import { ReplayBuffer } from "../replay-buffer.js";

function fakeNow(initial = 0): { now: () => number; advance: (ms: number) => void } {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("DirectorPolicy", () => {
  it("starts in live-broadcast", () => {
    const dir = new DirectorPolicy();
    expect(dir.activeCam()).toBe("broadcast");
    expect(dir.getPhase().kind).toBe("live");
  });

  it("cuts to goal-replay then player-track then broadcast on a goal", () => {
    const clock = fakeNow();
    const dir = new DirectorPolicy({
      now: clock.now,
      replaySec: 4,
      celebrationSec: 5,
    });

    dir.consume({
      type: "event.goal",
      player: "messi",
      team: "arg",
      t: 1380000,
    });
    expect(dir.activeCam()).toBe("goal-replay");

    // 4 s in: still on replay until tick at the right time
    clock.advance(3999);
    expect(dir.tick()).toBe("goal-replay");

    clock.advance(2);
    expect(dir.tick()).toBe("player-track");

    // Celebration runs for 5 s
    clock.advance(4999);
    expect(dir.tick()).toBe("player-track");

    clock.advance(2);
    expect(["broadcast", "player-track"]).toContain(dir.tick()); // easing-back
    clock.advance(1100);
    expect(dir.tick()).toBe("broadcast");
  });

  it("tracks the scorer through the celebration", () => {
    const clock = fakeNow();
    const dir = new DirectorPolicy({ now: clock.now, replaySec: 1, celebrationSec: 1 });
    dir.consume({ type: "event.goal", player: "mbappe", team: "fra", t: 7080000 });
    expect(dir.scorerId()).toBe("mbappe");
    clock.advance(1100);
    dir.tick(); // → celebration step
    expect(dir.scorerId()).toBe("mbappe");
  });

  it("ignores nested goal events while a goal sequence is active", () => {
    const clock = fakeNow();
    const dir = new DirectorPolicy({ now: clock.now, replaySec: 5 });
    dir.consume({ type: "event.goal", player: "messi", team: "arg", t: 1 });
    dir.consume({ type: "event.goal", player: "messi", team: "arg", t: 2 });
    expect(dir.scorerId()).toBe("messi"); // unchanged
  });

  it("cuts to behind-goal on a penalty attempt", () => {
    const clock = fakeNow();
    const dir = new DirectorPolicy({ now: clock.now });
    dir.consume({
      type: "event.penalty_attempt",
      player: "messi",
      team: "arg",
      outcome: "scored",
      t: 1380000,
    });
    expect(dir.activeCam()).toBe("behind-goal");
  });

  it("does NOT cut on a save / shot / substitution", () => {
    const dir = new DirectorPolicy();
    dir.consume({ type: "event.save", keeper: "lloris", t: 0 });
    expect(dir.activeCam()).toBe("broadcast");
    dir.consume({
      type: "event.shot",
      player: "mbappe",
      target: [0, 0, 1.5],
      on_target: true,
      saved: true,
      t: 0,
    });
    expect(dir.activeCam()).toBe("broadcast");
    dir.consume({
      type: "event.substitution",
      team: "fra",
      player_in: "thuram",
      player_out: "giroud",
      t: 0,
    });
    expect(dir.activeCam()).toBe("broadcast");
  });

  it("fires onReplayWindowStart / End observers around a goal", () => {
    const clock = fakeNow();
    const starts: string[] = [];
    let ended = false;
    const dir = new DirectorPolicy(
      { now: clock.now, replaySec: 0.1, celebrationSec: 0.1 },
      {
        onReplayWindowStart: (id) => starts.push(id),
        onReplayWindowEnd: () => {
          ended = true;
        },
      },
    );

    dir.consume({ type: "event.goal", player: "messi", team: "arg", t: 0 });
    expect(starts).toEqual(["messi"]);

    clock.advance(150);
    dir.tick();
    expect(ended).toBe(true);
  });

  it("simulateDirectorTimeline replays the spec table", () => {
    const events: EventMessage[] = [
      { type: "event.goal", player: "messi", team: "arg", t: 0 },
    ];
    const ticks = [0, 1000, 2000, 3000, 4500, 8000, 9500, 11000];
    const seq = simulateDirectorTimeline(events, ticks, {
      replaySec: 4,
      celebrationSec: 5,
    });
    // tick @ 0, goal just consumed → replay
    expect(seq[0]).toBe("goal-replay");
    // ticks @ 1-3s, still in replay
    expect(seq[1]).toBe("goal-replay");
    expect(seq[2]).toBe("goal-replay");
    expect(seq[3]).toBe("goal-replay");
    // tick @ 4.5s, celebration
    expect(seq[4]).toBe("player-track");
    // tick @ 8s, still celebration
    expect(seq[5]).toBe("player-track");
    // tick @ 9.5s, easing-back (player-track holds for 1s easing)
    expect(["player-track", "broadcast"]).toContain(seq[6]);
    // tick @ 11s, back to broadcast
    expect(seq[7]).toBe("broadcast");
  });

  it("slowMoRate is 0.25 during replay step, 1 otherwise", () => {
    const clock = fakeNow();
    const dir = new DirectorPolicy({ now: clock.now });
    expect(dir.slowMoRate()).toBe(1);
    dir.consume({ type: "event.goal", player: "messi", team: "arg", t: 0 });
    expect(dir.slowMoRate()).toBe(0.25);
  });
});

describe("CutBlender", () => {
  it("eases position + lookAt cosine over 300 ms", () => {
    const clock = fakeNow();
    const blender = new CutBlender({ now: clock.now, blendSec: 0.3 });

    blender.setTarget({
      name: "broadcast",
      position: new THREE.Vector3(0, 25, 60),
      lookAt: new THREE.Vector3(0, 0, 0),
      fov: 50,
    });
    const out = {
      position: new THREE.Vector3(),
      lookAt: new THREE.Vector3(),
      fov: 0,
      name: "broadcast" as const,
    };
    blender.evaluate(out);

    // Cut to behind-goal.
    blender.setTarget({
      name: "behind-goal",
      position: new THREE.Vector3(60, 8, 0),
      lookAt: new THREE.Vector3(0, 0, 0),
      fov: 35,
    });
    blender.evaluate(out);
    // At t=0 of blend → should still be at broadcast.
    expect(out.position.distanceTo(new THREE.Vector3(0, 25, 60))).toBeLessThan(1);

    clock.advance(150);
    blender.evaluate(out);
    // Mid-blend → halfway there.
    expect(out.position.distanceTo(new THREE.Vector3(0, 25, 60))).toBeGreaterThan(5);
    expect(out.position.distanceTo(new THREE.Vector3(60, 8, 0))).toBeGreaterThan(5);

    clock.advance(151);
    blender.evaluate(out);
    // After the blend → at the target.
    expect(out.position.distanceTo(new THREE.Vector3(60, 8, 0))).toBeLessThan(1);
  });

  it("goal-replay cuts are instant (no blend)", () => {
    const clock = fakeNow();
    const blender = new CutBlender({ now: clock.now, blendSec: 0.3 });
    blender.setTarget({
      name: "broadcast",
      position: new THREE.Vector3(0, 25, 60),
      lookAt: new THREE.Vector3(0, 0, 0),
      fov: 50,
    });

    blender.setTarget({
      name: "goal-replay",
      position: new THREE.Vector3(60, 3, 5),
      lookAt: new THREE.Vector3(0, 0, 0),
      fov: 38,
    });
    const out = {
      position: new THREE.Vector3(),
      lookAt: new THREE.Vector3(),
      fov: 0,
      name: "broadcast" as const,
    };
    blender.evaluate(out);
    // Instant cut, should be at the target on the very next eval.
    expect(out.position.distanceTo(new THREE.Vector3(60, 3, 5))).toBeLessThan(0.5);
  });

  it("easeInOutCosine is monotonically increasing on [0,1]", () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOutCosine(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeInOutCosine(0)).toBeCloseTo(0, 5);
    expect(easeInOutCosine(1)).toBeCloseTo(1, 5);
  });
});

describe("ReplayBuffer", () => {
  it("stores up to capacity then overwrites oldest", () => {
    const buf = new ReplayBuffer({ durationSec: 0.05, rateHz: 60 });
    expect(buf.capacity).toBe(3);

    buf.push({ t: 1, ball: [0, 0, 0], players: [] });
    buf.push({ t: 2, ball: [0, 0, 0], players: [] });
    buf.push({ t: 3, ball: [0, 0, 0], players: [] });
    buf.push({ t: 4, ball: [0, 0, 0], players: [] });

    const all = buf.readAll();
    expect(all.map((s) => s.t)).toEqual([2, 3, 4]);
  });

  it("read(window) drops snapshots outside the window", () => {
    const buf = new ReplayBuffer({ durationSec: 1, rateHz: 60 });
    for (let i = 0; i < 60; i++) {
      buf.push({ t: i * 16, ball: [0, 0, 0], players: [] });
    }
    const lastHalf = buf.read(0.5, 60 * 16);
    // Only ~30 frames should fall inside the last 0.5 s.
    expect(lastHalf.length).toBeGreaterThan(20);
    expect(lastHalf.length).toBeLessThan(40);
  });

  it("clear() resets to empty", () => {
    const buf = new ReplayBuffer({ durationSec: 1, rateHz: 60 });
    buf.push({ t: 1, ball: [0, 0, 0], players: [] });
    buf.clear();
    expect(buf.length).toBe(0);
  });

  it("budget: 22 players × 600 frames < 1 MB", () => {
    const buf = new ReplayBuffer({ durationSec: 10, rateHz: 60 });
    for (let i = 0; i < 600; i++) {
      buf.push({
        t: i * 16,
        ball: [0, 0, 0],
        players: Array.from({ length: 22 }, (_, k) => ({
          id: `p${k}`,
          pos: [0, 0],
          facing: 0,
        })),
      });
    }
    expect(buf.estimatedBytes()).toBeLessThan(1_000_000);
  });
});
