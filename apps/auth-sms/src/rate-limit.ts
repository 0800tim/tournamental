/**
 * Rate limiting for OTP request and verify flows.
 *
 * Implementation: fixed-window counters keyed on (subject, action,
 * window_start). The window start is `floor(now / window_seconds) *
 * window_seconds`, so a single bucket covers exactly `window_seconds`
 * of wall-clock time. Cheap, deterministic, and good enough for OTP
 * abuse prevention (we are not trying to allocate millicent fractions
 * of cost — we just want "no more than 5/hour").
 *
 * Limits enforced:
 *   - 1 OTP request per phone per 60s.
 *   - Max 5 OTP requests per phone per hour.
 *   - Max 5 verify attempts per OTP (tracked separately on the OTP row).
 *   - 30 OTP requests per IP per hour.
 *
 * Rationale: phone numbers are sticky to a person; IP is sticky to a
 * network. We rate-limit both axes to make it expensive to fan out
 * floods. The verify-attempt counter on the OTP row provides the
 * brute-force protection (5 wrong codes invalidates the OTP).
 */

import type { Storage } from './storage.js';

export interface RateLimitOk {
  ok: true;
  count: number;
  windowStart: number;
}

export interface RateLimitBlocked {
  ok: false;
  reason:
    | 'phone-cooldown'
    | 'phone-hourly'
    | 'ip-hourly';
  retryAfterSeconds: number;
}

export type RateLimitResult = RateLimitOk | RateLimitBlocked;

export interface RateLimitConfig {
  /** Per-phone cooldown between OTP requests. */
  phoneCooldownSeconds: number;
  /** Per-phone hourly cap. */
  phoneHourlyMax: number;
  /** Per-IP hourly cap. */
  ipHourlyMax: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  phoneCooldownSeconds: 60,
  phoneHourlyMax: 5,
  ipHourlyMax: 30,
};

const SECONDS_PER_HOUR = 60 * 60;

function bucketStart(now: number, windowSeconds: number): number {
  return Math.floor(now / windowSeconds) * windowSeconds;
}

/**
 * Check + record an OTP request. Mutates the rate-limit store.
 *
 * The phone cooldown bucket is `windowSeconds = phoneCooldownSeconds`
 * with a max of 1; the hourly buckets use `windowSeconds = 3600`.
 */
export function checkOtpRequestLimit(opts: {
  storage: Storage;
  phone: string;
  ip: string;
  now: number;
  config?: Partial<RateLimitConfig>;
}): RateLimitResult {
  const cfg = { ...DEFAULT_RATE_LIMIT_CONFIG, ...(opts.config ?? {}) };
  const { storage, phone, ip, now } = opts;

  // Phone cooldown — must be 0 in the current window.
  const cooldownBucket = bucketStart(now, cfg.phoneCooldownSeconds);
  const cooldownKey = `phone:${phone}:cooldown`;
  const cooldownExisting = storage.getRateBucket(cooldownKey, cooldownBucket);
  if (cooldownExisting >= 1) {
    return {
      ok: false,
      reason: 'phone-cooldown',
      retryAfterSeconds: cooldownBucket + cfg.phoneCooldownSeconds - now,
    };
  }

  // Phone hourly cap.
  const hourlyBucket = bucketStart(now, SECONDS_PER_HOUR);
  const phoneHourlyKey = `phone:${phone}:hourly`;
  const phoneHourly = storage.getRateBucket(phoneHourlyKey, hourlyBucket);
  if (phoneHourly >= cfg.phoneHourlyMax) {
    return {
      ok: false,
      reason: 'phone-hourly',
      retryAfterSeconds: hourlyBucket + SECONDS_PER_HOUR - now,
    };
  }

  // IP hourly cap.
  const ipHourlyKey = `ip:${ip}:hourly`;
  const ipHourly = storage.getRateBucket(ipHourlyKey, hourlyBucket);
  if (ipHourly >= cfg.ipHourlyMax) {
    return {
      ok: false,
      reason: 'ip-hourly',
      retryAfterSeconds: hourlyBucket + SECONDS_PER_HOUR - now,
    };
  }

  // All checks passed — bump the counters.
  storage.bumpRateBucket(cooldownKey, cooldownBucket);
  const newPhoneHourly = storage.bumpRateBucket(phoneHourlyKey, hourlyBucket);
  storage.bumpRateBucket(ipHourlyKey, hourlyBucket);

  // Opportunistic prune of buckets older than 2 hours.
  storage.pruneRateBuckets(now - 2 * SECONDS_PER_HOUR);

  return {
    ok: true,
    count: newPhoneHourly,
    windowStart: hourlyBucket,
  };
}
