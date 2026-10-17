/**
 * lib/security/headers.mjs, the header set next.config.mjs ships for
 * every host mode. Pure functions, no server. The per-host-mode cases
 * pin the shapes the host-modes runbook curls: play (live or hub),
 * the fwc2026 archive, and the partner embed.
 */
import { describe, expect, it } from "vitest";

import {
  NO_FRAMING_HEADERS,
  baseSecurityHeaders,
  contentSecurityPolicy,
  framingAllowed,
  headersFor,
  securityHeaderRules,
} from "@/lib/security/headers.mjs";

function get(headers: Array<{ key: string; value: string }>, key: string): string | undefined {
  return headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

function directive(csp: string, name: string): string[] {
  const d = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name} `));
  return d ? d.slice(name.length + 1).split(" ") : [];
}

describe("base headers on every response", () => {
  const base = baseSecurityHeaders();

  it("sets nosniff, referrer policy and a denying Permissions-Policy", () => {
    expect(get(base, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(base, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    const pp = get(base, "Permissions-Policy")!;
    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(pp).toContain(`${feature}=()`);
    }
  });

  it("ships the CSP as report-only, never enforcing", () => {
    expect(get(base, "Content-Security-Policy-Report-Only")).toBeTruthy();
    expect(get(base, "Content-Security-Policy")).toBeUndefined();
  });

  it("does not set HSTS (Cloudflare owns it at the zone)", () => {
    expect(get(base, "Strict-Transport-Security")).toBeUndefined();
  });
});

describe("report-only Content Security Policy", () => {
  const prod = contentSecurityPolicy();

  it("allows the 3D renderer and browser-swarm workers from blob:", () => {
    expect(directive(prod, "worker-src")).toContain("blob:");
    expect(directive(prod, "script-src")).toContain("blob:");
  });

  it("allows the GTM inline bootstrap, script and noscript iframe", () => {
    expect(directive(prod, "script-src")).toContain("'unsafe-inline'");
    expect(directive(prod, "script-src")).toContain("https://www.googletagmanager.com");
    expect(directive(prod, "frame-src")).toContain("https://www.googletagmanager.com");
    expect(directive(prod, "connect-src")).toContain("https://www.google-analytics.com");
  });

  it("allows fetches to auth-sms, odds, the game service and the producer stream", () => {
    const connect = directive(prod, "connect-src");
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://auth.tournamental.com");
    expect(connect).toContain("https://odds.tournamental.com");
    expect(connect).toContain("https://game.tournamental.com");
    expect(connect).toContain("wss://stream.tournamental.com");
  });

  it("lets the magic-link and OTP forms post to auth-sms", () => {
    expect(directive(prod, "form-action")).toEqual(["'self'", "https://auth.tournamental.com"]);
  });

  it("blocks plugins and base tag hijacks", () => {
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(directive(prod, "base-uri")).toEqual(["'self'"]);
  });

  it("only allows eval in development", () => {
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(contentSecurityPolicy({ dev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("adds a configured odds proxy origin once, without duplicates", () => {
    const csp = contentSecurityPolicy({ extraConnect: ["https://odds.tournamental.com", "https://odds-dev.tournamental.com"] });
    const connect = directive(csp, "connect-src");
    expect(connect.filter((v) => v === "https://odds.tournamental.com")).toHaveLength(1);
    expect(connect).toContain("https://odds-dev.tournamental.com");
  });
});

describe("framing per request shape", () => {
  it("denies framing on ordinary pages in every host mode", () => {
    for (const path of ["/", "/leaderboard", "/world-cup-2026", "/archive", "/hub", "/s/abc123", "/api/v1/register-interest"]) {
      const h = headersFor({ path });
      expect(get(h, "X-Frame-Options")).toBe("DENY");
      expect(get(h, "Content-Security-Policy")).toBe("frame-ancestors 'none'");
    }
  });

  it("allows the partner embed of the bracket (?embed=1) and the /embed surface", () => {
    for (const req of [
      { path: "/world-cup-2026", query: { embed: "1", pool: "x" } },
      { path: "/embed/widget.js" },
      { path: "/embed/get-code", query: { pool: "x" } },
      { path: "/embed" },
    ]) {
      expect(framingAllowed(req)).toBe(true);
      const h = headersFor(req);
      expect(get(h, "X-Frame-Options")).toBeUndefined();
      expect(get(h, "Content-Security-Policy")).toBeUndefined();
      // Base headers still apply inside the iframe.
      expect(get(h, "X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("does not treat embed look-alikes as the embed", () => {
    expect(framingAllowed({ path: "/embedded" })).toBe(false);
    expect(framingAllowed({ path: "/world-cup-2026", query: { embed: "0" } })).toBe(false);
    expect(framingAllowed({ path: "/world-cup-2026", query: { embed: "true" } })).toBe(false);
  });
});

describe("next.config headers() rules", () => {
  const rules = securityHeaderRules();

  it("has one catch-all rule for the base headers and one exclusive framing rule", () => {
    expect(rules).toHaveLength(2);
    expect(rules[0]!.source).toBe("/:path*");
    expect(rules[0]!.headers.map((h) => h.key)).toEqual(baseSecurityHeaders().map((h) => h.key));
    expect(rules[1]!.headers).toEqual(NO_FRAMING_HEADERS);
  });

  it("excludes /embed paths by source and ?embed=1 by a missing-query condition", () => {
    const framing = rules[1]!;
    const re = new RegExp(framing.source.replace("/:path(", "^/(") + "$");
    expect(re.test("/leaderboard")).toBe(true);
    expect(re.test("/embed/widget.js")).toBe(false);
    expect(re.test("/embed")).toBe(false);
    expect(re.test("/embedded")).toBe(true);
    expect(framing.missing).toEqual([{ type: "query", key: "embed", value: "1" }]);
  });
});
