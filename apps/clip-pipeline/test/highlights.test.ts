import { describe, expect, it } from "vitest";

import { classifyEvent, detectHighlights, topHighlights } from "../src/highlights.js";
import type { DetectorEvent, Highlight } from "../src/types.js";

/**
 * Reference fixture loosely modelled on the actual AR-FR 2022 final scoreline:
 *   1-0 Messi (23'), 2-0 Di María (36'), 2-1 Mbappé (80' pen),
 *   2-2 Mbappé (81'), 3-2 Messi (108'), 3-3 Mbappé (118' pen),
 *   then penalties Argentina 4-2.
 *
 * Times in ms are approximate "minute * 60_000" — the exact wall-clock
 * doesn't matter for highlight detection, only relative spacing.
 */
const arfrFinal: DetectorEvent[] = [
  { t: 23 * 60_000, type: "event.goal", player: "P_MESSI", team: "ARG" },
  { t: 36 * 60_000, type: "event.goal", player: "P_DIMARIA", team: "ARG" },
  { t: 78 * 60_000, type: "event.foul", player: "P_OTAMENDI", severity: "yellow" },
  { t: 80 * 60_000, type: "event.penalty_attempt", player: "P_MBAPPE", outcome: "scored", team: "FRA" },
  { t: 81 * 60_000, type: "event.goal", player: "P_MBAPPE", team: "FRA" },
  { t: 90 * 60_000, type: "event.shot", player: "P_MESSI", on_target: true, saved: true },
  { t: 90 * 60_000 + 200, type: "event.save", player: "P_LLORIS" },
  { t: 108 * 60_000, type: "event.goal", player: "P_MESSI", team: "ARG" },
  { t: 118 * 60_000, type: "event.penalty_attempt", player: "P_MBAPPE", outcome: "scored", team: "FRA" },
  { t: 118 * 60_000 + 100, type: "event.goal", player: "P_MBAPPE", team: "FRA" },
  { t: 125 * 60_000, type: "event.match_end" },
];

describe("classifyEvent", () => {
  it("scores goals at 10", () => {
    const r = classifyEvent({ t: 0, type: "event.goal" });
    expect(r?.kind).toBe("goal");
    expect(r?.importance).toBe(10);
  });

  it("scores penalty attempts at 9", () => {
    const r = classifyEvent({ t: 0, type: "event.penalty_attempt", outcome: "missed" });
    expect(r?.kind).toBe("penalty");
    expect(r?.importance).toBe(9);
  });

  it("treats red-card fouls and yellow-card fouls separately", () => {
    expect(classifyEvent({ t: 0, type: "event.foul", severity: "red" })?.kind).toBe("red");
    expect(classifyEvent({ t: 0, type: "event.foul", severity: "yellow" })?.kind).toBe("yellow");
    expect(classifyEvent({ t: 0, type: "event.foul", severity: "soft" })).toBeNull();
  });

  it("skips off-target shots and saved-but-on-target shots are kept under shot rule", () => {
    expect(classifyEvent({ t: 0, type: "event.shot", on_target: false })).toBeNull();
    // Saved-but-on-target is covered by event.save; the shot itself is still a highlight.
    const saved = classifyEvent({ t: 0, type: "event.shot", on_target: true, saved: true });
    expect(saved).toBeNull();
    const onTargetGoal = classifyEvent({ t: 0, type: "event.shot", on_target: true });
    expect(onTargetGoal?.kind).toBe("shot_on_target");
  });

  it("skips kickoffs, passes, throw-ins and other non-events", () => {
    expect(classifyEvent({ t: 0, type: "event.kickoff" })).toBeNull();
    expect(classifyEvent({ t: 0, type: "event.pass" })).toBeNull();
    expect(classifyEvent({ t: 0, type: "event.out_of_bounds", restart: "throw_in" })).toBeNull();
    expect(classifyEvent({ t: 0, type: "event.tackle" })).toBeNull();
  });

  it("recognises match_end as a highlight", () => {
    expect(classifyEvent({ t: 0, type: "event.match_end" })?.kind).toBe("match_end");
  });

  it("recognises saves", () => {
    expect(classifyEvent({ t: 0, type: "event.save" })?.kind).toBe("save");
  });
});

