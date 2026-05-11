import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildArFrMessages,
  createMatchStore,
  manifestSourceFromText,
} from "@vtorn/spec-client";
import type { Message, StateFrame } from "@vtorn/spec";

/**
 * Driver-side regression tests covering the two Phase-4 bugs Tim hit
 * watching the AR-FR replay on his phone:
 *
 *   1. The HUD clock alternated between 0 and the real elapsed time
 *      every other tick. Root cause: the driver emitted the bracketing
 *      buffer-frame's `t` on one tick and `controller.time` on the
 *      next. Fix: every emitted state frame now uses `controller.time`
 *      as its `t`.
 *
 *   2. The scoreline never updated. Root cause: the driver subscribed
 *      to its own seek listener and reset the event cursor on every
 *      internal advance, which silently dropped events that fell
 *      between two ticks (e.g. `event.score_change`). Fix: the
 *      controller now distinguishes user seeks from natural advances
 *      via a separate `subscribeSeek` channel; the driver only resets
 *      its cursor on user seeks.
 */

const toNdjson = (messages: Message[]): string =>
  messages.map((m) => JSON.stringify(m)).join("\n");

const ARFR_NDJSON = toNdjson(buildArFrMessages());

describe("manifest driver — clock monotonicity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never emits a state-frame whose t goes backwards across N driver ticks", () => {
    const store = createMatchStore();
    const emitted: number[] = [];

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: true,
      rate: 60, // crank the rate so we cover a lot of timeline in few ticks
    });

    source.start(
      (m) => {
        store.getState().applyMessage(m);
        if (m.type === "state") emitted.push((m as StateFrame).t);
      },
      () => undefined,
    );

    // 60 ticks at 33ms = ~2s wall clock × 60× rate = ~120s match time
    for (let i = 0; i < 60; i += 1) vi.advanceTimersByTime(33);

    expect(emitted.length).toBeGreaterThan(50);
    for (let i = 1; i < emitted.length; i += 1) {
      expect(emitted[i]).toBeGreaterThanOrEqual(emitted[i - 1]);
    }
    source.stop();
  });

  it("emitted frame.t exactly tracks the controller playhead (no oscillation)", () => {
    const store = createMatchStore();
    let lastT = -1;
    const emitted: number[] = [];

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: true,
      rate: 30,
    });

    source.start(
      (m) => {
        store.getState().applyMessage(m);
        if (m.type === "state") {
          emitted.push((m as StateFrame).t);
          lastT = (m as StateFrame).t;
        }
      },
      () => undefined,
    );

    for (let i = 0; i < 30; i += 1) vi.advanceTimersByTime(33);

    // No two adjacent emitted t values should oscillate (i.e. drop
    // and then rise again in the same window). We assert that the
    // sequence of differences is non-negative.
    const deltas: number[] = [];
    for (let i = 1; i < emitted.length; i += 1) {
      deltas.push(emitted[i] - emitted[i - 1]);
    }
    for (const d of deltas) {
      expect(d).toBeGreaterThanOrEqual(0);
    }
    expect(lastT).toBeGreaterThan(0);
    source.stop();
  });

  it("clock keeps ticking past the last buffered state frame", () => {
    // Constrain the buffer so the last state frame is well before the
    // last event — the driver should still keep emitting frames whose
    // t advances toward durationMs even after we've passed the last
    // buffered frame's timestamp.
    const truncated: Message[] = [
      {
        type: "match.init",
        spec_version: "0.1.1",
        match_id: "test",
        sport: "soccer",
        field: { length: 100, width: 64, units: "m" },
        teams: [
          { id: "A", name: "A", kit: { primary: "#fff", secondary: "#000" }, players: [] },
          { id: "B", name: "B", kit: { primary: "#000", secondary: "#fff" }, players: [] },
        ],
        start_time: "2024-01-01T00:00:00Z",
      },
      { type: "state", t: 0, ball: { pos: [0, 0, 0] }, players: [] },
      { type: "state", t: 1000, ball: { pos: [1, 0, 0] }, players: [] },
      // Then a long tail of just an end event at much later t
      { type: "event.match_end", t: 60_000 },
    ];
    const store = createMatchStore();
    const emitted: number[] = [];
    const source = manifestSourceFromText(toNdjson(truncated), {
      autoplay: true,
      rate: 30,
    });

    source.start(
      (m) => {
        store.getState().applyMessage(m);
        if (m.type === "state") emitted.push((m as StateFrame).t);
      },
      () => undefined,
    );

    for (let i = 0; i < 90; i += 1) vi.advanceTimersByTime(33);

    // We should see frames advancing past 1000 (the last buffered frame's t)
    const advancedPastLastFrame = emitted.filter((t) => t > 1000);
    expect(advancedPastLastFrame.length).toBeGreaterThan(5);
    // And monotonic
    for (let i = 1; i < emitted.length; i += 1) {
      expect(emitted[i]).toBeGreaterThanOrEqual(emitted[i - 1]);
    }
    source.stop();
  });
});

