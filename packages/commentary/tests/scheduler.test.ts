import { describe, it, expect, beforeEach } from "vitest";
import { CommentaryScheduler } from "../src/scheduler";
import type { CommentaryLine } from "../src/templates";

function line(id: string, channel: CommentaryLine["channel"], duration = 2000): CommentaryLine {
  return { id, text: `line ${id}`, offset_ms: 0, duration_ms: duration, intent: "neutral", channel };
}

describe("CommentaryScheduler", () => {
  let s: CommentaryScheduler;
  beforeEach(() => { s = new CommentaryScheduler({ channelCooldownMs: 500, backlogDropMs: 2000 }); });

  it("fires due lines and updates next-free per channel", () => {
    s.add([line("a", "play-by-play")], 1000);
    s.add([line("b", "structural")], 1100);

    expect(s.tick(900)).toEqual([]);                 // not yet
    const fired = s.tick(1100);
    expect(fired.map(l => l.id).sort()).toEqual(["a", "b"]);
    expect(s.pending()).toBe(0);
  });

  it("queues an overlapping line on the same channel and replays it later", () => {
    s.add([line("a", "play-by-play", 2000)], 1000);
    s.add([line("b", "play-by-play", 2000)], 1500);   // overlaps a

    s.tick(1000); // a fires
    const out = s.tick(1500);
    // a runs until 3000, then 500ms cooldown -> b can't fire until 3500
    expect(out.find(l => l.id === "b")).toBeUndefined();
    expect(s.pending()).toBe(1);

    const out2 = s.tick(3500);
    expect(out2.find(l => l.id === "b")).toBeDefined();
  });

  it("drops a line that has aged outside the backlog window", () => {
    s.add([line("a", "play-by-play", 2000)], 1000);
    s.add([line("b", "play-by-play", 2000)], 1100);   // would queue, ages out

    s.tick(1000); // a fires, channel busy until 3500
    s.tick(2000); // b doesn't fire; check backlog -> 3500 - 1100 = 2400 > 2000 -> drop
    expect(s.pending()).toBe(0);
  });

  it("dedup: same line id added twice yields one fire", () => {
    s.add([line("once", "structural")], 500);
    s.add([line("once", "structural")], 500);
    expect(s.pending()).toBe(1);
  });

  it("reset() clears queue and channel state", () => {
    s.add([line("a", "play-by-play")], 1000);
    s.tick(1000);
    s.reset();
    s.add([line("a2", "play-by-play")], 0);
    expect(s.tick(0).map(l => l.id)).toEqual(["a2"]);
  });
});
