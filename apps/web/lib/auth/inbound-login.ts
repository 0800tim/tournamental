/**
 * Inbound-login client helpers for play.tournamental.com.
 *
 * The play app talks to the auth-sms service at
 * https://auth.tournamental.com via two endpoints:
 *
 *   POST /v1/auth/verify-by-code  — user pasted a 6-digit code in the modal
 *   POST /v1/auth/magic-verify    — user landed on ?v=<token> in the URL
 *
 * Both endpoints set a `tnm_session` cookie on `.tournamental.com` so
 * both play.tournamental.com and tournamental.com see the same
 * session. The `credentials: 'include'` flag below is what lets the
 * browser accept that cookie cross-origin.
 *
 * This file is intentionally independent of Supabase: the inbound-login
 * flow works whether or not NEXT_PUBLIC_SUPABASE_URL is set. The legacy
 * Supabase email + Telegram paths still live in `signIn.ts`.
 */

export const AUTH_BASE =
  process.env.NEXT_PUBLIC_AUTH_BASE_URL ?? "https://auth.tournamental.com";

/**
 * Public WhatsApp number for the Aiva SMS gateway. Replace if you
 * fork Tournamental and run your own gateway.
 */
export const WHATSAPP_NUMBER = "64204259096";
export const SMS_NUMBER = "64204259096";

export interface InboundVerifyOk {
  readonly ok: true;
  readonly jwt: string;
  readonly expiresAt: number;
  readonly user: {
    readonly id: string;
    readonly phone: string | null;
    readonly displayName: string | null;
    readonly country: string | null;
  };
}

export interface InboundVerifyErr {
  readonly ok: false;
  readonly error:
    | "bad-body"
    | "unknown-or-expired"
    | "fingerprint-mismatch"
    | "ip-throttled"
    | "network"
    | "unknown";
  readonly retryAfterSeconds?: number;
}

export type InboundVerifyResult = InboundVerifyOk | InboundVerifyErr;

interface ApiErrorBody {
  readonly error?: string;
  readonly retryAfterSeconds?: number;
}

async function postJson<T>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; body: T | ApiErrorBody }> {
  try {
    const r = await fetch(AUTH_BASE.replace(/\/$/, "") + path, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await r.json().catch(() => ({}))) as T | ApiErrorBody;
    return { ok: r.ok, status: r.status, body: json };
  } catch {
    return { ok: false, status: 0, body: { error: "network" } };
  }
}

/**
 * Verify a 6-digit code pasted by the user. The auth-sms service
 * scans all active OTP rows, matches by HMAC, and mints a session.
 */
export async function verifyInboundCode(code: string): Promise<InboundVerifyResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "bad-body" };
  const res = await postJson<InboundVerifyOk>("/v1/auth/verify-by-code", { code });
  if (res.ok && "jwt" in res.body) return res.body;
  const err = (res.body as ApiErrorBody).error ?? "unknown";
  return {
    ok: false,
    error: normaliseError(err),
    retryAfterSeconds: (res.body as ApiErrorBody).retryAfterSeconds,
  };
}

/**
 * Verify a magic-link token (the `?v=<token>` query param). The
 * auth-sms service consumes the token and mints a session.
 */
export async function verifyMagicToken(token: string): Promise<InboundVerifyResult> {
  if (!/^[a-f0-9]{64}$/i.test(token)) return { ok: false, error: "bad-body" };
  const res = await postJson<InboundVerifyOk>("/v1/auth/magic-verify", { token });
  if (res.ok && "jwt" in res.body) return res.body;
  const err = (res.body as ApiErrorBody).error ?? "unknown";
  return {
    ok: false,
    error: normaliseError(err),
    retryAfterSeconds: (res.body as ApiErrorBody).retryAfterSeconds,
  };
}

function normaliseError(raw: string): InboundVerifyErr["error"] {
  switch (raw) {
    case "bad-body":
    case "unknown-or-expired":
    case "fingerprint-mismatch":
    case "ip-throttled":
    case "network":
      return raw;
    default:
      return "unknown";
  }
}

/** wa.me deep-link with `login` pre-filled. Opens the user's WhatsApp. */
export function whatsAppLoginDeepLink(): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=login`;
}

/** sms: deep-link with `login` pre-filled. NZ/AU only. */
export function smsLoginDeepLink(): string {
  return `sms:+${SMS_NUMBER}?&body=login`;
}

/**
 * Heuristic country detection used to gate the SMS button. Returns
 * "NZ" / "AU" / null. Pure-client; not used as a security boundary.
 */
export function detectSmsCountry(): "NZ" | "AU" | null {
  if (typeof window === "undefined") return null;
  const locale = (navigator.language || "").toUpperCase();
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {}
  if (locale.endsWith("-NZ") || tz === "Pacific/Auckland") return "NZ";
  if (locale.endsWith("-AU") || /^Australia\//.test(tz)) return "AU";
  return null;
}
