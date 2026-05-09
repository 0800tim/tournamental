/**
 * Geo-gating unit tests for `lib/odds/geo.ts`.
 *
 * Per `docs/30 § Geo-gating`:
 *   - NZ + AU: hide the affiliate CTA entirely.
 *   - UK / GB: softened "view market" link.
 *   - US / EU / null: full CTA. Wait — null is "hidden" failsafe per
 *     the comment in geo.ts (so that an undetected country never leaks
 *     a CTA to a restricted user).
 */

import { describe, it, expect } from "vitest";

import {
  affiliateCtaMode,
  buildPolymarketDeepLink,
  POLYMARKET_BLOCKED_COUNTRIES,
  readCountryFromHeaders,
} from "../lib/odds/geo";

describe("affiliateCtaMode", () => {
  it("hides for NZ", () => {
    expect(affiliateCtaMode("NZ")).toBe("hidden");
  });

  it("hides for AU", () => {
    expect(affiliateCtaMode("AU")).toBe("hidden");
  });

  it("softens for GB / UK", () => {
    expect(affiliateCtaMode("GB")).toBe("softened");
    expect(affiliateCtaMode("UK")).toBe("softened");
  });

  it("returns full for US", () => {
    expect(affiliateCtaMode("US")).toBe("full");
  });

  it("hides when country is null/empty (failsafe)", () => {
    expect(affiliateCtaMode(null)).toBe("hidden");
    expect(affiliateCtaMode(undefined)).toBe("hidden");
    expect(affiliateCtaMode("")).toBe("hidden");
  });

  it("normalises lowercase / whitespace input", () => {
    expect(affiliateCtaMode("  nz  ")).toBe("hidden");
    expect(affiliateCtaMode("us")).toBe("full");
  });

  it("blocked-list is non-empty (regulatory must-have)", () => {
    expect(POLYMARKET_BLOCKED_COUNTRIES.size).toBeGreaterThan(0);
    expect(POLYMARKET_BLOCKED_COUNTRIES.has("NZ")).toBe(true);
  });
});

describe("readCountryFromHeaders", () => {
  it("reads cf-ipcountry first", () => {
    const h = {
      get(name: string) {
        return name === "cf-ipcountry" ? "NZ" : null;
      },
    };
    expect(readCountryFromHeaders(h)).toBe("NZ");
  });

  it("falls back to x-vercel-ip-country", () => {
    const h = {
      get(name: string) {
        if (name === "x-vercel-ip-country") return "DE";
        return null;
      },
    };
    expect(readCountryFromHeaders(h)).toBe("DE");
  });

  it("returns null when nothing is set", () => {
    expect(readCountryFromHeaders({ get: () => null })).toBeNull();
  });
});

describe("buildPolymarketDeepLink", () => {
  it("includes the source tag", () => {
    const url = buildPolymarketDeepLink({ source: "test-surface", marketId: "abc" });
    expect(url).toContain("/api/affiliate/polymarket/click");
    expect(url).toContain("s=test-surface");
    expect(url).toContain("market=abc");
  });

  it("works without any options", () => {
    const url = buildPolymarketDeepLink({});
    expect(url).toContain("/api/affiliate/polymarket/click");
  });
});
