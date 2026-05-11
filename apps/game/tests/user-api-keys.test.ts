/**
 * Personal API key routes , mint, list, revoke, regenerate, and the
 * Authorization-header resolver fan-out.
 *
 * Auth is forged via the same HS256 helper the identity tests use so
 * we exercise the production code path (`Authorization: Bearer
 * <jwt>`) rather than the dev `X-User-Id` fallback.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import { buildServer, type BuiltServer } from "../src/server.js";
import { resolveAuthFromHeader } from "../src/routes/identity.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET = "test-jwt-secret-for-personal-keys";
const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "..", "migrations");

function makeJwt(sub: string, expSecondsFromNow = 3600): string {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub,
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
  };
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac("sha256", SECRET).update(signingInput).digest("base64url");
  return `${signingInput}.${sig}`;
}

describe("personal api keys", () => {
  let built: BuiltServer;
  const savedSecret = process.env.SUPABASE_JWT_SECRET;
  const savedDevAuth = process.env.GAME_DEV_AUTH;
  const savedNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    process.env.GAME_DEV_AUTH = "0";
    process.env.NODE_ENV = "production";
    built = await buildServer({
      dbPath: ":memory:",
      migrationsDir: MIGRATIONS_DIR,
      adminToken: "test-admin-token",
      cacheTtlMs: 100,
      rateLimit: false,
      skipPunditRecompute: true,
    });
  });

  afterAll(async () => {
    await built.app.close();
    if (savedSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = savedSecret;
    if (savedDevAuth === undefined) delete process.env.GAME_DEV_AUTH;
    else process.env.GAME_DEV_AUTH = savedDevAuth;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  it("rejects mint without a Supabase session", async () => {
    const res = await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "no-auth" },
      headers: { "x-user-id": "user-spoofed" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("mints a key, returns plaintext once, persists prefix + hash", async () => {
    const jwt = makeJwt("user-1");
    const res = await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "claude desktop" },
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toMatch(/^tnm_live_[0-9A-Za-z]{32}$/);
    expect(body.prefix).toBe(`tnm_live_${body.key.slice("tnm_live_".length, "tnm_live_".length + 8)}`);
    expect(body.status).toBe("active");
    expect(body.label).toBe("claude desktop");
    expect(body.scopes).toEqual([
      "bracket:write",
      "picks:write",
      "share:write",
    ]);
    expect(body.last_used_at).toBeNull();
    expect(body.revoked_at).toBeNull();
    expect(body).not.toHaveProperty("key_hash");
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("lists keys without plaintext and rejects cross-user reads", async () => {
    const jwtA = makeJwt("user-list-a");
    const jwtB = makeJwt("user-list-b");
    await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "a-key-1", scopes: ["bracket:write"] },
      headers: { authorization: `Bearer ${jwtA}` },
    });
    await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "b-key" },
      headers: { authorization: `Bearer ${jwtB}` },
    });

    const list = await built.app.inject({
      method: "GET",
      url: "/v1/me/api-keys",
      headers: { authorization: `Bearer ${jwtA}` },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.keys.map((k: { label: string }) => k.label)).toEqual([
      "a-key-1",
    ]);
    for (const k of body.keys) {
      expect(k).not.toHaveProperty("key");
      expect(k).not.toHaveProperty("key_hash");
      expect(k.prefix).toMatch(/^tnm_live_[0-9A-Za-z]{8}$/);
    }
  });

  it("revoke flips status to revoked and returns 204 with no body", async () => {
    const jwt = makeJwt("user-revoke");
    const mint = await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "to-revoke" },
      headers: { authorization: `Bearer ${jwt}` },
    });
    const id = mint.json().id as string;

    const del = await built.app.inject({
      method: "DELETE",
      url: `/v1/me/api-keys/${id}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe("");

    const list = await built.app.inject({
      method: "GET",
      url: "/v1/me/api-keys",
      headers: { authorization: `Bearer ${jwt}` },
    });
    const row = list.json().keys.find((k: { id: string }) => k.id === id);
    expect(row.status).toBe("revoked");
    expect(row.revoked_at).not.toBeNull();
  });

  it("regenerate revokes the old key and mints a new one with the same label/scopes", async () => {
    const jwt = makeJwt("user-regen");
    const mint = await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "rotating", scopes: ["picks:write"] },
      headers: { authorization: `Bearer ${jwt}` },
    });
    const oldId = mint.json().id as string;
    const oldKey = mint.json().key as string;

    const regen = await built.app.inject({
      method: "POST",
      url: `/v1/me/api-keys/${oldId}/regenerate`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(regen.statusCode).toBe(201);
    const fresh = regen.json();
    expect(fresh.id).not.toBe(oldId);
    expect(fresh.label).toBe("rotating");
    expect(fresh.scopes).toEqual(["picks:write"]);
    expect(fresh.key).not.toBe(oldKey);
    expect(fresh.status).toBe("active");

    const list = await built.app.inject({
      method: "GET",
      url: "/v1/me/api-keys",
      headers: { authorization: `Bearer ${jwt}` },
    });
    const rows = list.json().keys as Array<{ id: string; status: string }>;
    const oldRow = rows.find((r) => r.id === oldId);
    const newRow = rows.find((r) => r.id === fresh.id);
    expect(oldRow?.status).toBe("revoked");
    expect(newRow?.status).toBe("active");
  });

  it("auth resolver matches an active key and rejects a revoked one", async () => {
    const jwt = makeJwt("user-auth");
    const mint = await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "resolver test" },
      headers: { authorization: `Bearer ${jwt}` },
    });
    const plaintext = mint.json().key as string;
    const id = mint.json().id as string;

    // Active key resolves to the user.
    const active = resolveAuthFromHeader(
      {
        headers: { authorization: `Bearer ${plaintext}` },
        query: {},
      } as unknown as Parameters<typeof resolveAuthFromHeader>[0],
      { store: built.store, jwtSecret: SECRET },
    );
    expect(active?.userId).toBe("user-auth");
    expect(active?.source).toBe("personal_key");
    expect(active?.keyPrefix).toMatch(/^tnm_live_[0-9A-Za-z]{8}$/);
    expect(active?.keyId).toBe(id);

    // Revoke and re-check , the same plaintext now fails closed.
    await built.app.inject({
      method: "DELETE",
      url: `/v1/me/api-keys/${id}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const dead = resolveAuthFromHeader(
      {
        headers: { authorization: `Bearer ${plaintext}` },
        query: {},
      } as unknown as Parameters<typeof resolveAuthFromHeader>[0],
      { store: built.store, jwtSecret: SECRET },
    );
    expect(dead).toBeNull();
  });

  it("auth resolver bumps last_used_at on successful match", async () => {
    const jwt = makeJwt("user-touch");
    const mint = await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "touch test" },
      headers: { authorization: `Bearer ${jwt}` },
    });
    const plaintext = mint.json().key as string;
    const id = mint.json().id as string;

    expect(mint.json().last_used_at).toBeNull();

    resolveAuthFromHeader(
      {
        headers: { authorization: `Bearer ${plaintext}` },
        query: {},
      } as unknown as Parameters<typeof resolveAuthFromHeader>[0],
      { store: built.store, jwtSecret: SECRET },
    );

    const list = await built.app.inject({
      method: "GET",
      url: "/v1/me/api-keys",
      headers: { authorization: `Bearer ${jwt}` },
    });
    const row = (list.json().keys as Array<{ id: string; last_used_at: string | null }>).find(
      (r) => r.id === id,
    );
    expect(row?.last_used_at).not.toBeNull();
  });

  it("rejects an unknown personal key shape silently", async () => {
    const fake = "tnm_live_" + "Z".repeat(32);
    const out = resolveAuthFromHeader(
      {
        headers: { authorization: `Bearer ${fake}` },
        query: {},
      } as unknown as Parameters<typeof resolveAuthFromHeader>[0],
      { store: built.store, jwtSecret: SECRET },
    );
    expect(out).toBeNull();
  });

  it("rejects invalid scope values", async () => {
    const jwt = makeJwt("user-scope");
    const res = await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "bad scope", scopes: ["admin:everything"] },
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_scopes");
  });

  it("rejects an empty label", async () => {
    const jwt = makeJwt("user-label");
    const res = await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "" },
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_label");
  });

  it("404 when revoking another user's key", async () => {
    const jwtOwner = makeJwt("user-owner");
    const jwtAttacker = makeJwt("user-attacker");
    const mint = await built.app.inject({
      method: "POST",
      url: "/v1/me/api-keys",
      payload: { label: "owners key" },
      headers: { authorization: `Bearer ${jwtOwner}` },
    });
    const id = mint.json().id as string;
    const res = await built.app.inject({
      method: "DELETE",
      url: `/v1/me/api-keys/${id}`,
      headers: { authorization: `Bearer ${jwtAttacker}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
