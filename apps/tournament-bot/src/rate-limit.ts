// Per-user push throttle. Two layers:
//   - Hard cap: 3 pushes/day default. Bypassable when the user is in
//     "match-day mode" (notify_match_day = 1) AND we're inside a match window.
//   - Quiet hours: per-user TZ. No pushes between quiet_start and quiet_end.
//     Quiet hours are bypassable for kickoff/goal pushes during a match.
//
// Doc 30 § Push system: "Push frequency cap: 3/day max per user unless
// explicitly opted in for 'match-day full coverage'. Quiet hours respected
// per user TZ."

import type { TgUser } from "./storage.js";

export interface RateLimitContext {
  // The user's record.
  user: TgUser;
  // Push category — used to decide whether quiet hours / cap applies.
  category: PushCategory;
  // Wallclock at decision time (ms since epoch). Injected for tests.
  now: Date;
  // Whether we're inside a relevant match window (lifts match-day cap).
  in_match_window: boolean;
}

export type PushCategory =
  | "market_move"
  | "lock_mult_expiry"
  | "kickoff"
  | "goal"
  | "affiliate";

export const DEFAULT_DAILY_CAP = 3;

export interface RateLimitDecision {
  allow: boolean;
  reason?:
    | "user_opted_out"
    | "quiet_hours"
    | "daily_cap_reached"
    | "category_disabled";
}

export function dayKey(now: Date, tz: string): string {
  // Render YYYY-MM-DD in the user's TZ, so the cap resets at user's local midnight.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now);
}

function userClock(now: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string): number => {
    const p = parts.find((x) => x.type === t);
    return p ? Number.parseInt(p.value, 10) : 0;
  };
  return { hour: get("hour"), minute: get("minute") };
}

function inQuietHours(now: Date, tz: string, start: string, end: string): boolean {
  const { hour, minute } = userClock(now, tz);
  const cur = hour * 60 + minute;
  const [sh, sm] = start.split(":").map((s) => Number.parseInt(s, 10));
  const [eh, em] = end.split(":").map((s) => Number.parseInt(s, 10));
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return false;
  if (s < e) {
    // Same-day window: e.g. 13:00–15:00 → quiet between those.
    return cur >= s && cur < e;
  }
  // Overnight window: e.g. 22:00–08:00 → quiet if cur ≥ 22 OR cur < 08.
  return cur >= s || cur < e;
}

export function shouldSendPush(ctx: RateLimitContext): RateLimitDecision {
  const { user, category, now, in_match_window } = ctx;

  // Per-category prefs.
  const catPref: Record<PushCategory, number> = {
    market_move: user.notify_market_move,
    lock_mult_expiry: user.notify_market_move, // shares the prediction-side toggle
    kickoff: user.notify_kickoff,
    goal: user.notify_goal,
    affiliate: user.notify_affiliate,
  };
  if (catPref[category] !== 1) {
    return { allow: false, reason: "category_disabled" };
  }

  // Quiet hours — but kickoff/goal during a live match override.
  const quiet = inQuietHours(now, user.tz, user.quiet_start, user.quiet_end);
  const quietBypass =
    in_match_window && (category === "kickoff" || category === "goal");
  if (quiet && !quietBypass) {
    return { allow: false, reason: "quiet_hours" };
  }

  // Daily cap, possibly bypassed by match-day mode + active match window.
  const today = dayKey(now, user.tz);
  const sameDay = user.push_count_day === today;
  const used = sameDay ? user.push_count_today : 0;
  const matchDayBypass = in_match_window && user.notify_match_day === 1;
  if (!matchDayBypass && used >= DEFAULT_DAILY_CAP) {
    return { allow: false, reason: "daily_cap_reached" };
  }

  return { allow: true };
}
