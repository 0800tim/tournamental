import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir = "";
let auditPath = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vtorn-audit-"));
  process.env.ADMIN_OPS_DATA_DIR = tmpDir;
  auditPath = path.join(tmpDir, "audit.jsonl");
  process.env.ADMIN_AUDIT_LOG_PATH = auditPath;
  await fs.writeFile(
    path.join(tmpDir, "operators.jsonl"),
    JSON.stringify({
      slug: "polymarket",
      name: "Polymarket",
      kind: "prediction-market",
      affiliate_url_pattern: "https://polymarket.com/?ref={code}",
      geo_allow: ["US"],
      geo_deny: ["NZ"],
      revenue_share_pct: 35,
      status: "active",
      clicks_7d: 100,
      conversions_7d: 5,
      revenue_units_7d: 250,
      contact_email: "a@b.com",
      notes: "",
      updated_at: "2026-05-01T00:00:00.000Z",
    }) + "\n",
  );
});

afterEach(async () => {
  delete process.env.ADMIN_OPS_DATA_DIR;
  delete process.env.ADMIN_AUDIT_LOG_PATH;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function freshModules() {
  vi.resetModules();
  const store = (await import("@/lib/ops-store")) as typeof import("@/lib/ops-store");
  const audit = (await import("@/lib/audit")) as typeof import("@/lib/audit");
  return { store, audit };
}

describe("ops audit-log integration", () => {
  it("writeAudit appends a JSONL entry with actor + diff", async () => {
    const { store, audit } = await freshModules();
    const { before, after } = await store.patchOperator("polymarket", {
      revenue_share_pct: 50,
    });
    const diff = store.shallowDiff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );
    await audit.writeAudit(
      {
        email: "tim@tournamental.com",
        role: "super-admin",
        iat: 0,
        exp: 0,
      },
      {
        action: "operator.patch",
        target: "operator:polymarket",
        before: diff.before,
        after: diff.after,
      },
    );
    const raw = await fs.readFile(auditPath, "utf-8");
    const entry = JSON.parse(raw.trim().split("\n").pop()!);
    expect(entry.actor).toBe("tim@tournamental.com");
    expect(entry.role).toBe("super-admin");
    expect(entry.action).toBe("operator.patch");
    expect(entry.target).toBe("operator:polymarket");
    expect(entry.before).toEqual({ revenue_share_pct: 35 });
    expect(entry.after).toEqual({ revenue_share_pct: 50 });
  });
});
