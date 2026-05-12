/**
 * Identity resolution for game-service requests.
 *
 * Production: `Authorization: Bearer <supabase-jwt>` — verified via HMAC
 * against `SUPABASE_JWT_SECRET` (the project's JWT secret from the
 * Supabase dashboard's Project Settings → API). The `sub` claim is the
 * canonical user_id.
 *
 * Dev fallback: `X-User-Id: <id>` (or `?user_id=`). Enabled only when
 * `GAME_DEV_AUTH=1` so production accidentally hitting an unsigned
 * header doesn't authenticate.
 *
 * We import the verifier lazily so vitest can mock it without dragging
 * in `jose`'s WebCrypto polyfill in jsdom.
 */

import type { FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { GameStore } from "../store/db.js";
import {
  isPersonalKeyShape,
  prefixFor,
  verifyKey,
} from "./user-api-keys-crypto.js";

export interface ResolveOptions {
  /** Allow X-User-Id / ?user_id= when no Bearer token is supplied. */
  readonly devAuth?: boolean;
  /** HMAC secret for verifying Supabase JWTs (HS256). */
  readonly jwtSecret?: string | null;
  /**
   * HMAC secret for verifying the auth-sms `tnm_session` cookie (HS256,
   * issuer = "tournamental-auth"). Different secret + issuer from the
   * Supabase path. Set via env `AUTH_JWT_SECRET`.
   */
  readonly authSmsJwtSecret?: string | null;
  /** Clock override for tests. */
  readonly nowMs?: () => number;
  /**
   * GameStore reference for resolving personal API keys
   * (`tnm_live_<...>`). Omit to disable the personal-key path entirely,
   * which keeps the existing pure-functional callers (identity tests)
   * unchanged.
   */
  readonly store?: GameStore;
}

export interface AuthResolution {
  readonly userId: string;
  readonly source: "supabase" | "tnm_session" | "personal_key" | "dev_header";
  /** Set only when source === "personal_key". */
  readonly keyId?: string;
  /** Set only when source === "personal_key". `tnm_live_<first-8>`. */
  readonly keyPrefix?: string;
}

/**
 * Parse a Cookie header into a name→value map. Returns an empty object
 * if the header is absent or malformed. Tiny stand-alone implementation
 * so we don't pull `@fastify/cookie` into the game-service.
 */
function parseCookies(header: string | string[] | undefined): Record<string, string> {
  if (!header) return {};
  const raw = Array.isArray(header) ? header.join("; ") : header;
  const out: Record<string, string> = {};
  for (const segment of raw.split(/;\s*/)) {
    if (!segment) continue;
    const eq = segment.indexOf("=");
    if (eq < 1) continue;
    const k = segment.slice(0, eq).trim();
    const v = segment.slice(eq + 1).trim();
    if (k && v && !(k in out)) out[k] = v;
  }
  return out;
}

/**
 * Synchronously resolve the calling user id from a request.
 *
 * Returns `null` when no valid identity can be found.
 */
export function resolveUserId(
  req: FastifyRequest,
  opts: ResolveOptions = {},
): string | null {
  const resolution = resolveAuthFromHeader(req, opts);
  return resolution?.userId ?? null;
}

/**
 * Full auth resolution: returns who the caller is AND how we resolved
 * them (Supabase session, personal API key, or the dev-fallback
 * header). Callers that need to audit-log the originating key prefix
 * (the MCP server's audit log, the bracket-submit route's rate limit)
 * should use this rather than the bare `resolveUserId`.
 *
 * Resolution order:
 *   1. `Authorization: Bearer tnm_live_<...>` , personal API key
 *      (requires `opts.store`; falls through to step 2 if absent).
 *   2. `Authorization: Bearer <supabase-jwt>` , verified HS256.
 *   3. `X-User-Id` header / `?user_id=` , dev fallback only.
 *
 * Steps 1 and 2 share the `Authorization` header so we route on the
 * value's shape. A `tnm_live_` prefix that fails verification fails
 * the whole request closed , we don't fall back to JWT parsing because
 * a malformed personal key is almost certainly a typo, not a JWT.
 */
export function resolveAuthFromHeader(
  req: FastifyRequest,
  opts: ResolveOptions = {},
): AuthResolution | null {
  // 1. tnm_session cookie (browser path, set by auth-sms on apex domain).
  //    Verified with the auth-sms HS256 secret. This is the primary
  //    browser auth path now that we've moved off Supabase.
  if (opts.authSmsJwtSecret) {
    const cookies = parseCookies(req.headers.cookie);
    const sessionJwt = cookies["tnm_session"];
    if (sessionJwt) {
      const claims = verifyAuthSmsJwt(sessionJwt, {
        secret: opts.authSmsJwtSecret,
        nowMs: opts.nowMs,
      });
      if (claims?.sub) {
        return { userId: claims.sub, source: "tnm_session" };
      }
      // Cookie present but invalid (e.g. expired) — fall through to
      // try the other paths rather than failing closed; a stale
      // cookie shouldn't deny a request that has a valid Bearer too.
    }
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (isPersonalKeyShape(token)) {
      // Personal API key path. Requires a store reference; we fail
      // closed if the caller hasn't wired one in.
      if (!opts.store) return null;
      const resolved = resolvePersonalKey(token, opts.store, opts.nowMs);
      return resolved;
    }
    // Try the auth-sms secret first, then the (legacy) Supabase secret.
    if (opts.authSmsJwtSecret) {
      const claims = verifyAuthSmsJwt(token, {
        secret: opts.authSmsJwtSecret,
        nowMs: opts.nowMs,
      });
      if (claims?.sub) {
        return { userId: claims.sub, source: "tnm_session" };
      }
    }
    const claims = verifySupabaseJwt(token, {
      secret: opts.jwtSecret ?? null,
      nowMs: opts.nowMs,
    });
    if (claims?.sub) {
      return { userId: claims.sub, source: "supabase" };
    }
    // Bearer was sent but invalid → fail closed.
    return null;
  }
  // 2. Dev fallback: X-User-Id header / ?user_id=.
  if (!opts.devAuth) return null;
  const headerUser = req.headers["x-user-id"];
  if (typeof headerUser === "string" && headerUser.length > 0) {
    return { userId: headerUser, source: "dev_header" };
  }
  if (Array.isArray(headerUser) && headerUser[0]) {
    return { userId: headerUser[0], source: "dev_header" };
  }
  const qs = req.query as Record<string, unknown> | undefined;
  if (qs && typeof qs.user_id === "string" && qs.user_id.length > 0) {
    return { userId: qs.user_id, source: "dev_header" };
  }
  return null;
}

/**
 * Resolve a `tnm_live_<...>` token to a user id. Looks up by the
 * stored prefix, then constant-time compares the scrypt hash. Bumps
 * `last_used_at` on success. Returns null if the key is unknown,
 * revoked, or malformed.
 *
 * Note: only the `key_prefix` is ever exposed to callers. The plaintext
 * is matched against the hash and immediately discarded.
 */
export function resolvePersonalKey(
  plaintext: string,
  store: GameStore,
  nowMs?: () => number,
): AuthResolution | null {
  const prefix = prefixFor(plaintext);
  if (!prefix) return null;
  const row = store.getUserApiKeyByPrefix(prefix);
  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (!verifyKey(plaintext, row.key_hash)) return null;
  const now = nowMs ? nowMs() : Date.now();
  try {
    store.touchUserApiKey(row.id, now);
  } catch {
    // Touching last_used_at is best-effort , a write failure here must
    // not deny a valid request. The audit log still has the call.
  }
  return {
    userId: row.user_id,
    source: "personal_key",
    keyId: row.id,
    keyPrefix: row.key_prefix,
  };
}

// ---------- JWT verification ----------

interface JwtClaims {
  sub: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string;
}

interface VerifyOptions {
  readonly secret: string | null;
  readonly nowMs?: () => number;
}

/**
 * HS256 verification of a Supabase JWT.
 *
 * Supabase signs auth JWTs with HS256 by default; the secret is on the
 * project's API settings page. We hand-roll the verification (rather
 * than pull in `jose`) because the algorithm is simple and the
 * footprint matters for the game-service cold-start.
 */
export function verifySupabaseJwt(
  token: string,
  opts: VerifyOptions,
): JwtClaims | null {
  if (!opts.secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", opts.secret).update(signingInput).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signatureB64, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let payload: JwtClaims;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as JwtClaims;
  } catch {
    return null;
  }

  if (!payload.sub) return null;

  const now = (opts.nowMs?.() ?? Date.now()) / 1000;
  if (payload.exp && payload.exp < now) return null;
  // Supabase issues `aud: "authenticated"` for user sessions; we don't
  // hard-fail on it but production deployments can layer that check.

  return payload;
}

/**
 * HS256 verification of the auth-sms `tnm_session` JWT.
 *
 * Same HMAC algorithm as the Supabase path but a different secret
 * (auth-sms's `AUTH_JWT_SECRET`) and different issuer claim
 * (`tournamental-auth`, audience `tournamental`). The `sub` is the
 * auth-sms user id (e.g. `u_<22 hex>`).
 *
 * We deliberately do NOT hard-fail on the iss/aud claims so this
 * verifier survives a future re-issuer rename; the secret is the
 * security boundary, not the claim strings.
 */
export function verifyAuthSmsJwt(
  token: string,
  opts: VerifyOptions,
): JwtClaims | null {
  if (!opts.secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", opts.secret).update(signingInput).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signatureB64, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let payload: JwtClaims;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as JwtClaims;
  } catch {
    return null;
  }

  if (!payload.sub) return null;

  const now = (opts.nowMs?.() ?? Date.now()) / 1000;
  if (payload.exp && payload.exp < now) return null;

  return payload;
}
