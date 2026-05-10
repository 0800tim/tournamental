/**
 * Append-only JSONL audit log for published posts.
 *
 * Each line is a serialised `PostRecord`. The file is opened in append mode
 * with an exclusive write per call so we don't trash an existing log on
 * crash. There is no truncation, rotation, or compaction in v0.1 — when this
 * service moves to Postgres, the bridge writer will tail this file and
 * upsert into a `posts` table.
 *
 * The log is intentionally simple: no schema migrations, no header line.
 * Anything that read-parses the file MUST tolerate older PostRecord shapes
 * (extra keys on newer rows, missing keys on older ones).
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { PostRecord } from '../types.js';

export class AuditLog {
  constructor(private readonly path: string) {}

  /** Append one record. Creates the parent directory if missing. */
  async append(record: PostRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(record) + '\n', 'utf8');
  }

  /**
   * Read every record. Tolerant of partial last-line writes (the line is
   * skipped if it doesn't parse). Returns [] if the file does not exist
   * yet.
   */
  async readAll(): Promise<PostRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: PostRecord[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as PostRecord);
      } catch {
        // partial / corrupt line — skip; v0.2 will checksum each row.
      }
    }
    return out;
  }
}
