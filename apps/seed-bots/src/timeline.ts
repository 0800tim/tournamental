/**
 * Activity-timeline generator (spec §4.4).
 *
 * Distribution of `created_at`:
 *   - 6k bots backdated 26 May - 6 June (early tail).
 *   - 12k bots ramping 7-11 June (press momentum).
 *   - Both clusters skew toward evenings + weekends + press dates.
 *
 * Per-bot save events:
 *   - high engagement (10%): 3-5 saves at random pre-lock timestamps.
 *   - medium (30%): 1-2 saves.
 *   - low (60%): 1 save (set-and-forget).
 *
 * For 100-bot test runs we scale the backdate / ramp boundary
 * proportionally so the distribution still makes sense.
 *
 * All times produced are UNIX-seconds.
 */

import { makeRng, type Rng } from "./rng.js";
import type { Personality } from "./personalities.js";

// ---------- date constants ----------

// 11 June 2026 19:00 UTC -- first match kickoff. Saves must lock by this.
const KICKOFF_UTC_SECS = Math.floor(Date.UTC(2026, 5, 11, 19, 0, 0) / 1000);

// Early-tail window: 26 May 2026 00:00 UTC -> 6 June 2026 23:59 UTC.
const EARLY_START = Math.floor(Date.UTC(2026, 4, 26, 0, 0, 0) / 1000);
const EARLY_END = Math.floor(Date.UTC(2026, 5, 6, 23, 59, 59) / 1000);

// Press-momentum window: 7 June 2026 00:00 UTC -> 11 June 2026 18:00 UTC.
const RAMP_START = Math.floor(Date.UTC(2026, 5, 7, 0, 0, 0) / 1000);
const RAMP_END = Math.floor(Date.UTC(2026, 5, 11, 18, 0, 0) / 1000);

// Press-release dates the spec calls out (extra mass on these days):
//   - 2 June (early tail) and 8 June (ramp).
const PRESS_DATES_UTC_DAYS: readonly number[] = [
  Math.floor(Date.UTC(2026, 5, 2) / 86400_000),
  Math.floor(Date.UTC(2026, 5, 8) / 86400_000),
];

// ---------- shape helpers ----------

/** True if the given unix-seconds is a Sat or Sun in UTC. */
function isWeekend(utcSecs: number): boolean {
  const dow = new Date(utcSecs * 1000).getUTCDay();
  return dow === 0 || dow === 6;
}

/** True if the unix-seconds is on a tagged press date. */
function isPressDate(utcSecs: number): boolean {
  const dayIdx = Math.floor(utcSecs / 86400);
  return PRESS_DATES_UTC_DAYS.includes(dayIdx);
}

/** True if the unix-seconds local UTC hour is in [18, 23] (evening-ish). */
function isEvening(utcSecs: number): boolean {
  const h = new Date(utcSecs * 1000).getUTCHours();
  return h >= 18 && h <= 23;
}

/**
 * Sample a timestamp from a window via rejection: draw uniform from the
 * window, accept with a probability that boosts evenings + weekends +
 * press dates. Bounded re-tries so a single bot can't loop.
 */
function sampleWindow(rng: Rng, lo: number, hi: number): number {
  for (let attempt = 0; attempt < 32; attempt++) {
    const t = lo + Math.floor(rng() * (hi - lo + 1));
    let accept = 0.35; // baseline
    if (isEvening(t)) accept += 0.25;
    if (isWeekend(t)) accept += 0.2;
    if (isPressDate(t)) accept += 0.2;
    if (rng() < accept) return t;
  }
  return Math.floor((lo + hi) / 2);
}

// ---------- public types ----------

export interface BotTimeline {
  readonly created_at_secs: number;
  /**
   * Save events in chronological order. The last save is the locked
   * bracket; earlier saves represent the user "tweaking" their picks.
   * For DB write purposes only the LAST save matters (it's the locked
   * version). Earlier ones are recorded for forensic / analytics use.
   */
  readonly save_events_secs: readonly number[];
}

// ---------- public API ----------

/**
 * Roll an activity timeline for one bot. `index` decides which window
 * the bot lands in (early-tail vs ramp). `target` scales the cutoff
 * for smaller test cohorts.
 *
 * Spec exact split: 6k early-tail, 12k ramp on the 18k cohort
 * (one-third / two-thirds). We scale proportionally so a 100-bot test
 * run has ~33 early-tail and ~67 ramp.
 */
export function rollTimeline(args: {
  masterSeed: string;
  index: number;
  target: number;
  personality: Personality;
}): BotTimeline {
  const { masterSeed, index, target, personality } = args;

  const earlyCutoff = Math.floor(target / 3); // 33% backdated.
  const isEarly = index < earlyCutoff;

  const rngCreate = makeRng(`${masterSeed}:timeline:create:${index}`);
  const created_at_secs = isEarly
    ? sampleWindow(rngCreate, EARLY_START, EARLY_END)
    : sampleWindow(rngCreate, RAMP_START, RAMP_END);

  // Save events: chronologically after created_at, all before kickoff.
  const rngSaves = makeRng(`${masterSeed}:timeline:saves:${index}`);
  let saveCount: number;
  if (personality.engagement_tier === "high") {
    saveCount = 3 + Math.floor(rngSaves() * 3); // 3-5
  } else if (personality.engagement_tier === "med") {
    saveCount = 1 + Math.floor(rngSaves() * 2); // 1-2
  } else {
    saveCount = 1;
  }

  const lo = created_at_secs;
  const hi = KICKOFF_UTC_SECS - 60; // lock 60s before kickoff
  const events: number[] = [];
  for (let i = 0; i < saveCount; i++) {
    events.push(sampleWindow(rngSaves, lo, hi));
  }
  events.sort((a, b) => a - b);

  return { created_at_secs, save_events_secs: events };
}

/** Exposed for the validator / dry-run summary. */
export const TIMELINE_BOUNDS = {
  KICKOFF_UTC_SECS,
  EARLY_START,
  EARLY_END,
  RAMP_START,
  RAMP_END,
} as const;
