import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Stable fresh dir per test file run.
let tmpDir = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vtorn-ops-"));
  process.env.ADMIN_OPS_DATA_DIR = tmpDir;
  // Seed three operators (one sportsbook compliant, one prediction-market,
  // one sportsbook intentionally non-compliant for negative test).
  const ops = [
    {
      slug: "polymarket",
      name: "Polymarket",
      kind: "prediction-market",
      affiliate_url_pattern: "https://polymarket.com/?ref={code}",
      geo_allow: ["US", "CA"],
      geo_deny: ["NZ"],
      revenue_share_pct: 35,
      status: "active",
      clicks_7d: 100,
      conversions_7d: 5,
      revenue_units_7d: 250,
      contact_email: "a@b.com",
      notes: "",
      updated_at: "2026-05-01T00:00:00.000Z",
    },
    {
      slug: "bet365",
      name: "Bet365",
      kind: "sportsbook",
      affiliate_url_pattern: "https://bet365.com/?affiliate={code}",
      geo_allow: ["GB"],
      geo_deny: ["NZ"],
      revenue_share_pct: 40,
      status: "active",
      clicks_7d: 200,
      conversions_7d: 10,
      revenue_units_7d: 500,
      contact_email: "a@b.com",
      notes: "",
      updated_at: "2026-05-01T00:00:00.000Z",
    },
  ];
  await fs.writeFile(
    path.join(tmpDir, "operators.jsonl"),
    ops.map((o) => JSON.stringify(o)).join("\n") + "\n",
  );
  // Reset module cache so the store reads our fresh env var.
  // (vitest imports happen at top-level otherwise.)
});

afterEach(async () => {
  delete process.env.ADMIN_OPS_DATA_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function freshStore() {
  // Bust the import cache so ROOT picks up env each test.
  vi.resetModules();
  return (await import("@/lib/ops-store")) as typeof import("@/lib/ops-store");
}

describe("ops-store compliance", () => {
  it("operatorComplianceError fails when sportsbook lacks NZ in geo_deny", async () => {
    const { operatorComplianceError } = await freshStore();
    const r = operatorComplianceError({
      slug: "x",
      name: "X",
      kind: "sportsbook",
      affiliate_url_pattern: "",
      geo_allow: ["GB"],
      geo_deny: ["US"],
      revenue_share_pct: 40,
      status: "active",
      clicks_7d: 0,
      conversions_7d: 0,
      revenue_units_7d: 0,
      contact_email: "",
      notes: "",
      updated_at: "",
    });
    expect(r).toMatch(/NZ/);
    expect(r).toMatch(/TAB/);
  });

  it("operatorComplianceError passes when sportsbook denies NZ", async () => {
    const { operatorComplianceError } = await freshStore();
    const r = operatorComplianceError({
      slug: "x",
      name: "X",
      kind: "sportsbook",
      affiliate_url_pattern: "",
      geo_allow: ["GB"],
      geo_deny: ["NZ"],
      revenue_share_pct: 40,
      status: "active",
      clicks_7d: 0,
      conversions_7d: 0,
      revenue_units_7d: 0,
      contact_email: "",
      notes: "",
      updated_at: "",
    });
    expect(r).toBeNull();
  });

  it("operatorComplianceError flags overlapping allow/deny", async () => {
    const { operatorComplianceError } = await freshStore();
    const r = operatorComplianceError({
      slug: "x",
      name: "X",
      kind: "prediction-market",
      affiliate_url_pattern: "",
      geo_allow: ["NZ"],
      geo_deny: ["NZ"],
      revenue_share_pct: 35,
      status: "active",
      clicks_7d: 0,
      conversions_7d: 0,
      revenue_units_7d: 0,
      contact_email: "",
      notes: "",
      updated_at: "",
    });
    expect(r).toMatch(/both/);
  });

  it("patchOperator writes compliant changes and returns diff", async () => {
    const { patchOperator } = await freshStore();
    const { before, after } = await patchOperator("polymarket", {
      revenue_share_pct: 50,
    });
    expect(before.revenue_share_pct).toBe(35);
    expect(after.revenue_share_pct).toBe(50);
  });

  it("patchOperator throws compliance error if NZ removed from sportsbook deny list", async () => {
    const { patchOperator } = await freshStore();
    await expect(
      patchOperator("bet365", { geo_deny: ["US"] }),
    ).rejects.toThrow(/NZ/);
  });

  it("patchOperator allows changing kind to prediction-market and dropping NZ", async () => {
    const { patchOperator } = await freshStore();
    const { after } = await patchOperator("bet365", {
      kind: "prediction-market",
      geo_deny: [],
    });
    expect(after.kind).toBe("prediction-market");
    expect(after.geo_deny).toEqual([]);
  });

  it("patchOperator on missing slug throws not_found", async () => {
    const { patchOperator } = await freshStore();
    await expect(patchOperator("does-not-exist", {})).rejects.toThrow(/not_found/);
  });

  it("shallowDiff returns only changed keys, ignoring updated_at", async () => {
    const { shallowDiff } = await freshStore();
    const a = { a: 1, b: 2, updated_at: "x" };
    const b = { a: 1, b: 99, updated_at: "y" };
    const d = shallowDiff(a, b);
    expect(d.before).toEqual({ b: 2 });
    expect(d.after).toEqual({ b: 99 });
  });
});