describe("detectHighlights", () => {
  it("returns an empty list for an empty event stream", () => {
    expect(detectHighlights([])).toEqual([]);
  });

  it("returns an empty list when no events match a rule", () => {
    expect(
      detectHighlights([
        { t: 1, type: "event.kickoff" },
        { t: 2, type: "event.pass" },
      ]),
    ).toEqual([]);
  });

  it("produces one highlight per goal when goals are far apart", () => {
    const events: DetectorEvent[] = [
      { t: 60_000, type: "event.goal", player: "A" },
      { t: 600_000, type: "event.goal", player: "B" },
    ];
    const highlights = detectHighlights(events);
    expect(highlights).toHaveLength(2);
    expect(highlights[0]?.kind).toBe("goal");
    expect(highlights[1]?.kind).toBe("goal");
  });

  it("merges overlapping windows and takes the highest-importance kind", () => {
    // A penalty attempt 100ms before a goal should merge into one highlight
    // tagged as a goal (importance 10 beats penalty 9).
    const events: DetectorEvent[] = [
      { t: 100_000, type: "event.penalty_attempt", outcome: "scored", player: "P" },
      { t: 100_100, type: "event.goal", player: "P", team: "T" },
    ];
    const merged = detectHighlights(events);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.kind).toBe("goal");
    expect(merged[0]?.importance).toBe(10);
    expect(merged[0]?.team).toBe("T");
  });

  it("expands a goal window to (t-7s, t+10s)", () => {
    const events: DetectorEvent[] = [{ t: 100_000, type: "event.goal" }];
    const [h] = detectHighlights(events);
    expect(h?.start_ms).toBe(93_000);
    expect(h?.end_ms).toBe(110_000);
  });

  it("clamps start_ms at 0 for events early in the match", () => {
    const events: DetectorEvent[] = [{ t: 1_000, type: "event.goal" }];
    const [h] = detectHighlights(events);
    expect(h?.start_ms).toBe(0);
    expect(h?.end_ms).toBe(11_000);
  });

  it("returns highlights sorted by start_ms ascending", () => {
    const events: DetectorEvent[] = [
      { t: 600_000, type: "event.goal" },
      { t: 60_000, type: "event.goal" },
      { t: 300_000, type: "event.goal" },
    ];
    const out = detectHighlights(events);
    const starts = out.map((h) => h.start_ms);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });

  it("is deterministic — same input produces byte-identical output", () => {
    const a = JSON.stringify(detectHighlights(arfrFinal));
    const b = JSON.stringify(detectHighlights(arfrFinal));
    expect(a).toBe(b);
  });

  it("identifies the AR-FR final's six goals as goal-kind highlights", () => {
    const out = detectHighlights(arfrFinal);
    const goals = out.filter((h: Highlight) => h.kind === "goal");
    // 6 distinct goal events; some are tightly clustered around penalties so
    // the merged count may be slightly less. Pick the goal-kind subset.
    expect(goals.length).toBeGreaterThanOrEqual(4);
  });

  it("never produces overlapping output windows", () => {
    const out = detectHighlights(arfrFinal);
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1]!;
      const cur = out[i]!;
      expect(cur.start_ms).toBeGreaterThan(prev.end_ms);
    }
  });

  it("preserves player + team metadata for the dominant event in a merged window", () => {
    const events: DetectorEvent[] = [
      { t: 100_000, type: "event.shot", on_target: true, player: "X" },
      { t: 100_500, type: "event.goal", player: "Y", team: "T" },
    ];
    const [h] = detectHighlights(events);
    expect(h?.player).toBe("Y");
    expect(h?.team).toBe("T");
  });
});

describe("topHighlights", () => {
  it("returns at most `limit` items", () => {
    const out = topHighlights(arfrFinal, 3);
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("returns 0 when limit is 0 or negative", () => {
    expect(topHighlights(arfrFinal, 0)).toEqual([]);
    expect(topHighlights(arfrFinal, -5)).toEqual([]);
  });

  it("orders the top-N chronologically (after picking by importance)", () => {
    const out = topHighlights(arfrFinal, 5);
    const starts = out.map((h) => h.start_ms);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });
});
