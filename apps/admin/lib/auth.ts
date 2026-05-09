/**
 * Magic-link auth + JWT session.
 *
 * Flow:
 *   1. User enters email at /login.
 *   2. POST /api/auth/request creates a one-time token (15 min TTL),
 *      signs it with ADMIN_JWT_SECRET, and either logs the resulting
 *      URL (dev) or sends it via Resend / Mailgun (prod).
 *   3. User clicks the link → GET /api/auth/callback?token=...
 *   4. Callback verifies the token, mints a session JWT (8h, HS256),
 *      and sets it as an `__Host-admin` HTTP-only, Secure, SameSite=Lax
 *      cookie. (`__Host-` cookies in production require Secure + path=/
 *      and forbid the Domain attribute, providing CSRF resistance.)
 *   5. Subsequent requests carry the cookie; middleware verifies and
 *      rejects unauth'd requests outside `/login` and `/api/auth/*`.
 *
 * Hardening:
 *   - Email allowlist enforced at *both* request-link and verify-callback
 *     time. A leaked link cannot be used to log in as someone removed
 *     from ADMIN_EMAILS between issue and click.
 *   - One-time token includes a `nonce` claim that is *not* persisted —
 *     this is acceptable for the v0 console because tokens are short-TTL
 *     and the JWT signature alone prevents tampering. A future hardening
 *     pass should record nonces in Redis to cap to a single use per token.
 *   - Session cookies set HttpOnly, Secure (in prod), SameSite=Lax to
 *     mitigate XSS and CSRF.
 *   - `requireAuth()` defaults to *deny* on missing/invalid token.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  parseAllowlist,
  parseRoleMap,
  roleFor,
  type Role,
} from "./perms";

const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-admin" : "admin-session";
const SESSION_TTL_S = 8 * 60 * 60; // 8 hours
const MAGIC_LINK_TTL_S = 15 * 60; // 15 minutes

export interface AdminSession {
  email: string;
  role: Role;
  iat: number;
  exp: number;
}

interface MagicLinkPayload extends JWTPayload {
  email: string;
  nonce: string;
}

function getSecret(): Uint8Array {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("ADMIN_JWT_SECRET missing or too short (min 32 chars).");
  }
  // Use Buffer when available (Node) so the jose `instanceof Uint8Array`
  // check passes regardless of jsdom polyfilling TextEncoder with a
  // class whose output isn't from the same realm as Node's Uint8Array.
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(s, "utf-8"));
  }
  return new TextEncoder().encode(s);
}

export function getAllowlist(): Set<string> {
  return parseAllowlist(process.env.ADMIN_EMAILS);
}

export function getRoleMap() {
  return parseRoleMap(process.env.ADMIN_ROLES);
}

/**
 * Returns true if the dashboard accepts logins. False when ADMIN_EMAILS is
 * empty or unset — login form rejects everything in that case.
 */
export function isLoginEnabled(): boolean {
  return getAllowlist().size > 0;
}

export async function createMagicLink(email: string): Promise<{
  url: string;
  expiresAt: number;
} | null> {
  const allowlist = getAllowlist();
  const norm = email.trim().toLowerCase();
  if (!allowlist.has(norm)) return null;

  const nonce = cryptoRandom(16);
  const expSec = Math.floor(Date.now() / 1000) + MAGIC_LINK_TTL_S;
  const token = await new SignJWT({ email: norm, nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setSubject(norm)
    .setExpirationTime(expSec)
    .setAudience("admin-magic-link")
    .sign(getSecret());

  const base = process.env.ADMIN_BASE_URL ?? "http://localhost:3340";
  const url = `${base.replace(/\/$/, "")}/api/auth/callback?token=${encodeURIComponent(token)}`;
  return { url, expiresAt: expSec * 1000 };
}

export async function verifyMagicLink(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify<MagicLinkPayload>(token, getSecret(), {
      audience: "admin-magic-link",
    });
    const allowlist = getAllowlist();
    const roleMap = getRoleMap();
    const email = String(payload.email ?? "").toLowerCase();
    const role = roleFor(email, allowlist, roleMap);
    if (!role) return null;
    const now = Math.floor(Date.now() / 1000);
    return {
      email,
      role,
      iat: now,
      exp: now + SESSION_TTL_S,
    };
  } catch {
    return null;
  }
}

export async function issueSessionCookie(session: AdminSession): Promise<string> {
  const jwt = await new SignJWT({ email: session.email, role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(session.iat)
    .setSubject(session.email)
    .setExpirationTime(session.exp)
    .setAudience("admin-session")
    .sign(getSecret());
  return jwt;
}

export async function readSession(): Promise<AdminSession | null> {
  const cookie = cookies().get(SESSION_COOKIE);
  if (!cookie?.value) return null;
  try {
    const { payload } = await jwtVerify(cookie.value, getSecret(), {
      audience: "admin-session",
    });
    const email = String(payload.email ?? "").toLowerCase();
    const role = (payload.role as Role) ?? "viewer";
    if (!email) return null;
    // Re-check the allowlist on every request — removing an admin from
    // ADMIN_EMAILS revokes their access on next request.
    if (!getAllowlist().has(email)) return null;
    return {
      email,
      role,
      iat: Number(payload.iat ?? 0),
      exp: Number(payload.exp ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Server-action / route guard. Redirects to /login if not authenticated
 * (or no role mapped). Returns the resolved session otherwise.
 */
export async function requireAuth(): Promise<AdminSession> {
  const s = await readSession();
  if (!s) {
    const next = headers().get("x-admin-path") ?? "/";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return s!;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_TTL_SECONDS = SESSION_TTL_S;

function cryptoRandom(n: number): string {
  // Edge-runtime-safe random nonce.
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