describe("manifest driver — event drainage / scoreline updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers every event.score_change in the manifest, even when adjacent ticks straddle them", () => {
    const store = createMatchStore();
    const seenScoreChanges: Array<{ home: number; away: number }> = [];

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: true,
      rate: 200, // very fast — many events per tick
    });

    source.start(
      (m) => {
        store.getState().applyMessage(m);
        if (m.type === "event.score_change") {
          seenScoreChanges.push({ home: m.home, away: m.away });
        }
      },
      () => undefined,
    );

    // Drive the driver long enough to walk the entire match. At 200×
    // rate the ~7,500,000ms of regulation+ET+pens covers in
    // 7,500,000 / 200 = 37,500 wall-ms, i.e. ~1140 ticks.
    for (let i = 0; i < 1300; i += 1) vi.advanceTimersByTime(33);

    // We should have hit every score change from buildArFrMessages.
    // The fixture has 6 goals during regulation+ET → 6 score_change events.
    expect(seenScoreChanges.length).toBe(6);
    expect(seenScoreChanges[0]).toEqual({ home: 1, away: 0 });
    expect(seenScoreChanges[5]).toEqual({ home: 3, away: 3 });
    source.stop();
  });

  it("score store reflects 1-0 after Messi's 23' goal is crossed", () => {
    const store = createMatchStore();
    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: true,
      rate: 200,
    });

    source.start((m) => store.getState().applyMessage(m), () => undefined);

    // Need to advance past 1,380,000 ms of match time. At rate=200,
    // that's 6900 wall-ms = ~210 ticks at 33ms.
    for (let i = 0; i < 250; i += 1) vi.advanceTimersByTime(33);
    expect(store.getState().score.home).toBeGreaterThanOrEqual(1);
    source.stop();
  });

  it("delivers every event.goal in chronological order", () => {
    const store = createMatchStore();
    const goalTs: number[] = [];

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: true,
      rate: 300,
    });

    source.start(
      (m) => {
        store.getState().applyMessage(m);
        if (m.type === "event.goal") goalTs.push(m.t);
      },
      () => undefined,
    );

    for (let i = 0; i < 1500; i += 1) vi.advanceTimersByTime(33);

    expect(goalTs.length).toBe(6);
    for (let i = 1; i < goalTs.length; i += 1) {
      expect(goalTs[i]).toBeGreaterThanOrEqual(goalTs[i - 1]);
    }
    source.stop();
  });

  it("delivers commentary, kickoff, period_start and match_end without dropping", () => {
    const store = createMatchStore();
    const seen = new Set<string>();

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: true,
      rate: 400,
    });
    source.start(
      (m) => {
        store.getState().applyMessage(m);
        seen.add(m.type);
      },
      () => undefined,
    );

    for (let i = 0; i < 2000; i += 1) vi.advanceTimersByTime(33);

    expect(seen.has("event.kickoff")).toBe(true);
    expect(seen.has("event.commentary")).toBe(true);
    expect(seen.has("event.period_start")).toBe(true);
    expect(seen.has("event.match_end")).toBe(true);
    expect(seen.has("event.penalty_shootout_start")).toBe(true);
    expect(seen.has("event.penalty_shootout_end")).toBe(true);
    source.stop();
  });
});

