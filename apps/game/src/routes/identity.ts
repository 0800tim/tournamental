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

export interface ResolveOptions {
  /** Allow X-User-Id / ?user_id= when no Bearer token is supplied. */
  readonly devAuth?: boolean;
  /** HMAC secret for verifying Supabase JWTs (HS256). */
  readonly jwtSecret?: string | null;
  /** Clock override for tests. */
  readonly nowMs?: () => number;
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
  // 1. Bearer JWT (production path).
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    const claims = verifySupabaseJwt(token, {
      secret: opts.jwtSecret ?? null,
      nowMs: opts.nowMs,
    });
    if (claims?.sub) return claims.sub;
    // Bearer was sent but invalid → fail closed.
    return null;
  }
  // 2. Dev fallback: X-User-Id header / ?user_id=.
  if (!opts.devAuth) return null;
  const headerUser = req.headers["x-user-id"];
  if (typeof headerUser === "string" && headerUser.length > 0) return headerUser;
  if (Array.isArray(headerUser) && headerUser[0]) return headerUser[0];
  const qs = req.query as Record<string, unknown> | undefined;
  if (qs && typeof qs.user_id === "string" && qs.user_id.length > 0) {
    return qs.user_id;
  }
  return null;
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
