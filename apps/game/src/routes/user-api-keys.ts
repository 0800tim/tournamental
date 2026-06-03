/**
 * Personal API key routes (`/v1/me/api-keys`).
 *
 *   GET    /v1/me/api-keys                  list caller's keys (no plaintext)
 *   POST   /v1/me/api-keys                  mint a key, plaintext returned ONCE
 *   DELETE /v1/me/api-keys/:id              revoke (sets revoked_at, keeps row)
 *   POST   /v1/me/api-keys/:id/regenerate   revoke + mint with same label/scopes
 *
 * Auth: Supabase session JWT only. The dev-trust `X-User-Id` header is
 * deliberately rejected for the mint and regenerate endpoints , minting
 * a key without a verified session would let any local-network client
 * provision a credential for any user id, which is a critical-severity
 * flaw. Listing and revoking still go via the same `resolveUserId`
 * helper but reject when `devAuth` is off (production default).
 *
 * Plaintext handling: the plaintext key appears once in the POST and
 * regenerate responses. It is NEVER persisted, NEVER logged, NEVER
 * echoed to the audit log. The only durable surfaces are
 * `key_prefix` (display) and `key_hash` (scrypt).
 *
 * Cache policy: every response is `Cache-Control: private, no-store` ,
 * the surface is user-specific and any caching defeats the
 * "shown once" invariant.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

import type { GameStore } from "../store/db.js";
import { resolveUserId } from "./identity.js";
import {
  generateKeyId,
  mintPersonalKey,
  type MintedKey,
} from "./user-api-keys-crypto.js";

const DEFAULT_RATE_LIMIT_RPM = 600;

/**
 * The scope vocabulary the /profile/api-keys UI surfaces. Kept in code
 * (rather than the DB) so the contract is part of the API surface , a
 * new scope is a code change and a docs/54 update.
 */
export const ALLOWED_SCOPES: ReadonlySet<string> = new Set([
  "bracket:write",
  "picks:write",
  "share:write",
]);

const DEFAULT_SCOPES: readonly string[] = [
  "bracket:write",
  "picks:write",
  "share:write",
];

const MAX_LABEL_LEN = 80;
const MAX_KEYS_PER_USER = 25;

export interface UserApiKeyRoutesDeps {
  readonly store: GameStore;
  readonly nowMs?: () => number;
  /**
   * Whether to honour `X-User-Id` for reads. Defaults to the same env
   * heuristic the bracket routes use , production never honours it.
   */
  readonly devAuth?: boolean;
  readonly jwtSecret?: string | null;
}

export interface PublicUserApiKey {
  readonly id: string;
  readonly label: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly rate_limit_rpm: number;
  readonly created_at: string;
  readonly last_used_at: string | null;
  readonly revoked_at: string | null;
  readonly status: "active" | "revoked";
}

export interface MintResponse extends PublicUserApiKey {
  /** Shown ONCE. Save it now , we will never display it again. */
  readonly key: string;
}

