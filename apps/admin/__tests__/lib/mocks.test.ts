import { describe, it, expect } from "vitest";
import {
  mockOverview,
  mockUsers,
  mockSyndicates,
  mockTournaments,
  mockFunnel,
  mockFlags,
  mockApiKeys,
  mockAuditLog,
  mockAffiliate,
} from "@/lib/mocks";

describe("mocks", () => {
  it("overview has the documented fields from docs/23", () => {
    const o = mockOverview();
    expect(o.dau).toBeGreaterThan(0);
    expect(o.signups_7d).toHaveLength(7);
    expect(o.by_country.length).toBeGreaterThan(0);
  });

  it("users mock filters by query", () => {
    const r = mockUsers("aroha", 1);
    expect(r.rows.every((row) => row.display_name.toLowerCase().includes("aroha"))).toBe(true);
  });

  it("syndicates mock filters by status", () => {
    const r = mockSyndicates("", "active");
    expect(r.rows.every((row) => row.status === "active")).toBe(true);
  });

  it("tournaments mock returns at least one active", () => {
    const r = mockTournaments();
    expect(r.rows.some((t) => t.status === "active")).toBe(true);
  });

  it("funnel mock has monotonically non-increasing user counts", () => {
    const r = mockFunnel();
    for (let i = 1; i < r.steps.length; i++) {
      expect(r.steps[i].users).toBeLessThanOrEqual(r.steps[i - 1].users);
    }
  });

  it("affiliate mock conversions <= total clicks", () => {
    const r = mockAffiliate("7d");
    expect(r.conversions).toBeLessThanOrEqual(r.total_clicks);
  });

  it("flags mock includes geo_overrides shape", () => {
    const r = mockFlags();
    expect(r.rows[0].geo_overrides).toBeTypeOf("object");
  });

  it("api keys mock never includes plaintext", () => {
    const r = mockApiKeys();
    for (const k of r.rows) {
      expect(k.prefix).toMatch(/^vt_/);
      // shape contract: no `secret` field present.
      expect((k as any).secret).toBeUndefined();
    }
  });

  it("audit log mock entries have iso timestamps and required fields", () => {
    const r = mockAuditLog();
    for (const a of r.rows) {
      expect(a.id).toBeTruthy();
      expect(a.actor).toBeTruthy();
      expect(a.action).toBeTruthy();
      expect(() => new Date(a.ts).toISOString()).not.toThrow();
    }
  });
});
