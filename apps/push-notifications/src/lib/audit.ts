/**
 * Append-only audit log for the push-notifications service.
 *
 * Every adapter `send` call writes a JSONL record here so we have a clean
 * trail of "what would have been delivered" while the channel adapters are
 * still stubbed. In production these adapter calls swap to real network I/O
 * but the audit log stays — operators tail it to debug delivery issues.
 *
 * Format: one JSON object per line, newline-terminated. Keys:
 *   ts          ISO-8601 timestamp
 *   channel     "web-push" | "telegram" | "sms"
 *   userId      target user id
 *   event       one of "kickoff_soon", "match_result", "leaderboard_move",
 *               "subscribe", "unsubscribe", "schedule"
 *   payload     channel-specific body (string or object)
 *   ok          boolean — did the adapter accept the send?
 *   note        optional human-readable note (e.g. "stub: not actually sent")
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export type AuditChannel =
  | 'web-push'
  | 'telegram'
  | 'sms'
  | 'whatsapp'
  | 'system';
export type AuditEvent =
  | 'kickoff_soon'
  | 'match_result'
  | 'leaderboard_move'
  | 'subscribe'
  | 'unsubscribe'
  | 'schedule'
  | 'reschedule';

export interface AuditRecord {
  ts: string;
  channel: AuditChannel;
  userId: string;
  event: AuditEvent;
  payload: unknown;
  ok: boolean;
  note?: string;
}

export interface AuditLogger {
  append(record: Omit<AuditRecord, 'ts'>): Promise<void>;
  read(): Promise<AuditRecord[]>;
  clear(): Promise<void>;
}

/**
 * JSONL audit logger. Buffered via Node's append flag for atomicity.
 */
export class FileAuditLogger implements AuditLogger {
  constructor(private readonly path: string) {}

  async append(record: Omit<AuditRecord, 'ts'>): Promise<void> {
    const full: AuditRecord = { ts: new Date().toISOString(), ...record };
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.appendFile(this.path, JSON.stringify(full) + '\n', 'utf8');
  }

  async read(): Promise<AuditRecord[]> {
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      return raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as AuditRecord);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

/**
 * Tee logger — appends every record to every wrapped logger in order.
 * Used so a channel-specific audit log (e.g. data/whatsapp-audit.jsonl)
 * can mirror its writes into the main data/audit.jsonl trail.
 */
export class TeeAuditLogger implements AuditLogger {
  constructor(private readonly children: AuditLogger[]) {}

  async append(record: Omit<AuditRecord, 'ts'>): Promise<void> {
    for (const child of this.children) {
      await child.append(record);
    }
  }

  async read(): Promise<AuditRecord[]> {
    if (this.children[0]) return this.children[0].read();
    return [];
  }

  async clear(): Promise<void> {
    for (const child of this.children) {
      await child.clear();
    }
  }
}

/**
 * In-memory audit logger for tests. Holds a list and never touches disk.
 */
export class MemoryAuditLogger implements AuditLogger {
  public readonly records: AuditRecord[] = [];

  async append(record: Omit<AuditRecord, 'ts'>): Promise<void> {
    this.records.push({ ts: new Date().toISOString(), ...record });
  }

  async read(): Promise<AuditRecord[]> {
    return [...this.records];
  }

  async clear(): Promise<void> {
    this.records.length = 0;
  }
}
