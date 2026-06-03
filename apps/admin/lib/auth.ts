/**
 * WhatsApp-OTP step-up auth + JWT session.
 *
 * The Tournamental admin console is fronted by Cloudflare Access (the
 * outer perimeter — set up in the CF dashboard). When a CF Access-cleared
 * visitor reaches this app, they still pass through a step-up gate:
 *
 *   1. GET /login → "Send code" button (no inputs; the admin phone is
 *      hard-wired server-side so a hostile bot that landed inside CF
 *      Access still can't enumerate or spam an arbitrary number).
 *   2. POST /api/auth/request → admin server calls
 *      `auth-sms /v1/auth/request` with the configured phone +
 *      WhatsApp channel. Response is opaque to the browser.
 *   3. The owner receives the 6-digit OTP on WhatsApp and enters it.
 *   4. POST /api/auth/verify {code} → admin server calls
 *      `auth-sms /v1/auth/verify-by-code`. On 200, the response body
 *      contains the verified user id. We check it against
 *      `ADMIN_ALLOWED_USER_IDS`, then mint an `admin_session` JWT
 *      (HS256, 24h ttl) and set it as `__Host-admin` (prod) or
 *      `admin-session` (dev): HttpOnly, Secure, SameSite=Lax, Path=/.
 *   5. Subsequent requests carry the cookie; middleware blocks any
 *      route outside `/login` + `/api/auth/*` without it.
 *   6. On cookie expiry, the user is bounced back to `/login` and the
 *      OTP flow starts again.
 *
 * Why hardcode the phone? Surface defence: an attacker who somehow gets
 * past CF Access still cannot direct OTPs to a number they control.
 * The allowlisted user_id check on /verify is the second layer.
 *
 * Why 24h: long enough that Tim doesn't re-OTP every visit, short
 * enough that a stolen device loses access within a working day.
 *
 * Why not reuse the apex `tnm_session` cookie: admin is a separate
 * authority domain. A user signed into play.tournamental.com must not
 * automatically be admin; conversely an admin cookie should not grant
 * any play.tournamental.com powers.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "./perms";

const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-admin" : "admin-session";
const SESSION_TTL_S = 24 * 60 * 60;

export interface AdminSession {
  /** auth-sms user id (e.g. `u_be5a445cff4347f6ae6089`). */
  readonly userId: string;
  /**
   * Display label for the operator. Today this is the masked phone (e.g.
   * `+64****5832`) since we sign in by phone, not email. Kept as `email`
   * for backward-compat with pages that render `session.email`. When we
   * add multi-operator support, this becomes the operator's display name.
   */
  readonly email: string;
  /**
   * Role for in-app permission gating (see `lib/perms.ts`). Hard-coded
   * to `"super-admin"` while there's a single operator (Tim); becomes
   * env-driven when the ops team grows.
   */
  readonly role: Role;
  readonly iat: number;
  readonly exp: number;
}

function getSecret(): Uint8Array {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("ADMIN_JWT_SECRET missing or too short (min 32 chars).");
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(s, "utf-8"));
  }
  return new TextEncoder().encode(s);
}

/**
 * Parse `ADMIN_ALLOWED_USER_IDS` into a Set. Comma-separated auth-sms
 * user ids (e.g. `u_be5a445cff4347f6ae6089`). Empty Set when unset —
 * `isLoginEnabled` then rejects everything.
 */
export function getAllowedUserIds(): Set<string> {
  const raw = process.env.ADMIN_ALLOWED_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Configured admin phone (E.164). Server-side only — never sent to the
 *  browser. Unset → login disabled. */
export function getAdminPhone(): string | null {
  const p = (process.env.ADMIN_PHONE_E164 ?? "").trim();
  if (!p.startsWith("+") || p.length < 8) return null;
  return p;
}

/** Auth-SMS public origin. Defaults to the prod host so the dashboard
 *  works out of the box when `ADMIN_AUTH_SMS_BASE_URL` isn't set. */
export function getAuthSmsBase(): string {
  return (
    process.env.ADMIN_AUTH_SMS_BASE_URL ?? "https://auth.tournamental.com"
  ).replace(/\/+$/, "");
}

/**
 * Returns true if the dashboard accepts logins. False when either the
 * phone or the allowlist is unconfigured — the OTP form refuses input
 * and `/api/auth/request` responds 503.
 */
export function isLoginEnabled(): boolean {
  return getAdminPhone() !== null && getAllowedUserIds().size > 0;
}

/** Mask a phone for display: `+6421535832` → `+64****5832`. */
export function maskAdminPhone(phone: string): string {
  if (phone.length < 6) return phone;
  const head = phone.slice(0, 3);
  const tail = phone.slice(-4);
  const stars = "*".repeat(Math.max(2, phone.length - head.length - tail.length));
  return `${head}${stars}${tail}`;
}

export async function issueSessionCookie(args: {
  readonly userId: string;
  readonly displayLabel: string;
}): Promise<{ value: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_S;
  const value = await new SignJWT({
    email: args.displayLabel,
    role: "super-admin" as Role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setSubject(args.userId)
    .setExpirationTime(exp)
    .setAudience("admin-session")
    .sign(getSecret());
  return { value, expiresAt: exp * 1000 };
}

export async function readSession(): Promise<AdminSession | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE);
  if (!cookie?.value) return null;
  try {
    const { payload } = await jwtVerify(cookie.value, getSecret(), {
      audience: "admin-session",
    });
    const userId = String(payload.sub ?? "");
    if (!userId) return null;
    // Re-check the allowlist on every request — pulling Tim's id out of
    // ADMIN_ALLOWED_USER_IDS revokes access on the next request without
    // waiting for cookie expiry.
    if (!getAllowedUserIds().has(userId)) return null;
    const email = String(payload.email ?? userId);
    const role = (payload.role as Role) ?? "super-admin";
    return {
      userId,
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
 * Server-action / route guard. Redirects to `/login` if not
 * authenticated. Returns the resolved session otherwise.
 */
export async function requireAuth(): Promise<AdminSession> {
  const s = await readSession();
  if (!s) {
    const next = (await headers()).get("x-admin-path") ?? "/";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return s!;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_TTL_SECONDS = SESSION_TTL_S;