describe("manifest driver — backward seek replays crossed events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-emits goal events when the user scrubs back across them", () => {
    const store = createMatchStore();
    let captured: import("@vtorn/spec-client").ManifestController | null = null;
    const goalTs: number[] = [];

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: true,
      rate: 300,
      onReady: (c) => {
        captured = c;
      },
    });
    source.start(
      (m) => {
        store.getState().applyMessage(m);
        if (m.type === "event.goal") goalTs.push(m.t);
      },
      () => undefined,
    );

    // Advance past Messi 23' goal
    for (let i = 0; i < 250; i += 1) vi.advanceTimersByTime(33);
    const goalsBefore = goalTs.length;
    expect(goalsBefore).toBeGreaterThanOrEqual(1);

    // Seek back to 0 — the driver should reset its cursor and re-emit
    // any goals we cross again on the way forward.
    captured!.seek(0);
    for (let i = 0; i < 250; i += 1) vi.advanceTimersByTime(33);
    expect(goalTs.length).toBeGreaterThan(goalsBefore);
    source.stop();
  });

  it("a forward-only natural advance does NOT replay events", () => {
    const store = createMatchStore();
    const goalTs: number[] = [];

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: true,
      rate: 300,
    });
    source.start(
      (m) => {
        store.getState().applyMessage(m);
        if (m.type === "event.goal") goalTs.push(m.t);
      },
      () => undefined,
    );

    for (let i = 0; i < 1500; i += 1) vi.advanceTimersByTime(33);
    // Exactly 6 goals total, no duplicates
    expect(goalTs.length).toBe(6);
    source.stop();
  });
});

