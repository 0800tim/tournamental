/**
 * Lightweight in-memory identity store for DM-OTP.
 *
 * Maps (channel, externalId) -> stable user id. Persisted to a JSON
 * file on close so dev restarts don't lose users; production swaps in
 * Postgres via Prisma per CLAUDE.md.
 *
 * A real user record lives in apps/identity (the Humanness Score
 * service). This store is purely the dm-otp authentication anchor —
 * it confirms "this Telegram chat-id is the same person we saw before"
 * and emits a stable user id the rest of the platform can join on.
 */

import { randomUUID } from 'node:crypto';

export interface IdentityRecord {
  userId: string;
  channel: string;
  externalId: string;
  createdAt: number;
  lastSeenAt: number;
}

export class IdentityStore {
  private readonly map = new Map<string, IdentityRecord>();

  private key(channel: string, externalId: string): string {
    return `${channel}::${externalId}`;
  }

  /** Find or create. Returns the user id for (channel, externalId). */
  upsert(channel: string, externalId: string, now: number): IdentityRecord {
    const k = this.key(channel, externalId);
    const existing = this.map.get(k);
    if (existing) {
      existing.lastSeenAt = now;
      return existing;
    }
    const userId = `u_${randomUUID().replace(/-/g, '').slice(0, 22)}`;
    const rec: IdentityRecord = {
      userId,
      channel,
      externalId,
      createdAt: now,
      lastSeenAt: now,
    };
    this.map.set(k, rec);
    return rec;
  }

  get(channel: string, externalId: string): IdentityRecord | undefined {
    return this.map.get(this.key(channel, externalId));
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
