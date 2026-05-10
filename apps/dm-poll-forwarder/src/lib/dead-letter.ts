/**
 * Append-only dead-letter queue for forwards that exhausted retries.
 *
 * Stored as JSONL at `data/forward-failed.jsonl`. The admin
 * `replay-failed` endpoint re-reads and re-attempts each entry, then
 * truncates the file on success.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type { Channel, PollMessage } from '../types.js';

export interface DeadLetterEntry {
  channel: Channel;
  message: PollMessage;
  attempts: number;
  lastStatus: number;
  lastError: string;
  enqueuedAt: number;
}

export class DeadLetterQueue {
  constructor(private readonly path: string) {}

  async push(entry: DeadLetterEntry): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.appendFile(this.path, JSON.stringify(entry) + '\n', 'utf8');
  }

  /** Read all entries; ignores malformed lines. */
  async drain(): Promise<DeadLetterEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: DeadLetterEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as DeadLetterEntry);
      } catch {
        // Skip malformed lines.
      }
    }
    return out;
  }

  /** Replace the file contents with the given entries (used after a partial replay). */
  async rewrite(entries: DeadLetterEntry[]): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    const body = entries.map((e) => JSON.stringify(e)).join('\n');
    const tmp = this.path + '.tmp';
    await fs.writeFile(tmp, body ? body + '\n' : '', 'utf8');
    await fs.rename(tmp, this.path);
  }

  async clear(): Promise<void> {
    await this.rewrite([]);
  }

  async size(): Promise<number> {
    return (await this.drain()).length;
  }
}
