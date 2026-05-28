/**
 * Direct sqlite access to the invite_jobs + invite_recipients tables
 * for the bulk-invite feature. Lives in apps/web because the API
 * routes and the background runner both run there; the game-service
 * doesn't need to know about invites.
 *
 * Connections are cached at module scope. We open the DB read-write
 * because the runner needs to write status updates.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database, { type Database as DB } from "better-sqlite3";

let _db: DB | null = null;

function resolveDbPath(): string {
  const explicit = process.env.VTORN_GAME_DB_PATH || process.env.GAME_DB_PATH;
  if (explicit && explicit.length > 0) return explicit;
  // apps/web is launched from its own dir; walk up to repo root.
  const root = resolve(process.cwd(), "..", "..");
  return resolve(root, "apps/game/data/game.db");
}

export function inviteDb(): DB | null {
  if (_db) return _db;
  const p = resolveDbPath();
  if (!existsSync(p)) {
    // eslint-disable-next-line no-console
    console.warn(`[invite/store] game.db not found at ${p}`);
    return null;
  }
  _db = new Database(p);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  // The schema migration is owned by apps/game; we assume it's been
  // applied by the time the web app handles an invite request. The
  // catch path below surfaces a clear error if not.
  try {
    _db.prepare("SELECT 1 FROM invite_jobs LIMIT 1").get();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[invite/store] invite_jobs table missing; restart vtorn-game-prod to run migration 0010_invite_jobs.sql. (${err instanceof Error ? err.message : err})`,
    );
    return null;
  }
  return _db;
}

export interface InviteJobRow {
  id: string;
  syndicate_id: string;
  syndicate_slug: string;
  created_by: string;
  created_by_kind: "owner" | "admin";
  channels: string[];
  message_body: string;
  throttle_ms: number;
  status: "queued" | "running" | "paused" | "done" | "cancelled";
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface InviteRecipientRow {
  id: string;
  job_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_e164: string | null;
  warm_url: string;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  channel_result_json: string;
  seq: number;
  queued_at: number;
  sent_at: number | null;
  error: string | null;
}

function nanoId(prefix: string): string {
  // ~96 bits of entropy via crypto.randomUUID + truncate.
  const r = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
    .replace(/-/g, "");
  return `${prefix}_${r.slice(0, 20)}`;
}

export function createInviteJob(
  db: DB,
  args: {
    syndicateId: string;
    syndicateSlug: string;
    createdBy: string;
    createdByKind: "owner" | "admin";
    channels: ReadonlyArray<"whatsapp" | "email">;
    messageBody: string;
    throttleMs: number;
    recipients: ReadonlyArray<{
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phoneE164: string | null;
      warmUrl: string;
    }>;
  },
): { jobId: string; total: number } {
  const jobId = nanoId("ij");
  const now = Date.now();
  const insertJob = db.prepare(`
    INSERT INTO invite_jobs (id, syndicate_id, syndicate_slug, created_by,
      created_by_kind, channels, message_body, throttle_ms, status, total,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
  `);
  const insertR = db.prepare(`
    INSERT INTO invite_recipients (id, job_id, first_name, last_name, email,
      phone_e164, warm_url, status, seq, queued_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `);
  const tx = db.transaction(() => {
    insertJob.run(
      jobId,
      args.syndicateId,
      args.syndicateSlug,
      args.createdBy,
      args.createdByKind,
      JSON.stringify(args.channels),
      args.messageBody,
      args.throttleMs,
      args.recipients.length,
      now,
      now,
    );
    for (let i = 0; i < args.recipients.length; i += 1) {
      const r = args.recipients[i];
      insertR.run(
        nanoId("ir"),
        jobId,
        r.firstName,
        r.lastName,
        r.email,
        r.phoneE164,
        r.warmUrl,
        i,
        now,
      );
    }
  });
  tx();
  return { jobId, total: args.recipients.length };
}

export function getJob(db: DB, jobId: string): InviteJobRow | null {
  const row = db
    .prepare(`SELECT * FROM invite_jobs WHERE id = ?`)
    .get(jobId) as (InviteJobRow & { channels: string }) | undefined;
  if (!row) return null;
  return { ...row, channels: JSON.parse(row.channels) as string[] } as unknown as InviteJobRow;
}

export function listJobsForSyndicate(
  db: DB,
  syndicateId: string,
  limit = 25,
): InviteJobRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM invite_jobs WHERE syndicate_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(syndicateId, limit) as (InviteJobRow & { channels: string })[];
  return rows.map((r) => ({
    ...r,
    channels: JSON.parse(r.channels) as string[],
  } as unknown as InviteJobRow));
}

export function listRecipients(
  db: DB,
  jobId: string,
  limit = 500,
): InviteRecipientRow[] {
  return db
    .prepare(
      `SELECT * FROM invite_recipients WHERE job_id = ? ORDER BY seq ASC LIMIT ?`,
    )
    .all(jobId, limit) as InviteRecipientRow[];
}

export function setJobStatus(
  db: DB,
  jobId: string,
  next: InviteJobRow["status"],
): boolean {
  const r = db
    .prepare(
      `UPDATE invite_jobs SET status = ?, updated_at = ?, completed_at = CASE WHEN ? IN ('done','cancelled') THEN ? ELSE completed_at END WHERE id = ?`,
    )
    .run(next, Date.now(), next, Date.now(), jobId);
  return r.changes === 1;
}

/**
 * Atomically claim the next queued recipient for any currently-running
 * job. Returns null when there's nothing to do. Used by the runner to
 * coordinate across pm2 cluster workers — SQLite's UPDATE...WHERE is
 * atomic so two racing workers can't claim the same row.
 *
 * Throttle enforcement: we filter to jobs whose most-recent sent row
 * is older than the job's throttle_ms.
 */
