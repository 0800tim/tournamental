/**
 * identity — Supabase JWT verification + dev-fallback header.
 *
 * Coverage:
 *   - Bearer JWT with matching secret resolves to `sub`.
 *   - Bearer JWT with mismatched secret returns null.
 *   - Expired Bearer JWT returns null.
 *   - Malformed Bearer (wrong shape, wrong alg) returns null.
 *   - Dev-fallback: X-User-Id header works when devAuth = true.
 *   - Dev-fallback off + no Bearer → null (production fail-closed).
 */

import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import { resolveUserId, verifySupabaseJwt } from "../src/routes/identity.js";

const SECRET = "test-secret-do-not-use-in-production";

function sign(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac("sha256", SECRET)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${sig}`;
}

function makeReq(opts: {
  authorization?: string;
  xUserId?: string;
  query?: Record<string, string>;
}) {
  return {
    headers: {
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
      ...(opts.xUserId ? { "x-user-id": opts.xUserId } : {}),
    },
    query: opts.query ?? {},
  } as unknown as Parameters<typeof resolveUserId>[0];
}

describe("verifySupabaseJwt", () => {
  it("verifies a valid token signed with the same secret", () => {
    const token = sign({
      sub: "u-1",
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const claims = verifySupabaseJwt(token, { secret: SECRET });
    expect(claims?.sub).toBe("u-1");
  });

  it("rejects a token signed with a different secret", () => {
    const token = sign({
      sub: "u-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const claims = verifySupabaseJwt(token, { secret: "other-secret" });
    expect(claims).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = sign({
      sub: "u-1",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const claims = verifySupabaseJwt(token, { secret: SECRET });
    expect(claims).toBeNull();
  });

  it("rejects tokens without a sub", () => {
    const token = sign({
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const claims = verifySupabaseJwt(token, { secret: SECRET });
    expect(claims).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifySupabaseJwt("not.a.jwt", { secret: SECRET })).toBeNull();
    expect(verifySupabaseJwt("only.one", { secret: SECRET })).toBeNull();
  });

  it("returns null when secret is missing (fail-closed)", () => {
    const token = sign({ sub: "u-1" });
    expect(verifySupabaseJwt(token, { secret: null })).toBeNull();
  });
});

describe("resolveUserId", () => {
  it("uses the Bearer JWT when present", () => {
    const token = sign({
      sub: "user-bearer",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const id = resolveUserId(
      makeReq({ authorization: `Bearer ${token}`, xUserId: "x" }),
      { devAuth: true, jwtSecret: SECRET },
    );
    expect(id).toBe("user-bearer");
  });

  it("falls back to X-User-Id only when devAuth is enabled", () => {
    const id = resolveUserId(makeReq({ xUserId: "user-dev" }), {
      devAuth: true,
      jwtSecret: SECRET,
    });
    expect(id).toBe("user-dev");
  });

  it("returns null when devAuth is off and no Bearer is sent", () => {
    const id = resolveUserId(makeReq({ xUserId: "user-dev" }), {
      devAuth: false,
      jwtSecret: SECRET,
    });
    expect(id).toBeNull();
  });

  it("returns null when a bad Bearer is sent (does NOT fall back to dev header)", () => {
    const id = resolveUserId(
      makeReq({ authorization: "Bearer not-a-token", xUserId: "user-dev" }),
      { devAuth: true, jwtSecret: SECRET },
    );
    expect(id).toBeNull();
  });

  it("accepts ?user_id= query param in devAuth mode", () => {
    const id = resolveUserId(makeReq({ query: { user_id: "user-q" } }), {
      devAuth: true,
      jwtSecret: SECRET,
    });
    expect(id).toBe("user-q");
  });
});
