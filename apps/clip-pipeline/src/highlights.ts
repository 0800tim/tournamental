/**
 * Highlight detection — pure function over a list of spec events. Scores each
 * candidate event by importance, expands it into a (start_ms, end_ms) window,
 * and greedy-merges overlapping windows so the resulting highlight reel
 * doesn't double-clip the same moment.
 *
 * Determinism is critical: given the same input event stream, this function
 * produces byte-identical output. That's what lets the clip ID be a simple
 * SHA over the input parameters — there's no internal randomness.
 *
 * Importance scoring (per docs/14):
 *   goal              10
 *   penalty (any)      9
 *   foul (red)         8
 *   match_end          7
 *   save               4
 *   foul (yellow)      3
 *   shot_on_target     2
 *
 * Window expansion (also per docs/14):
 *   goal             [t-7s,  t+10s]
 *   penalty          [t-5s,  t+8s]
 *   foul (red)       [t-4s,  t+8s]
 *   match_end        [t-15s, t+5s]
 *   save             [t-4s,  t+5s]
 *   foul (yellow)    [t-3s,  t+5s]
 *   shot_on_target   [t-4s,  t+5s]
 */

import type { DetectorEvent, Highlight, HighlightKind } from "./types.js";

interface Rule {
  kind: HighlightKind;
  importance: number;
  pre_ms: number;
  post_ms: number;
}

const GOAL_RULE: Rule = { kind: "goal", importance: 10, pre_ms: 7_000, post_ms: 10_000 };
const PENALTY_RULE: Rule = { kind: "penalty", importance: 9, pre_ms: 5_000, post_ms: 8_000 };
const RED_RULE: Rule = { kind: "red", importance: 8, pre_ms: 4_000, post_ms: 8_000 };
const MATCH_END_RULE: Rule = { kind: "match_end", importance: 7, pre_ms: 15_000, post_ms: 5_000 };
const SAVE_RULE: Rule = { kind: "save", importance: 4, pre_ms: 4_000, post_ms: 5_000 };
const YELLOW_RULE: Rule = { kind: "yellow", importance: 3, pre_ms: 3_000, post_ms: 5_000 };
const SHOT_RULE: Rule = { kind: "shot_on_target", importance: 2, pre_ms: 4_000, post_ms: 5_000 };

/**
 * Map a single spec event to a (rule | null). Null events don't trigger
 * highlights (kickoffs, throw-ins, ordinary passes, …). The mapping is
 * intentionally narrow — we'd rather miss a marginal "highlight" than spam
 * the social queue with non-events.
 */
export function classifyEvent(event: DetectorEvent): Rule | null {
  switch (event.type) {
    case "event.goal":
      return GOAL_RULE;
    case "event.penalty_attempt":
      // Every penalty attempt — scored, missed, or saved — is a highlight.
      return PENALTY_RULE;
    case "event.foul":
      if (event.severity === "red") return RED_RULE;
      if (event.severity === "yellow") return YELLOW_RULE;
      return null;
    case "event.match_end":
      return MATCH_END_RULE;
    case "event.save":
      return SAVE_RULE;
    case "event.shot":
      // Goals already cover scored shots; only on-target-but-not-scored count.
      if (event.on_target && !event.saved) return SHOT_RULE;
      return null;
    case "event.out_of_bounds":
      // A penalty restart implies a foul we may have missed; treat it as a penalty
      // *only* if no penalty_attempt event follows. The simpler rule is to fold
      // this in to penalty_attempt — so we drop it here to avoid duplicates.
      return null;
    default:
      return null;
  }
}

/**
 * Detect highlights from an event stream. Returns a list sorted by start_ms
 * ascending; merged windows take the highest-importance kind in the window.
 */
export function detectHighlights(events: ReadonlyArray<DetectorEvent>): Highlight[] {
  if (events.length === 0) return [];

  // 1. Build raw highlight candidates from each rule-matching event.
  const raw: Highlight[] = [];
  for (const ev of events) {
    const rule = classifyEvent(ev);
    if (!rule) continue;
    const start = Math.max(0, ev.t - rule.pre_ms);
    const end = ev.t + rule.post_ms;
    const h: Highlight = {
      start_ms: start,
      end_ms: end,
      kind: rule.kind,
      importance: rule.importance,
    };
    if (ev.player !== undefined) h.player = ev.player;
    if (ev.team !== undefined) h.team = ev.team;
    raw.push(h);
  }
  if (raw.length === 0) return [];

  // 2. Sort by start, then by descending importance so the merger picks the
  //    most important kind first when windows overlap.
  raw.sort((a, b) =>
    a.start_ms !== b.start_ms ? a.start_ms - b.start_ms : b.importance - a.importance,
  );

  // 3. Greedy-merge overlapping (or touching) windows.
  const merged: Highlight[] = [];
  for (const candidate of raw) {
    const last = merged[merged.length - 1];
    if (last && candidate.start_ms <= last.end_ms) {
      // Overlap → extend the existing window and upgrade kind/importance if
      // the new candidate is more important.
      if (candidate.end_ms > last.end_ms) last.end_ms = candidate.end_ms;
      if (candidate.importance > last.importance) {
        last.kind = candidate.kind;
        last.importance = candidate.importance;
        if (candidate.player !== undefined) last.player = candidate.player;
        else delete last.player;
        if (candidate.team !== undefined) last.team = candidate.team;
        else delete last.team;
      }
    } else {
      merged.push({ ...candidate });
    }
  }

  return merged;
}

/** Convenience: get the top-N highlights by importance, then chronological. */
export function topHighlights(
  events: ReadonlyArray<DetectorEvent>,
  limit: number,
): Highlight[] {
  if (limit <= 0) return [];
  const all = detectHighlights(events);
  return [...all]
    .sort((a, b) =>
      a.importance !== b.importance ? b.importance - a.importance : a.start_ms - b.start_ms,
    )
    .slice(0, limit)
    .sort((a, b) => a.start_ms - b.start_ms);
}
