/**
 * In-memory OTP code store.
 *
 * 5-minute TTL, single-use, keyed by (channel, externalId). When a user
 * sends "log in" from Discord and again from Telegram we treat them as
 * two separate codes; each platform identity is its own login attempt.
 *
 * The store also handles email magic-link click tokens — same TTL
 * (5 min), same single-use semantics, but the value is a long random
 * string instead of a 6-digit code.
 *
 * Multi-instance: this is in-memory and therefore single-instance.
 * When dm-otp is horizontally scaled we'll move this to Redis with
 * SETEX + Lua-script pop-on-verify. The interface below is the
 * abstraction boundary.
 */

import { hashOtp, safeEqualHex } from '../otp.js';

export interface CodeRecord {
  channel: string;
  /** Stable platform-specific id for the sender (chat id, user id, email). */
  externalId: string;
  /** Hashed code (HMAC). Plaintext code is never stored. */
  hash: string;
  /** Number of failed verify attempts. */
  attempts: number;
  /** Unix ms expiry. */
  expiresAt: number;
  /** Optional opaque data — e.g. email subject for replay-protection. */
  meta?: Record<string, string>;
}

export interface CodeStoreOptions {
  /** TTL for a freshly issued code, in seconds. Default 300 (5 min). */
  ttlSeconds?: number;
  /** Maximum failed verify attempts before the record is wiped. */
  maxAttempts?: number;
  /** Hash secret for safe storage. */
  secret: string;
  /** Clock injection for tests. */
  now?: () => number;
}

export class CodeStore {
  private readonly map = new Map<string, CodeRecord>();
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly secret: string;
  private readonly now: () => number;

  constructor(opts: CodeStoreOptions) {
    this.ttlMs = (opts.ttlSeconds ?? 300) * 1000;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.secret = opts.secret;
    this.now = opts.now ?? (() => Date.now());
  }

  private key(channel: string, externalId: string): string {
    return `${channel}::${externalId}`;
  }

  /**
   * Insert or overwrite the code for (channel, externalId). Returns the
   * record's expiry. Caller is responsible for delivering the plaintext
   * code over the channel.
   */
  put(opts: {
    channel: string;
    externalId: string;
    code: string;
    meta?: Record<string, string>;
  }): { expiresAt: number } {
    const expiresAt = this.now() + this.ttlMs;
    const hash = hashOtp({
      code: opts.code,
      channel: opts.channel,
      externalId: opts.externalId,
      secret: this.secret,
    });
    this.map.set(this.key(opts.channel, opts.externalId), {
      channel: opts.channel,
      externalId: opts.externalId,
      hash,
      attempts: 0,
      expiresAt,
      meta: opts.meta,
    });
    return { expiresAt };
  }

  /** Lookup by channel + externalId. Used internally + by tests. */
  peek(channel: string, externalId: string): CodeRecord | undefined {
    const rec = this.map.get(this.key(channel, externalId));
    if (!rec) return undefined;
    if (rec.expiresAt < this.now()) {
      this.map.delete(this.key(channel, externalId));
      return undefined;
    }
    return rec;
  }

  /**
   * Verify a candidate code. Returns the consumed record on match,
   * which the caller can use to mint a session JWT. Single-use:
   * record is removed on match.
   */
  verify(opts: {
    channel: string;
    externalId: string;
    code: string;
  }): { ok: true; record: CodeRecord } | { ok: false; reason: VerifyError } {
    const k = this.key(opts.channel, opts.externalId);
    const rec = this.map.get(k);
    if (!rec) return { ok: false, reason: 'not-found' };
    if (rec.expiresAt < this.now()) {
      this.map.delete(k);
      return { ok: false, reason: 'expired' };
    }
    if (rec.attempts >= this.maxAttempts) {
      this.map.delete(k);
      return { ok: false, reason: 'too-many-attempts' };
    }
    const candidate = hashOtp({
      code: opts.code,
      channel: opts.channel,
      externalId: opts.externalId,
      secret: this.secret,
    });
    if (!safeEqualHex(candidate, rec.hash)) {
      rec.attempts += 1;
      if (rec.attempts >= this.maxAttempts) {
        this.map.delete(k);
        return { ok: false, reason: 'too-many-attempts' };
      }
      return { ok: false, reason: 'mismatch' };
    }
    this.map.delete(k);
    return { ok: true, record: rec };
  }

  /**
   * Verify by code-only lookup (used by email magic-link path where
   * the click URL only carries the token, not the email address).
   * O(n) over the in-memory map; fine at expected volumes.
   */
  verifyByToken(opts: {
    channel: string;
    code: string;
  }): { ok: true; record: CodeRecord } | { ok: false; reason: VerifyError } {
    for (const [k, rec] of this.map) {
      if (rec.channel !== opts.channel) continue;
      if (rec.expiresAt < this.now()) {
        this.map.delete(k);
        continue;
      }
      const candidate = hashOtp({
        code: opts.code,
        channel: rec.channel,
        externalId: rec.externalId,
        secret: this.secret,
      });
      if (safeEqualHex(candidate, rec.hash)) {
        this.map.delete(k);
        return { ok: true, record: rec };
      }
    }
    return { ok: false, reason: 'not-found' };
  }

  /** Remove all expired records. Call periodically. */
  prune(): number {
    let removed = 0;
    const now = this.now();
    for (const [k, rec] of this.map) {
      if (rec.expiresAt < now) {
        this.map.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  /** Test helper: number of records currently stored. */
  size(): number {
    return this.map.size;
  }

  /** Test helper: wipe all records. */
  clear(): void {
    this.map.clear();
  }
}

export type VerifyError =
  | 'not-found'
  | 'expired'
  | 'mismatch'
  | 'too-many-attempts';