export function claimNextRecipient(
  db: DB,
  now: number = Date.now(),
): InviteRecipientRow | null {
  // Find a candidate via the throttle-aware view, then atomically
  // upgrade its status to 'sending' to claim it.
  const candidate = db
    .prepare(
      `SELECT r.id
       FROM invite_recipients r
       JOIN invite_jobs j ON j.id = r.job_id
       WHERE r.status = 'queued'
         AND j.status = 'running'
         AND (
           j.sent = 0 OR
           (
             SELECT COALESCE(MAX(sent_at), 0)
             FROM invite_recipients
             WHERE job_id = j.id AND sent_at IS NOT NULL
           ) + j.throttle_ms <= ?
         )
       ORDER BY r.queued_at ASC
       LIMIT 1`,
    )
    .get(now) as { id: string } | undefined;
  if (!candidate) return null;

  const claim = db
    .prepare(`UPDATE invite_recipients SET status = 'sending' WHERE id = ? AND status = 'queued'`)
    .run(candidate.id);
  if (claim.changes === 0) return null; // raced and lost
  return db
    .prepare(`SELECT * FROM invite_recipients WHERE id = ?`)
    .get(candidate.id) as InviteRecipientRow;
}

export function markRecipientSent(
  db: DB,
  recipientId: string,
  channelResult: Record<string, { status: string; error?: string }>,
): void {
  const now = Date.now();
  const ok =
    Object.values(channelResult).some((c) => c.status === "sent") &&
    !Object.values(channelResult).some((c) => c.status === "failed");
  const anySent = Object.values(channelResult).some((c) => c.status === "sent");
  const status: InviteRecipientRow["status"] = anySent
    ? "sent"
    : Object.values(channelResult).some((c) => c.status === "failed")
      ? "failed"
      : "skipped";
  const errorReason = !ok
    ? Object.entries(channelResult)
        .filter(([, v]) => v.status !== "sent")
        .map(([k, v]) => `${k}:${v.error ?? v.status}`)
        .join("; ")
    : null;

  db.transaction(() => {
    db.prepare(
      `UPDATE invite_recipients
       SET status = ?, sent_at = ?, channel_result_json = ?, error = ?
       WHERE id = ?`,
    ).run(status, now, JSON.stringify(channelResult), errorReason, recipientId);
    const row = db
      .prepare(`SELECT job_id FROM invite_recipients WHERE id = ?`)
      .get(recipientId) as { job_id: string } | undefined;
    if (!row) return;
    // Bump the appropriate counter on the job.
    const col =
      status === "sent" ? "sent" : status === "failed" ? "failed" : "skipped";
    db.prepare(
      `UPDATE invite_jobs SET ${col} = ${col} + 1, updated_at = ? WHERE id = ?`,
    ).run(now, row.job_id);
    // Check if the job is now complete.
    const counts = db
      .prepare(
        `SELECT total, sent, failed, skipped FROM invite_jobs WHERE id = ?`,
      )
      .get(row.job_id) as {
      total: number;
      sent: number;
      failed: number;
      skipped: number;
    };
    if (counts.sent + counts.failed + counts.skipped >= counts.total) {
      db.prepare(
        `UPDATE invite_jobs SET status = 'done', completed_at = ? WHERE id = ? AND status = 'running'`,
      ).run(now, row.job_id);
    }
  })();
}

/** Start a job (queued → running). Idempotent. */
export function startJob(db: DB, jobId: string): boolean {
  return setJobStatus(db, jobId, "running");
}
