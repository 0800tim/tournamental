/**
 * Brute-force defence for dm-otp verify.
 *
 * Sits in front of `CodeStore.verify(...)`. The store already enforces:
 *   - 5-minute TTL.
 *   - 5-attempts-per-code (then the record is dropped).
 *   - Single-use semantics.
 *
 * This module adds two more layers:
 *
 *   - **Subject lockout**: after 5 failed verifies for the same
 *     (channel, externalId) inside a 15-minute window, the subject
 *     is locked for 1 hour. Re-requesting a fresh code does not
 *     reset the lockout. A successful verify clears it.
 *
 *   - **Per-IP throttle**: 30 verify attempts per 5 minutes per IP.
 *     Catches an attacker who cycles through many externalIds (e.g.
 *     spoofed Discord user-ids) from the same source.
 *
 * State is in-memory. dm-otp is a single-instance service today
 * (per docs/32); when it scales out we'll move this to Redis SETEX +
 * a small Lua script. The interface is intentionally small so the
 * swap is a 30-line change.
 */

export interface BruteForceConfig {
  /** Failures inside this window count toward the lockout threshold. */
  subjectFailureWindowMs: number;
  /** Failures required to trigger the lockout. */
  subjectFailureThreshold: number;
  /** How long the lockout lasts once triggered. */
  subjectLockoutMs: number;
  /** Per-IP fixed-window length. */
  ipWindowMs: number;
  /** Max verify attempts per IP per window. */
  ipMaxPerWindow: number;
}

export const DEFAULT_BRUTE_FORCE_CONFIG: BruteForceConfig = {
  subjectFailureWindowMs: 15 * 60 * 1000,
  subjectFailureThreshold: 5,
  subjectLockoutMs: 60 * 60 * 1000,
  ipWindowMs: 5 * 60 * 1000,
  ipMaxPerWindow: 30,
};

export type Guard =
  | { ok: true }
  | {
      ok: false;
      reason: 'subject-locked' | 'ip-throttled';
      retryAfterSeconds: number;
    };

interface FailureRecord {
  failuresAt: number[];      // unix-ms of recent failures
  lockedUntil: number;       // 0 if not locked
}

interface IpRecord {
  windowStart: number;       // unix-ms, start of the active 5-min bucket
  count: number;
}

export class BruteForceGuard {
  private readonly subjects = new Map<string, FailureRecord>();
  private readonly ips = new Map<string, IpRecord>();
  private readonly cfg: BruteForceConfig;
  private readonly now: () => number;

  constructor(opts: { config?: Partial<BruteForceConfig>; now?: () => number } = {}) {
    this.cfg = { ...DEFAULT_BRUTE_FORCE_CONFIG, ...(opts.config ?? {}) };
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Check whether a verify is allowed. Does not mutate state , call
   * `recordIpAttempt` / `recordSubjectFailure` separately on the actual
   * outcome.
   */
  check(opts: { channel: string; externalId: string; ip: string }): Guard {
    const t = this.now();

    const sub = this.subjects.get(this.subjectKey(opts.channel, opts.externalId));
    if (sub && sub.lockedUntil > t) {
      return {
        ok: false,
        reason: 'subject-locked',
        retryAfterSeconds: Math.ceil((sub.lockedUntil - t) / 1000),
      };
    }

    const ip = this.ips.get(opts.ip);
    if (ip) {
      // Slide forward if the window expired.
      if (t - ip.windowStart >= this.cfg.ipWindowMs) {
        ip.windowStart = t;
        ip.count = 0;
      }
      if (ip.count >= this.cfg.ipMaxPerWindow) {
        return {
          ok: false,
          reason: 'ip-throttled',
          retryAfterSeconds: Math.ceil(
            (ip.windowStart + this.cfg.ipWindowMs - t) / 1000,
          ),
        };
      }
    }

    return { ok: true };
  }

  recordIpAttempt(ip: string): void {
    const t = this.now();
    const cur = this.ips.get(ip);
    if (!cur || t - cur.windowStart >= this.cfg.ipWindowMs) {
      this.ips.set(ip, { windowStart: t, count: 1 });
      return;
    }
    cur.count += 1;
  }

  /** Returns whether the subject is now locked. */
  recordSubjectFailure(opts: { channel: string; externalId: string }): {
    locked: boolean;
    failuresInWindow: number;
    until: number;
  } {
    const t = this.now();
    const key = this.subjectKey(opts.channel, opts.externalId);
    const cur =
      this.subjects.get(key) ?? { failuresAt: [], lockedUntil: 0 };
    // Drop failures outside the rolling window.
    cur.failuresAt = cur.failuresAt.filter(
      (ts) => t - ts < this.cfg.subjectFailureWindowMs,
    );
    cur.failuresAt.push(t);
    if (cur.failuresAt.length >= this.cfg.subjectFailureThreshold) {
      cur.lockedUntil = t + this.cfg.subjectLockoutMs;
    }
    this.subjects.set(key, cur);
    return {
      locked: cur.lockedUntil > t,
      failuresInWindow: cur.failuresAt.length,
      until: cur.lockedUntil,
    };
  }

  clearSubject(opts: { channel: string; externalId: string }): void {
    this.subjects.delete(this.subjectKey(opts.channel, opts.externalId));
  }

  /** Test/inspection helper , sizes after retention. */
  size(): { subjects: number; ips: number } {
    return { subjects: this.subjects.size, ips: this.ips.size };
  }

  /**
   * Purge old entries. Call from a periodic prune loop.
   */
  prune(): void {
    const t = this.now();
    for (const [k, v] of this.subjects) {
      const stale =
        v.lockedUntil <= t &&
        v.failuresAt.every(
          (ts) => t - ts >= this.cfg.subjectFailureWindowMs,
        );
      if (stale) this.subjects.delete(k);
    }
    for (const [k, v] of this.ips) {
      if (t - v.windowStart >= this.cfg.ipWindowMs) this.ips.delete(k);
    }
  }

  private subjectKey(channel: string, externalId: string): string {
    return `${channel}::${externalId}`;
  }
}
