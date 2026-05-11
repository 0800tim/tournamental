/**
 * OTP verify lockout + per-IP verify rate limit.
 *
 * Layered on top of the per-OTP attempts counter that already invalidates
 * a single code after 5 wrong guesses. The pieces here are:
 *
 *   - **Phone lockout**: after 5 *consecutive* failed verifies for the
 *     same phone, lock the phone for 1 hour. A successful verify
 *     resets the counter. This prevents an attacker from burning a
 *     fresh OTP every 60 seconds (cool-down) and continuing to brute
 *     force the same phone.
 *
 *   - **Per-IP verify cap**: 30 verify attempts per 5 minutes per IP.
 *     Catches an attacker who cycles through many phone numbers from
 *     a single source , the phone-level lockout alone would not stop
 *     that pattern because each phone is independent.
 *
 * State lives in the same `rate_limit` SQLite table that the request
 * limiter uses, so there is no second store to provision. Keys:
 *
 *   - phone lockout failure counter: `verify:phone:<phone>:failures`
 *     (15-minute rolling window).
 *   - phone lockout flag:            `verify:phone:<phone>:locked-until`
 *     (single-row sentinel; bucket_start is the unix-seconds expiry).
 *   - per-IP verify counter:         `verify:ip:<ip>:5m`
 *     (5-minute fixed window).
 *
 * Stored counts are bumped via the existing `bumpRateBucket` helper so
 * tests can inspect the table directly.
 */

import type { Storage } from './storage.js';

export const DEFAULT_LOCKOUT_CONFIG = {
  /** Failures inside this window count toward the lockout threshold. */
  phoneFailureWindowSeconds: 15 * 60,
  /** Failures required to trigger the lockout. */
  phoneFailureThreshold: 5,
  /** How long the lockout lasts once triggered. */
  phoneLockoutSeconds: 60 * 60,
  /** IP verify-attempt window. */
  ipWindowSeconds: 5 * 60,
  /** Max verify attempts per IP per window. */
  ipMaxPerWindow: 30,
};

export type LockoutConfig = typeof DEFAULT_LOCKOUT_CONFIG;

export type LockoutCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'phone-locked' | 'ip-throttled';
      retryAfterSeconds: number;
    };

function bucketStart(now: number, windowSeconds: number): number {
  return Math.floor(now / windowSeconds) * windowSeconds;
}

function phoneFailureKey(phone: string): string {
  return `verify:phone:${phone}:failures`;
}

function phoneLockoutKey(phone: string): string {
  return `verify:phone:${phone}:locked-until`;
}

function ipKey(ip: string): string {
  return `verify:ip:${ip}:5m`;
}

/**
 * Check both the phone lockout and the IP throttle. This is called BEFORE
 * any HMAC compare so even a wrong-code attempt costs us nothing past
 * the SQLite read. Does not mutate state , `recordFailure` / `recordIpAttempt`
 * do that on the actual outcome.
 */
export function checkVerifyAllowed(opts: {
  storage: Storage;
  phone: string;
  ip: string;
  now: number;
  config?: Partial<LockoutConfig>;
}): LockoutCheckResult {
  const cfg = { ...DEFAULT_LOCKOUT_CONFIG, ...(opts.config ?? {}) };
  const { storage, phone, ip, now } = opts;

  // Phone-level lockout: the "locked-until" key holds a single row whose
  // bucket_start is the unix-seconds expiry. If now < expiry, deny.
  const lockedUntil = readScalarBucket(storage, phoneLockoutKey(phone));
  if (lockedUntil > now) {
    return {
      ok: false,
      reason: 'phone-locked',
      retryAfterSeconds: lockedUntil - now,
    };
  }

  // Per-IP fixed-window cap.
  const ipBucket = bucketStart(now, cfg.ipWindowSeconds);
  const ipCount = storage.getRateBucket(ipKey(ip), ipBucket);
  if (ipCount >= cfg.ipMaxPerWindow) {
    return {
      ok: false,
      reason: 'ip-throttled',
      retryAfterSeconds: ipBucket + cfg.ipWindowSeconds - now,
    };
  }

  return { ok: true };
}

/** Record one verify attempt against the IP bucket. Returns the new count. */
export function recordIpAttempt(opts: {
  storage: Storage;
  ip: string;
  now: number;
  config?: Partial<LockoutConfig>;
}): number {
  const cfg = { ...DEFAULT_LOCKOUT_CONFIG, ...(opts.config ?? {}) };
  const bucket = bucketStart(opts.now, cfg.ipWindowSeconds);
  return opts.storage.bumpRateBucket(ipKey(opts.ip), bucket);
}

/**
 * Record one failed verify for the phone. Returns whether this failure
 * has triggered the lockout (`{ locked: true, until }`) or not.
 */
export function recordPhoneFailure(opts: {
  storage: Storage;
  phone: string;
  now: number;
  config?: Partial<LockoutConfig>;
}): { locked: boolean; failures: number; until: number } {
  const cfg = { ...DEFAULT_LOCKOUT_CONFIG, ...(opts.config ?? {}) };
  const failureBucket = bucketStart(opts.now, cfg.phoneFailureWindowSeconds);
  const failures = opts.storage.bumpRateBucket(
    phoneFailureKey(opts.phone),
    failureBucket,
  );

  if (failures >= cfg.phoneFailureThreshold) {
    const until = opts.now + cfg.phoneLockoutSeconds;
    writeScalarBucket(opts.storage, phoneLockoutKey(opts.phone), until);
    return { locked: true, failures, until };
  }

  return { locked: false, failures, until: 0 };
}

/**
 * Reset the failure counter and clear any active lockout. Call after a
 * successful verify so a returning user is not penalised for typos.
 */
export function clearPhoneFailures(opts: {
  storage: Storage;
  phone: string;
}): void {
  const { storage, phone } = opts;
  // Wipe every bucket under both keys.
  storage.db
    .prepare(`DELETE FROM rate_limit WHERE key = ?`)
    .run(phoneFailureKey(phone));
  storage.db
    .prepare(`DELETE FROM rate_limit WHERE key = ?`)
    .run(phoneLockoutKey(phone));
}

/**
 * Read a one-row scalar bucket. We store the "value" as the
 * `bucket_start` column so that pruneRateBuckets (which deletes by
 * bucket_start < cutoff) still GCs stale lockouts naturally.
 */
function readScalarBucket(storage: Storage, key: string): number {
  const row = storage.db
    .prepare(
      `SELECT bucket_start FROM rate_limit WHERE key = ?
       ORDER BY bucket_start DESC LIMIT 1`,
    )
    .get(key) as { bucket_start: number } | undefined;
  return row?.bucket_start ?? 0;
}

function writeScalarBucket(storage: Storage, key: string, value: number): void {
  // Replace any prior row so we never keep two sentinels for one key.
  storage.db
    .prepare(`DELETE FROM rate_limit WHERE key = ?`)
    .run(key);
  storage.db
    .prepare(
      `INSERT INTO rate_limit (key, bucket_start, count) VALUES (?, ?, 1)`,
    )
    .run(key, value);
}