describe("manifest driver — forward seek rebuilds cumulative state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The "0-0 at 86'" regression Tim screenshot-flagged the night before
  // launch. Repro: open the AR-FR replay, scrub the timeline forward
  // past the goals before the natural driver tick has drained them, and
  // the scoreboard stays stuck at 0-0. Pre-fix, the driver only reset
  // its event cursor on user seeks and never re-applied the crossed
  // events, so any event.score_change between the old and new playhead
  // was dropped on the floor. Post-fix, a user seek re-emits match.init
  // (full store reset) and re-drains every event with t <= playhead.
  it("scoreboard reads 2-2 after a forward scrub to clock 86:39 (AR-FR ground truth)", () => {
    const store = createMatchStore();
    let captured: import("@vtorn/spec-client").ManifestController | null = null;

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: false,
      rate: 1,
      onReady: (c) => {
        captured = c;
      },
    });
    source.start((m) => store.getState().applyMessage(m), () => undefined);

    // Scrub forward to 86:39 in match time — well past the Mbappé 81'
    // equaliser. The fixture builds goals at minute marks: 23, 36, 80,
    // 81, 108, 118. At t = 86 * 60 * 1000 + 39 * 1000 the score should
    // already be 2-2.
    captured!.seek(86 * 60 * 1000 + 39 * 1000);

    expect(store.getState().score).toEqual({ home: 2, away: 2 });
    source.stop();
  });

  it("scoreboard tracks every AR-FR ground-truth score line across forward scrubs", () => {
    const store = createMatchStore();
    let captured: import("@vtorn/spec-client").ManifestController | null = null;

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: false,
      rate: 1,
      onReady: (c) => {
        captured = c;
      },
    });
    source.start((m) => store.getState().applyMessage(m), () => undefined);

    // Ground truth times (clock minute, expected score after).
    // Goals: 23' 1-0, 36' 2-0, 80' 2-1, 81' 2-2, 108' 3-2, 118' 3-3.
    const checkpoints: Array<[number, { home: number; away: number }]> = [
      [25 * 60_000, { home: 1, away: 0 }],
      [37 * 60_000, { home: 2, away: 0 }],
      [81 * 60_000, { home: 2, away: 1 }],
      [82 * 60_000, { home: 2, away: 2 }],
      [109 * 60_000, { home: 3, away: 2 }],
      [119 * 60_000, { home: 3, away: 3 }],
    ];

    for (const [t, expected] of checkpoints) {
      captured!.seek(t);
      expect(store.getState().score, `score at t=${t}`).toEqual(expected);
    }
    source.stop();
  });

  it("scoreboard returns to 0-0 after a backward scrub to t=0", () => {
    const store = createMatchStore();
    let captured: import("@vtorn/spec-client").ManifestController | null = null;

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: false,
      rate: 1,
      onReady: (c) => {
        captured = c;
      },
    });
    source.start((m) => store.getState().applyMessage(m), () => undefined);

    // Seek forward to after the 2-2 equaliser.
    captured!.seek(82 * 60_000);
    expect(store.getState().score).toEqual({ home: 2, away: 2 });

    // Now scrub back to kickoff — the score should fall back to 0-0
    // because the store is rebuilt from the event log at the new
    // playhead.
    captured!.seek(0);
    expect(store.getState().score).toEqual({ home: 0, away: 0 });
    source.stop();
  });

  it("shootout score follows the playhead across forward + backward scrubs", () => {
    const store = createMatchStore();
    let captured: import("@vtorn/spec-client").ManifestController | null = null;

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: false,
      rate: 1,
      onReady: (c) => {
        captured = c;
      },
    });
    source.start((m) => store.getState().applyMessage(m), () => undefined);

    // Scrub past the end of the shootout — Argentina wins 4-2.
    captured!.seek(captured!.durationMs);
    const finalShootout = store.getState().shootout;
    expect(finalShootout.home).toBe(4);
    expect(finalShootout.away).toBe(2);
    expect(finalShootout.ended).toBe(true);

    // Scrub back to mid-regulation — the shootout state should reset.
    captured!.seek(60 * 60_000);
    expect(store.getState().shootout.active).toBe(false);
    expect(store.getState().shootout.ended).toBe(false);
    expect(store.getState().shootout.home).toBe(0);
    expect(store.getState().shootout.away).toBe(0);
    source.stop();
  });

  it("scorers panel survives full-match scrubbing without losing early goals", () => {
    // Repro for the "ring buffer evicts goals" side of the same bug:
    // by 86' a real match has hundreds of events, so the previous 64-
    // slot ring buffer had long since evicted the goal events that
    // computeMatchStats needs to render the scorers list. With the
    // bumped EVENT_RING_SIZE (4096) the goal events stay visible to
    // the aggregator for the entire match.
    const store = createMatchStore();
    let captured: import("@vtorn/spec-client").ManifestController | null = null;

    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: false,
      rate: 1,
      onReady: (c) => {
        captured = c;
      },
    });
    source.start((m) => store.getState().applyMessage(m), () => undefined);

    captured!.seek(82 * 60_000);
    const events = store.getState().events;
    const goalCount = events.filter((e) => e.type === "event.goal").length;
    expect(goalCount).toBeGreaterThanOrEqual(4);
    source.stop();
  });
});

describe("manifest driver — StrictMode start/stop/start", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("source can be restarted after stop (StrictMode double-mount)", () => {
    const store = createMatchStore();
    const source = manifestSourceFromText(ARFR_NDJSON, {
      autoplay: true,
      rate: 50,
    });

    let initCount = 0;
    const onMessage = (m: Message) => {
      store.getState().applyMessage(m);
      if (m.type === "match.init") initCount += 1;
    };
    const onStatus = () => undefined;

    source.start(onMessage, onStatus);
    source.stop();
    source.start(onMessage, onStatus);

    // We should be able to drive ticks after the second start
    for (let i = 0; i < 30; i += 1) vi.advanceTimersByTime(33);

    // init was emitted once per start, but the second start works
    expect(initCount).toBeGreaterThanOrEqual(1);
    expect(store.getState().init).not.toBeNull();
    source.stop();
  });
});
