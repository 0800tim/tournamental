/**
 * Archive hosts must not accept any request that writes. The method
 * check covers POST, PATCH, PUT and DELETE; this pins the GET routes
 * that write (signed approve and deny links for pool join requests)
 * and the CSRF guard on the register-interest route on the hub.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

const ARCHIVE = "fwc2026.tournamental.com";
const PLAY = "play.tournamental.com";

function run(host: string, path: string, method = "GET", headers: Record<string, string> = {}) {
  return middleware(new NextRequest(`https://${host}${path}`, { method, headers: { host, ...headers } }));
}

describe("archive host, GET routes that write", () => {
  it.each([
    "/api/v1/syndicates/mates/join-requests/u_1/approve?t=abc",
    "/api/v1/syndicates/mates/join-requests/u_1/deny?t=abc",
    "/api/v1/syndicates/mates/join-requests/u_1",
  ])("403s %s as archived", async (p) => {
    const res = run(ARCHIVE, p);
    expect(res.status).toBe(403);
    expect(JSON.parse(await res.text())).toEqual({ error: "archived" });
  });

  it("still serves the read-only membership check", () => {
    expect(run(ARCHIVE, "/api/v1/syndicates/mates/join").status).toBe(200);
  });

  it("403s every mutating method whatever the path", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(run(ARCHIVE, "/api/v1/register-interest", m, { origin: `https://${PLAY}` }).status, m).toBe(403);
      expect(run(ARCHIVE, "/world-cup-2026", m).status, m).toBe(403);
      expect(run(ARCHIVE, "/s/abc/join", m).status, m).toBe(403);
    }
  });
});

describe("hub host, register-interest Origin guard", () => {
  it("lets a first-party POST through", () => {
    const res = run(PLAY, "/api/v1/register-interest", "POST", { origin: `https://${PLAY}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("403s a POST with no Origin, a foreign Origin, or a look-alike Origin", async () => {
    for (const origin of [undefined, "https://evil.example", "https://play.tournamental.com.evil.example", "http://play.tournamental.com"]) {
      const res = run(PLAY, "/api/v1/register-interest", "POST", origin ? { origin } : {});
      expect(res.status, String(origin)).toBe(403);
      expect(JSON.parse(await res.text())).toEqual({ error: "bad_origin" });
    }
  });
});
