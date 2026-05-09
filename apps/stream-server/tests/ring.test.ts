/**
 * MatchRing unit tests.
 *
 * Eviction is t-based against the newest frame, not wall-clock.
 */

import { describe, it, expect } from "vitest";
import { MatchRing } from "../src/ring";
import { makeInit, makeStateFrame, makeGoalEvent } from "./helpers";

describe("MatchRing", () => {
  it("rejects non-positive windowMs", () => {
    expect(() => new MatchRing(0)).toThrow();
    expect(() => new MatchRing(-100)).toThrow();
    expect(() => new MatchRing(Number.NaN)).toThrow();
  });

  it("starts empty with no init", () => {
    const r = new MatchRing(60_000);
    expect(r.hasInit()).toBe(false);
    expect(r.size()).toBe(0);
    expect(r.getInit()).toBeUndefined();
  });

  it("caches init separately from frames", () => {
    const r = new MatchRing(60_000);
    r.push(makeInit("m1"));
    expect(r.hasInit()).toBe(true);
    expect(r.size()).toBe(0);
    expect(r.getInit()?.match_id).toBe("m1");
  });

  it("buffers frames in t-order and reports summary", () => {
    const r = new MatchRing(10_000);
    r.push(makeInit());
    r.push(makeStateFrame(100));
    r.push(makeStateFrame(200));
    r.push(makeGoalEvent(250));
    expect(r.size()).toBe(3);
    const s = r.summary();
    expect(s.has_init).toBe(true);
    expect(s.frames).toBe(3);
    expect(s.t_oldest).toBe(100);
    expect(s.t_newest).toBe(250);
    expect(s.span_ms).toBe(150);
  });

  it("evicts frames older than windowMs from the newest frame's t", () => {
    const r = new MatchRing(1_000); // 1s window
    r.push(makeInit());
    r.push(makeStateFrame(0));
    r.push(makeStateFrame(500));
    r.push(makeStateFrame(900));
    expect(r.size()).toBe(3);
    r.push(makeStateFrame(1500)); // newest=1500; cutoff=500; t<500 evicted (the t=0 frame)
    expect(r.size()).toBe(3); // 500, 900, 1500
    const frames = r.snapshotFrames();
    expect(frames[0]!.t).toBe(500);
    expect(frames.at(-1)!.t).toBe(1500);
  });

  it("evicts everything that falls below the cutoff in one push", () => {
    const r = new MatchRing(100);
    r.push(makeInit());
    for (let t = 0; t < 1000; t += 50) r.push(makeStateFrame(t));
    // At t=950, cutoff=850; frames with t<850 evicted.
    const frames = r.snapshotFrames();
    expect(frames.every((f) => f.t >= 850)).toBe(true);
  });

  it("replaces cached init when a new init arrives", () => {
    const r = new MatchRing(10_000);
    r.push(makeInit("m-old"));
    r.push(makeInit("m-new"));
    expect(r.getInit()?.match_id).toBe("m-new");
  });

  it("ageMs reports Infinity before first push", () => {
    const r = new MatchRing(1000);
    expect(r.ageMs()).toBe(Number.POSITIVE_INFINITY);
  });

  it("ageMs reports a small finite number right after a push", () => {
    const r = new MatchRing(1000);
    r.push(makeStateFrame(0));
    expect(r.ageMs()).toBeLessThan(1000);
    expect(r.ageMs()).toBeGreaterThanOrEqual(0);
  });
});
