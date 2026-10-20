/**
 * Host-mode routing in apps/web/middleware.ts, exercised through the
 * exported `middleware()` with synthesised NextRequests.
 *
 * Three modes share one Next process (docs/22 host modes):
 *   - archive: fwc2026.tournamental.com (read-only FWC 2026),
 *     with wc2026 / 2026wc as 301 aliases;
 *   - hub: play.tournamental.com while the registry has no active
 *     tournament (RWC 2027 register-interest);
 *   - live: play.tournamental.com once a tournament is active
 *     (covered in middleware-live-mode.test.ts with the registry mocked).
 *
 * A Next rewrite surfaces as the `x-middleware-rewrite` response header
 * and request-header overrides as `x-middleware-request-<name>`.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

const ARCHIVE = "fwc2026.tournamental.com";
const PLAY = "play.tournamental.com";

interface Options {
  method?: string;
  headers?: Record<string, string>;
}

function run(host: string, pathAndQuery: string, opts: Options = {}) {
  const req = new NextRequest(`https://${host}${pathAndQuery}`, {
    method: opts.method ?? "GET",
    headers: { host, ...(opts.headers ?? {}) },
  });
  return middleware(req);
}

function location(res: Response): string | null {
  return res.headers.get("location");
}

function rewrittenPath(res: Response): string | null {
  const v = res.headers.get("x-middleware-rewrite");
  return v ? new URL(v).pathname : null;
}

function requestHeader(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

async function json(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

describe("archive aliases", () => {
  it.each(["wc2026.tournamental.com", "2026wc.tournamental.com"])(
    "%s 301s to the canonical archive host, keeping path and query",
    (host) => {
      const res = run(host, "/s/abc123?ref=mate");
      expect(res.status).toBe(301);
      expect(location(res)).toBe(`https://${ARCHIVE}/s/abc123?ref=mate`);
    },
  );

  it("301s the alias root to the archive root", () => {
    const res = run("wc2026.tournamental.com", "/");
    expect(res.status).toBe(301);
    expect(location(res)).toBe(`https://${ARCHIVE}/`);
  });

  it("ignores host case and port when matching an alias", () => {
    const res = run("WC2026.Tournamental.com", "/", { headers: { host: "WC2026.Tournamental.com:443" } });
    expect(res.status).toBe(301);
    expect(location(res)).toBe(`https://${ARCHIVE}/`);
  });

  it("still 301s app.tournamental.com to play (the pre-archive deprecation)", () => {
    const res = run("app.tournamental.com", "/world-cup-2026?x=1");
    expect(res.status).toBe(301);
    expect(location(res)).toBe(`https://${PLAY}/world-cup-2026?x=1`);
  });
});

describe("archive host: read-only", () => {
  it.each(["POST", "PATCH", "PUT", "DELETE"])(
    "%s to any path is a 403 archived JSON response",
    async (method) => {
      const res = run(ARCHIVE, "/world-cup-2026", {
        method,
        headers: { origin: `https://${ARCHIVE}` },
      });
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await json(res)).toEqual({ error: "archived" });
    },
  );

  it("403s a mutating API call even with a first-party Origin", async () => {
    const res = run(ARCHIVE, "/api/v1/syndicates", {
      method: "POST",
      headers: { origin: `https://${PLAY}` },
    });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "archived" });
  });

  it("lets the CSRF guard answer first when a mutating API call has no Origin", async () => {
    const res = run(ARCHIVE, "/api/v1/syndicates", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "bad_origin" });
  });

  it("serves GET and HEAD reads", () => {
    expect(run(ARCHIVE, "/world-cup-2026").status).toBe(200);
    expect(run(ARCHIVE, "/world-cup-2026", { method: "HEAD" }).status).toBe(200);
  });
});

describe("archive host: page routing", () => {
  it("rewrites / to /archive and stamps x-tnm-archive on the request", () => {
    const res = run(ARCHIVE, "/");
    expect(res.status).toBe(200);
    expect(rewrittenPath(res)).toBe("/archive");
    expect(requestHeader(res, "x-tnm-archive")).toBe("fwc2026");
    expect(location(res)).toBeNull();
  });

  it("passes other reads through with the archive header and no rewrite", () => {
    for (const p of ["/world-cup-2026", "/match/fifa-wc-2026-final", "/s/abc123", "/archive", "/calendar"]) {
      const res = run(ARCHIVE, p);
      expect(res.status, p).toBe(200);
      expect(rewrittenPath(res), p).toBeNull();
      expect(requestHeader(res, "x-tnm-archive"), p).toBe("fwc2026");
    }
  });

  it("treats fwc2026.localhost as the archive too", () => {
    const res = run("fwc2026.localhost", "/");
    expect(rewrittenPath(res)).toBe("/archive");
    expect(requestHeader(res, "x-tnm-archive")).toBe("fwc2026");
  });

  const BLOCKED = [
    "/auth",
    "/auth/magic",
    "/profile",
    "/manage/x",
    "/dashboard",
    "/pools",
    "/pools/new",
    "/syndicates",
    "/syndicates/new",
    "/import",
    "/run",
    "/bots/keys",
    "/world-cup-2026/landing",
    "/predict",
    "/predict/anything",
    "/i/abcd123",
    "/leaderboard",
    "/leaderboard/global",
    "/next-stage-r32",
    "/hub",
    "/s/abc123/join",
  ];

  it.each(BLOCKED)("302s live-only path %s to the archive home", (p) => {
    const res = run(ARCHIVE, `${p}?keep=me`);
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`https://${ARCHIVE}/`);
  });

  it("blocks by whole path segment, not by string prefix", () => {
    for (const p of ["/poolsy", "/profiles", "/leaderboards", "/runway", "/importer", "/hubcap", "/i", "/ix"]) {
      const res = run(ARCHIVE, p);
      expect(res.status, p).toBe(200);
      expect(location(res), p).toBeNull();
    }
  });

  it("only blocks the join step of a pool share page", () => {
    expect(run(ARCHIVE, "/s/abc123").status).toBe(200);
    expect(run(ARCHIVE, "/s/abc123/join/extra").status).toBe(200);
    expect(run(ARCHIVE, "/s/abc123/join").status).toBe(302);
  });

  it("keeps the other bot pages while hiding bot keys", () => {
    expect(run(ARCHIVE, "/bots").status).toBe(200);
    expect(run(ARCHIVE, "/bots/sdk").status).toBe(200);
    expect(run(ARCHIVE, "/bots/keys").status).toBe(302);
  });

  it("keeps the public read APIs reachable", () => {
    expect(run(ARCHIVE, "/api/healthz").status).toBe(200);
    expect(run(ARCHIVE, "/api/v1/syndicates/public").status).toBe(200);
  });

  it("301s legal paths to the marketing site", () => {
    const res = run(ARCHIVE, "/terms?v=2");
    expect(res.status).toBe(301);
    expect(location(res)).toBe("https://tournamental.com/legal/terms?v=2");
    expect(location(run(ARCHIVE, "/privacy"))).toBe("https://tournamental.com/legal/privacy");
    expect(location(run(ARCHIVE, "/cookies"))).toBe("https://tournamental.com/legal/cookies");
  });
});

describe("archive host: locale-prefixed paths", () => {
  it("rewrites /<locale> to /archive and forwards the locale", () => {
    const res = run(ARCHIVE, "/es");
    expect(res.status).toBe(200);
    expect(rewrittenPath(res)).toBe("/archive");
    expect(requestHeader(res, "x-tnm-archive")).toBe("fwc2026");
    expect(requestHeader(res, "x-vt-locale")).toBe("es");
    expect(res.headers.get("set-cookie")).toContain("vt_locale=es");
  });

  it("applies the block list under a locale prefix", () => {
    for (const p of ["/fr/leaderboard", "/es/pools", "/de/auth", "/pt-BR/s/abc123/join", "/es/i/abcd"]) {
      const res = run(ARCHIVE, p);
      expect(res.status, p).toBe(302);
      expect(location(res), p).toBe(`https://${ARCHIVE}/`);
    }
  });

  it("strips the prefix for allowed pages and keeps the archive header", () => {
    const res = run(ARCHIVE, "/fr/world-cup-2026");
    expect(res.status).toBe(200);
    expect(rewrittenPath(res)).toBe("/world-cup-2026");
    expect(requestHeader(res, "x-tnm-archive")).toBe("fwc2026");
    expect(requestHeader(res, "x-vt-locale")).toBe("fr");
  });

  it("301s locale-prefixed legal paths to the marketing site", () => {
    expect(location(run(ARCHIVE, "/es/terms"))).toBe("https://tournamental.com/legal/terms");
  });

  it("leaves unknown two-letter prefixes alone", () => {
    const res = run(ARCHIVE, "/zz/pools");
    expect(res.status).toBe(200);
    expect(rewrittenPath(res)).toBeNull();
  });
});

describe("archive host: locale auto-detection still runs", () => {
  it("sets vt_locale from CF-IPCountry on a first visit", () => {
    const res = run(ARCHIVE, "/", { headers: { "cf-ipcountry": "ES" } });
    expect(res.headers.get("set-cookie")).toContain("vt_locale=es");
    expect(rewrittenPath(res)).toBe("/archive");
  });

  it("does not set a cookie for the default locale", () => {
    const res = run(ARCHIVE, "/", { headers: { "cf-ipcountry": "NZ" } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("hub mode (play host, no active tournament)", () => {
  it("rewrites / to /hub and stamps x-tnm-hub", () => {
    const res = run(PLAY, "/");
    expect(res.status).toBe(200);
    expect(rewrittenPath(res)).toBe("/hub");
    expect(requestHeader(res, "x-tnm-hub")).toBe("1");
    expect(requestHeader(res, "x-tnm-archive")).toBeNull();
  });

  it("keeps ?ref= on the root so the referral loop can read it", () => {
    const res = run(PLAY, "/?ref=9bsy9et");
    expect(rewrittenPath(res)).toBe("/hub");
    expect(new URL(res.headers.get("x-middleware-rewrite")!).searchParams.get("ref")).toBe("9bsy9et");
  });

  it("treats play.localhost as the hub too", () => {
    expect(rewrittenPath(run("play.localhost", "/"))).toBe("/hub");
  });

  it("keeps the locale prefix when an invite link carries one (review 335-2)", () => {
    const res = run(PLAY, "/es/i/9BSY9ET");
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`https://${PLAY}/es/?ref=9bsy9et`);
  });

  it("302s /i/<code> to the hub with ?ref=<code> lower-cased", () => {
    const res = run(PLAY, "/i/9BSY9ET");
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`https://${PLAY}/?ref=9bsy9et`);
  });

  it("accepts invite codes of 4 to 16 alphanumerics only", () => {
    expect(location(run(PLAY, "/i/abcd"))).toBe(`https://${PLAY}/?ref=abcd`);
    expect(location(run(PLAY, "/i/abcdefghijklmnop"))).toBe(`https://${PLAY}/?ref=abcdefghijklmnop`);
    // Too short, too long, or with punctuation: not an invite, falls to the archive.
    for (const p of ["/i/abc", "/i/abcdefghijklmnopq", "/i/ab-cd", "/i/abcd/extra"]) {
      expect(location(run(PLAY, p)), p).toBe(`https://${ARCHIVE}${p}`);
    }
  });

  it("serves the allow-listed paths from play itself", () => {
    for (const p of [
      "/hub",
      "/api/v1/register-interest",
      "/api/healthz",
      "/api/og/rwc2027",
      "/rwc2027/hero.svg",
      "/icons/icon-192.png",
      "/fonts/Fraunces.woff2",
      "/manifest.webmanifest",
      "/sw.js",
      "/robots.txt",
      "/sitemap.xml",
      "/whitepaper/",
      "/any/static/file.json",
    ]) {
      const res = run(PLAY, p);
      expect(res.status, p).toBe(200);
      expect(location(res), p).toBeNull();
      expect(requestHeader(res, "x-tnm-hub"), p).toBe("1");
    }
  });

  it("302s everything else to the latest archive, keeping path and query", () => {
    for (const p of ["/world-cup-2026", "/s/abc123?ref=x", "/leaderboard", "/pools/new", "/match/fifa-wc-2026-final"]) {
      const res = run(PLAY, p);
      expect(res.status, p).toBe(302);
      expect(location(res), p).toBe(`https://${ARCHIVE}${p}`);
    }
  });

  it("rewrites a locale root to /hub instead of bouncing to the archive", () => {
    const res = run(PLAY, "/es");
    expect(res.status).toBe(200);
    expect(rewrittenPath(res)).toBe("/hub");
    expect(requestHeader(res, "x-tnm-hub")).toBe("1");
    expect(requestHeader(res, "x-vt-locale")).toBe("es");
  });

  it("recognises invite links under a locale prefix", () => {
    expect(location(run(PLAY, "/es/i/abcd"))).toBe(`https://${PLAY}/es/?ref=abcd`);
  });

  it("301s legal paths to the marketing site", () => {
    expect(location(run(PLAY, "/terms"))).toBe("https://tournamental.com/legal/terms");
    expect(location(run(PLAY, "/legal"))).toBe("https://tournamental.com/legal");
  });

  it("lets a first-party register-interest POST through to the route", () => {
    const res = run(PLAY, "/api/v1/register-interest", {
      method: "POST",
      headers: { origin: `https://${PLAY}` },
    });
    expect(res.status).toBe(200);
    expect(location(res)).toBeNull();
    expect(requestHeader(res, "x-tnm-hub")).toBe("1");
  });

  it("403s a register-interest POST with no or a foreign Origin", async () => {
    const none = run(PLAY, "/api/v1/register-interest", { method: "POST" });
    expect(none.status).toBe(403);
    expect(await json(none)).toEqual({ error: "bad_origin" });
    const foreign = run(PLAY, "/api/v1/register-interest", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);
  });
});

describe("other hosts", () => {
  it("passes the dev origin through untouched", () => {
    const res = run("localhost", "/world-cup-2026", { headers: { host: "localhost:3300" } });
    expect(res.status).toBe(200);
    expect(location(res)).toBeNull();
    expect(rewrittenPath(res)).toBeNull();
    expect(requestHeader(res, "x-tnm-hub")).toBeNull();
    expect(requestHeader(res, "x-tnm-archive")).toBeNull();
  });

  it("does not put the marketing host into any mode", () => {
    const res = run("tournamental.com", "/");
    expect(res.status).toBe(200);
    expect(rewrittenPath(res)).toBeNull();
  });
});

describe("Origin guard sees through a locale prefix (review 335-1)", () => {
  it("refuses a cross-site POST to /es/api/v1/... on play like the bare path", async () => {
    const res = run(PLAY, "/es/api/v1/register-interest", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "bad_origin" });
  });

  it("refuses it on the archive host too, before the archive 403", async () => {
    const res = run(ARCHIVE, "/fr/api/v1/syndicates", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "bad_origin" });
  });

  it("still lets a first-party POST through the guard on a locale-prefixed path", () => {
    const res = run(PLAY, "/es/api/v1/register-interest", {
      method: "POST",
      headers: { origin: "https://play.tournamental.com" },
    });
    expect(res.status).not.toBe(403);
  });
});
