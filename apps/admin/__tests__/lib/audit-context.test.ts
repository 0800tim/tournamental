/**
 * writeAudit records the client IP and user agent when a context is
 * supplied, and keeps the old shape when it is not. Writes to a temp
 * file through ADMIN_AUDIT_LOG_PATH, never the real log.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
let auditPath: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "tnm-admin-audit-"));
  auditPath = path.join(dir, "audit.jsonl");
  process.env.ADMIN_AUDIT_LOG_PATH = auditPath;
});

afterAll(async () => {
  delete process.env.ADMIN_AUDIT_LOG_PATH;
  await fs.rm(dir, { recursive: true, force: true });
});

const session = { userId: "u_op", email: "+64****5832", role: "super-admin" as const, exp: 0 } as unknown as import("@/lib/auth").AdminSession;

describe("writeAudit with request context", () => {
  it("adds ip and ua to the entry", async () => {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit(session, { action: "pii.reveal", target: "u_42", reason: "email" }, { ip: "203.0.113.9", userAgent: "UA/1" });
    const lines = (await fs.readFile(auditPath, "utf8")).trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last).toMatchObject({ action: "pii.reveal", target: "u_42", reason: "email", ip: "203.0.113.9", ua: "UA/1", actor: "+64****5832" });
    expect(last.ts).toMatch(/^\d{4}-/);
  });

  it("omits ip and ua when no context is given, keeping the old shape", async () => {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit(session, { action: "user.unban", target: "u_43" });
    const lines = (await fs.readFile(auditPath, "utf8")).trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last).not.toHaveProperty("ip");
    expect(last).not.toHaveProperty("ua");
  });
});