export async function registerUserApiKeyRoutes(
  app: FastifyInstance,
  deps: UserApiKeyRoutesDeps,
): Promise<void> {
  const now = deps.nowMs ?? (() => Date.now());
  // SEC-BRK-09: `X-User-Id` dev fallback is gated solely by
  // GAME_DEV_AUTH=1. Dropping the NODE_ENV shortcut so production
  // never accidentally re-enables the unsigned-header path.
  const devAuth = deps.devAuth ?? process.env.GAME_DEV_AUTH === "1";
  const jwtSecret = deps.jwtSecret ?? process.env.SUPABASE_JWT_SECRET ?? null;

  /**
   * Resolve the calling user from a verified Supabase session ONLY.
   * The dev-fallback `X-User-Id` header is honoured for listing /
   * revocation when `devAuth` is on, so local development against an
   * unmigrated session still works.
   */
  function resolveCaller(req: FastifyRequest): string | null {
    return resolveUserId(req, {
      devAuth,
      jwtSecret,
      nowMs: now,
    });
  }

  /**
   * The mint + regenerate endpoints reject the dev fallback. Letting
   * an unauthenticated client mint a key for any user id would be a
   * trivial credential-forgery primitive.
   */
  function resolveCallerStrict(req: FastifyRequest): string | null {
    return resolveUserId(req, {
      devAuth: false,
      jwtSecret,
      nowMs: now,
    });
  }

  app.get("/v1/me/api-keys", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const userId = resolveCaller(req);
    if (!userId) return reply.code(401).send({ error: "missing_user" });
    const rows = deps.store.listUserApiKeysForUser(userId);
    return { keys: rows.map(toPublic) };
  });

  app.post("/v1/me/api-keys", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const userId = resolveCallerStrict(req);
    if (!userId) return reply.code(401).send({ error: "missing_user" });

    const body = (req.body ?? {}) as { label?: unknown; scopes?: unknown };
    const label = parseLabel(body.label);
    if (!label) {
      return reply.code(400).send({
        error: "invalid_label",
        message: `label must be a non-empty string up to ${MAX_LABEL_LEN} chars`,
      });
    }
    const scopes = parseScopes(body.scopes);
    if (scopes === null) {
      return reply.code(400).send({
        error: "invalid_scopes",
        message: `scopes must be a subset of: ${[...ALLOWED_SCOPES].join(", ")}`,
      });
    }
    const existing = deps.store.listUserApiKeysForUser(userId);
    const liveCount = existing.filter((k) => k.revoked_at === null).length;
    if (liveCount >= MAX_KEYS_PER_USER) {
      return reply.code(409).send({
        error: "too_many_keys",
        message: `at most ${MAX_KEYS_PER_USER} active keys per user`,
      });
    }
    const minted = mintPersonalKey();
    const id = generateKeyId();
    const createdAt = now();
    deps.store.insertUserApiKey({
      id,
      userId,
      label,
      keyPrefix: minted.prefix,
      keyHash: minted.hash,
      scopes,
      rateLimitRpm: DEFAULT_RATE_LIMIT_RPM,
      createdAt,
    });
    const row = deps.store.getUserApiKeyById(id);
    if (!row) {
      return reply.code(500).send({ error: "insert_failed" });
    }
    const response: MintResponse = {
      ...toPublic(row),
      key: minted.plaintext,
    };
    return reply.code(201).send(response);
  });

  app.delete("/v1/me/api-keys/:id", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const userId = resolveCaller(req);
    if (!userId) return reply.code(401).send({ error: "missing_user" });
    const params = req.params as { id?: string };
    const id = params.id ?? "";
    if (!id) return reply.code(400).send({ error: "missing_id" });
    const row = deps.store.getUserApiKeyById(id);
    if (!row || row.user_id !== userId) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (row.revoked_at !== null) {
      // Already dead , the DELETE is still successful from the user's view.
      return reply.code(204).send();
    }
    deps.store.revokeUserApiKey(id, now());
    return reply.code(204).send();
  });

  app.post("/v1/me/api-keys/:id/regenerate", async (req, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const userId = resolveCallerStrict(req);
    if (!userId) return reply.code(401).send({ error: "missing_user" });
    const params = req.params as { id?: string };
    const id = params.id ?? "";
    if (!id) return reply.code(400).send({ error: "missing_id" });
    const row = deps.store.getUserApiKeyById(id);
    if (!row || row.user_id !== userId) {
      return reply.code(404).send({ error: "not_found" });
    }
    const minted: MintedKey = mintPersonalKey();
    const stamped = now();
    const newId = generateKeyId();
    deps.store.transaction(() => {
      if (row.revoked_at === null) {
        deps.store.revokeUserApiKey(row.id, stamped);
      }
      deps.store.insertUserApiKey({
        id: newId,
        userId,
        label: row.label,
        keyPrefix: minted.prefix,
        keyHash: minted.hash,
        scopes: safeParseScopes(row.scopes) ?? DEFAULT_SCOPES,
        rateLimitRpm: row.rate_limit_rpm,
        createdAt: stamped,
      });
    });
    const created = deps.store.getUserApiKeyById(newId);
    if (!created) {
      return reply.code(500).send({ error: "regenerate_failed" });
    }
    const response: MintResponse = {
      ...toPublic(created),
      key: minted.plaintext,
    };
    return reply.code(201).send(response);
  });
}

// ---------- helpers ----------

function toPublic(row: {
  id: string;
  label: string;
  key_prefix: string;
  scopes: string;
  rate_limit_rpm: number;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}): PublicUserApiKey {
  return {
    id: row.id,
    label: row.label,
    prefix: row.key_prefix,
    scopes: safeParseScopes(row.scopes) ?? [],
    rate_limit_rpm: row.rate_limit_rpm,
    created_at: new Date(row.created_at).toISOString(),
    last_used_at:
      row.last_used_at === null ? null : new Date(row.last_used_at).toISOString(),
    revoked_at:
      row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
    status: row.revoked_at === null ? "active" : "revoked",
  };
}

function parseLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_LABEL_LEN) return null;
  return trimmed;
}

function parseScopes(raw: unknown): readonly string[] | null {
  if (raw === undefined || raw === null) return DEFAULT_SCOPES;
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== "string") return null;
    if (!ALLOWED_SCOPES.has(s)) return null;
    if (!out.includes(s)) out.push(s);
  }
  if (out.length === 0) return DEFAULT_SCOPES;
  return out;
}

function safeParseScopes(json: string): readonly string[] | null {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const out: string[] = [];
    for (const s of parsed) {
      if (typeof s !== "string") return null;
      out.push(s);
    }
    return out;
  } catch {
    return null;
  }
}
