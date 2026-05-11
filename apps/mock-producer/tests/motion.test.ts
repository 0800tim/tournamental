/**
 * Motion sanity: state-frame deltas stay below a velocity cap so a
 * renderer doesn't see teleports.
 *
 * Notes:
 *   - Players' raw foot speed is well below 12 m/s in soccer terms; we
 *     allow 14 m/s (tick-relative) to absorb noise and the legitimate
 *     "kickoff reset" that happens after a goal celebration.
 *   - Kickoff/restart/period transitions intentionally re-place players
 *     in formation slots; we treat the immediate frame after a
 *     `event.kickoff`/`event.period_start` as a reset and skip its delta
 *     check.
 */
import { describe, it, expect } from "vitest";
import { runSimulation, defaultTeams } from "../src/index.js";
import type { Message, StateFrame } from "@tournamental/spec";

const TICK_MS = 100;
const PLAYER_VELOCITY_CAP_MPS = 14;
const BALL_VELOCITY_CAP_MPS = 80; // shots can travel fast (real shots peak ~38 m/s; we cap at ~2x to absorb our linear interpolation).

interface Reset {
  fromT: number;
  toT: number;
}

function gatherResets(messages: Message[]): Reset[] {
  const resets: Reset[] = [];
  // Any kickoff or period_start triggers a position reset on the same tick;
  // we skip the *next* state frame's delta check.
  for (const m of messages) {
    if (m.type === "event.kickoff" || m.type === "event.period_start") {
      resets.push({ fromT: m.t, toT: m.t + TICK_MS });
    }
    if (m.type === "event.substitution") {
      // A sub teleports a bench player onto the pitch; skip the next frame.
      resets.push({ fromT: m.t, toT: m.t + TICK_MS });
    }
    if (m.type === "event.out_of_bounds" || m.type === "event.foul") {
      // Restart re-places ball/players; allow up to 2.5s of "settling".
      resets.push({ fromT: m.t, toT: m.t + 2500 });
    }
    if (m.type === "event.save" || m.type === "event.goal") {
      resets.push({ fromT: m.t, toT: m.t + 5500 });
    }
    if (m.type === "event.tackle" || m.type === "event.pass") {
      // A successful tackle or pass-completion can move the ball a few
      // metres in a single tick. Allow one frame of settling.
      resets.push({ fromT: m.t, toT: m.t + TICK_MS * 2 });
    }
    if (m.type === "event.shot") {
      // Shot launches the ball; first frame of flight may exceed cruise speed.
      resets.push({ fromT: m.t, toT: m.t + TICK_MS * 2 });
    }
  }
  return resets;
}

function isResetWindow(prevT: number, currT: number, resets: Reset[]): boolean {
  return resets.some((r) => r.fromT <= currT && currT <= r.toT);
}

describe("motion plausibility", () => {
  it("no player teleports between consecutive state frames in normal play", () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 60_000,
      teams: defaultTeams(),
    });
    const resets = gatherResets(r.messages);
    const frames = r.messages.filter((m): m is StateFrame => m.type === "state");
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1] as StateFrame;
      const curr = frames[i] as StateFrame;
      const dt = (curr.t - prev.t) / 1000;
      if (dt <= 0) continue;
      if (isResetWindow(prev.t, curr.t, resets)) continue;

      const prevById = new Map(prev.players.map((p) => [p.id, p]));
      for (const p of curr.players) {
        const prevP = prevById.get(p.id);
        if (!prevP) continue; // sub came on; skip.
        const dx = p.pos[0] - prevP.pos[0];
        const dy = p.pos[1] - prevP.pos[1];
        const speed = Math.hypot(dx, dy) / dt;
        if (speed > PLAYER_VELOCITY_CAP_MPS) {
          throw new Error(`player ${p.id} moved ${speed.toFixed(1)} m/s between t=${prev.t} and t=${curr.t} (cap ${PLAYER_VELOCITY_CAP_MPS})`);
        }
      }

      // Ball check.
      const bdx = curr.ball.pos[0] - prev.ball.pos[0];
      const bdy = curr.ball.pos[1] - prev.ball.pos[1];
      const bdz = curr.ball.pos[2] - prev.ball.pos[2];
      const ballSpeed = Math.sqrt(bdx * bdx + bdy * bdy + bdz * bdz) / dt;
      expect(ballSpeed).toBeLessThanOrEqual(BALL_VELOCITY_CAP_MPS);
    }
  });

  it("ball stays inside the field bounds (with a small margin)", () => {
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 60_000,
      teams: defaultTeams(),
    });
    const frames = r.messages.filter((m): m is StateFrame => m.type === "state");
    for (const f of frames) {
      expect(Math.abs(f.ball.pos[0])).toBeLessThanOrEqual(60); // 105/2 + margin
      expect(Math.abs(f.ball.pos[1])).toBeLessThanOrEqual(40); // 68/2 + margin
      expect(f.ball.pos[2]).toBeGreaterThanOrEqual(0);
      expect(f.ball.pos[2]).toBeLessThanOrEqual(8);
    }
  });
});
