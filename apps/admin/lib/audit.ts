/**
 * Append-only audit log writer.
 *
 * v0 stores entries in-memory plus a JSONL file (for crash safety) under
 * `.admin-audit.jsonl` in the project root. The real implementation will
 * post to apps/api `/v1/admin/audit-log` which writes a Postgres row;
 * see `apps/api/migrations/0001_admin_tables.sql` in this PR.
 *
 * Every state-changing admin action must call `writeAudit()` *after* the
 * upstream call succeeds. Keep the payload small — never include raw PII
 * or secrets in `before` / `after`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AdminSession } from "./auth";

export interface AuditWrite {
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

const AUDIT_PATH = process.env.ADMIN_AUDIT_LOG_PATH
  ?? path.join(process.cwd(), ".admin-audit.jsonl");

export async function writeAudit(session: AdminSession, write: AuditWrite): Promise<void> {
  const entry = {
    id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    actor: session.email,
    role: session.role,
    ...write,
  };
  try {
    await fs.appendFile(AUDIT_PATH, JSON.stringify(entry) + "\n", { encoding: "utf-8" });
  } catch (err) {
    // Audit must never fail loud and stop a successful action; log to stderr.
    // eslint-disable-next-line no-console
    console.error("[audit] failed to append:", err);
  }
}
