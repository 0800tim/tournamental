/**
 * In-memory storage with JSONL append-only persistence.
 *
 * v0.1 only — Postgres comes later (doc 22 hot-path budget). The two
 * JSONL files (`identity-links.jsonl`, `humanness-scores.jsonl`) are
 * append-only and replayed on boot, so concurrent writers should never
 * truncate them. Reads stay in-memory.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ProviderId, ProviderProfile } from './providers/index.js';

export interface IdentityLinkRecord {
  userId: string;
  provider: ProviderId;
  externalId: string;
  linkedAt: number;
  lastSeenAt: number;
  profile?: Partial<ProviderProfile>;
}

export interface HumannessSnapshot {
  userId: string;
  score: number;
  factors: HumannessFactor[];
  computedAt: number;
}

export interface HumannessFactor {
  id: string;
  weight: number;
  value: number;
  contribution: number;
  note?: string;
}

export interface StorageOptions {
  linksPath: string;
  scoresPath: string;
  /** Allow tests to skip file IO entirely. */
  ephemeral?: boolean;
}

export class Storage {
  private readonly linksPath: string;
  private readonly scoresPath: string;
  private readonly ephemeral: boolean;
  /** keyed by `${userId}:${provider}` so re-link is idempotent. */
  private links = new Map<string, IdentityLinkRecord>();
  /** latest snapshot per user. */
  private scores = new Map<string, HumannessSnapshot>();

  constructor(opts: StorageOptions) {
    this.linksPath = opts.linksPath;
    this.scoresPath = opts.scoresPath;
    this.ephemeral = opts.ephemeral ?? false;
    if (!this.ephemeral) {
      this.ensureDirs();
      this.replay();
    }
  }

  private ensureDirs(): void {
    for (const p of [this.linksPath, this.scoresPath]) {
      const d = dirname(p);
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  private replay(): void {
    if (existsSync(this.linksPath)) {
      const raw = readFileSync(this.linksPath, 'utf8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const rec = JSON.parse(trimmed) as IdentityLinkRecord;
          this.links.set(linkKey(rec.userId, rec.provider), rec);
        } catch {
          /* skip corrupted line */
        }
      }
    }
    if (existsSync(this.scoresPath)) {
      const raw = readFileSync(this.scoresPath, 'utf8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const snap = JSON.parse(trimmed) as HumannessSnapshot;
          // Keep latest snapshot per user (file is append-only).
          const prior = this.scores.get(snap.userId);
          if (!prior || snap.computedAt >= prior.computedAt) {
            this.scores.set(snap.userId, snap);
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  upsertLink(rec: IdentityLinkRecord): IdentityLinkRecord {
    const key = linkKey(rec.userId, rec.provider);
    const prior = this.links.get(key);
    const merged: IdentityLinkRecord = prior
      ? { ...prior, ...rec, linkedAt: prior.linkedAt, lastSeenAt: rec.lastSeenAt }
      : rec;
    this.links.set(key, merged);
    if (!this.ephemeral) {
      appendFileSync(this.linksPath, JSON.stringify(merged) + '\n');
    }
    return merged;
  }

  listLinks(userId: string): IdentityLinkRecord[] {
    const out: IdentityLinkRecord[] = [];
    for (const v of this.links.values()) {
      if (v.userId === userId) out.push(v);
    }
    return out.sort((a, b) => a.linkedAt - b.linkedAt);
  }

  saveScore(snap: HumannessSnapshot): HumannessSnapshot {
    this.scores.set(snap.userId, snap);
    if (!this.ephemeral) {
      appendFileSync(this.scoresPath, JSON.stringify(snap) + '\n');
    }
    return snap;
  }

  getScore(userId: string): HumannessSnapshot | undefined {
    return this.scores.get(userId);
  }
}

function linkKey(userId: string, provider: ProviderId): string {
  return `${userId}:${provider}`;
}
