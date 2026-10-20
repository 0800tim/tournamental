/**
 * Global brake for register-interest (review finding RI-06).
 *
 * The per-IP limit (8 per 10 minutes) stops one address, not a farm of
 * them. This adds a per-process ceiling on how many submissions the
 * route will even look at per minute, whatever the source. Every
 * attempt that passes the per-IP check counts, valid or not, because
 * the point is to cap the work and the writes a flood can cause.
 *
 * The ceiling comes from `REGISTER_INTEREST_GLOBAL_PER_MINUTE`
 * (positive integer; anything else means the default). It is read on
 * every call so a restart is the only way to change it, which is also
 * the only way the in-memory buckets reset. One process per host
 * today; with several, each one brakes on its own.
 *
 * This is a brake, not bot detection. Turnstile on the form is still
 * the right next step and stays Tim's decision (third-party service).
 */

import { checkRateLimit } from "@/lib/rate-limit/in-memory";

export const GLOBAL_BRAKE_DEFAULT_PER_MINUTE = 60;
export const GLOBAL_BRAKE_KEY = "register-interest:global";
const WINDOW_MS = 60_000;
const WARN_EVERY_MS = 60_000;

let lastWarnAt = 0;

/** Parse the ceiling from an env value; invalid, zero or negative means the default. */
export function globalCeilingPerMinute(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return GLOBAL_BRAKE_DEFAULT_PER_MINUTE;
  if (!/^\d{1,6}$/.test(raw.trim())) return GLOBAL_BRAKE_DEFAULT_PER_MINUTE;
  const n = Number(raw.trim());
  return n > 0 ? n : GLOBAL_BRAKE_DEFAULT_PER_MINUTE;
}

export function checkGlobalBrake(
  now: () => number = Date.now,
): { ok: true } | { ok: false; retryAfterMs: number; ceiling: number } {
  const ceiling = globalCeilingPerMinute(process.env.REGISTER_INTEREST_GLOBAL_PER_MINUTE);
  const rl = checkRateLimit(GLOBAL_BRAKE_KEY, ceiling, WINDOW_MS);
  if (rl.ok) return { ok: true };
  const t = now();
  if (t - lastWarnAt >= WARN_EVERY_MS) {
    lastWarnAt = t;
    // eslint-disable-next-line no-console
    console.warn("[register-interest] global brake engaged", {
      ceilingPerMinute: ceiling,
      retryAfterMs: rl.retryAfterMs,
    });
  }
  return { ok: false, retryAfterMs: rl.retryAfterMs, ceiling };
}

/** Test helper so the warn throttle does not leak between cases. */
export function __resetGlobalBrakeWarn(): void {
  lastWarnAt = 0;
}
