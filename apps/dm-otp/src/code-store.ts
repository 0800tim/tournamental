/**
 * In-memory pending-OTP store.
 *
 * Keyed by the 6-digit code itself. Codes are minted at random from a
 * 1M-entry space, expire in 5 min, and are single-use — collisions are
 * vanishingly unlikely at our throughput (a handful of pending codes at
 * a time). On the off-chance a collision happens at mint we re-roll up
 * to a few times; if that fails the request fails and the user retries.
 *
 * TODO(redis): persist this in Redis once we deploy more than one
 * instance. Today the dm-otp service is single-instance so an in-process
 * Map is fine and a lot faster. Schema for the future migration:
 *   key:   "dm-otp:code:{code}"
 *   value: JSON({channel, externalId, profile, createdAt, expiresAt, used})
 *   ttl:   <expiresAt - createdAt> seconds, plus a short grace
 */

import type { DmChannel } from './jwt.js';

export interface PendingCode {
  channel: DmChannel;
  /** Channel-specific user ID (Telegram chat id, WA jid, Meta PSID/IGSID). */
  externalId: string;
  /** Optional profile snapshot we captured from the inbound webhook. */
  profile?: {
    displayName?: string;
    username?: string;
    phone?: string;
  };
  createdAt: number; // unix ms
  expiresAt: number; // unix ms
  /** Set true the first time the code is used; subsequent verifies 401. */
  used: boolean;
}

export interface CodeStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

export class CodeStore {
  private readonly map = new Map<string, PendingCode>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: CodeStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  ttlSeconds(): number {
    return Math.floor(this.ttlMs / 1000);
  }

  /**
   * Insert a freshly generated code. The caller is responsible for
   * ensuring the code is unique (we collide-check here and return false
   * on conflict so the caller re-rolls).
   */
  put(
    code: string,
    record: Omit<PendingCode, 'createdAt' | 'expiresAt' | 'used'>,
  ): boolean {
    this.pruneExpired();
    if (this.map.has(code)) return false;
    const now = this.now();
    this.map.set(code, {
      ...record,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      used: false,
    });
    return true;
  }

  /**
   * Atomically claim a code: returns the record if it exists, hasn't
   * expired, and hasn't been used; marks it used; returns null otherwise.
   */
  claim(code: string): PendingCode | null {
    this.pruneExpired();
    const rec = this.map.get(code);
    if (!rec) return null;
    if (rec.used) return null;
    if (rec.expiresAt < this.now()) {
      this.map.delete(code);
      return null;
    }
    rec.used = true;
    // Keep the record around until expiry so a replay reads `used:true`
    // rather than a missing key (same 401 either way; cleaner for audit).
    return { ...rec };
  }

  /** Purge expired entries. Idempotent; called opportunistically. */
  pruneExpired(): void {
    const t = this.now();
    for (const [code, rec] of this.map) {
      if (rec.expiresAt < t) this.map.delete(code);
    }
  }

  /** Test/admin only. */
  size(): number {
    return this.map.size;
  }

  /** Test/admin only. */
  peek(code: string): PendingCode | null {
    const r = this.map.get(code);
    return r ? { ...r } : null;
  }

  /** Test/admin only — used by tests to fast-forward. */
  forceExpire(code: string): void {
    const r = this.map.get(code);
    if (r) r.expiresAt = this.now() - 1;
  }
}
