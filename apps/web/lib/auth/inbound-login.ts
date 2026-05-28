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
 *
 * Server returns the raw `{ jwt, expiresAt, user }` shape (no
 * `ok: true` field) — we wrap it here so the discriminated-union
 * `InboundVerifyResult` works downstream. Without the wrap every
 * successful verify fell into the error branch on the client
 * (Tim 2026-05-22, "codes and magic links just aren't working").
 */
export async function verifyInboundCode(code: string): Promise<InboundVerifyResult> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "bad-body" };
  const res = await postJson<Omit<InboundVerifyOk, "ok">>("/v1/auth/verify-by-code", { code });
  if (res.ok && "jwt" in res.body) {
    return { ok: true, ...(res.body as Omit<InboundVerifyOk, "ok">) };
  }
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
  const res = await postJson<Omit<InboundVerifyOk, "ok">>("/v1/auth/magic-verify", { token });
  if (res.ok && "jwt" in res.body) {
    return { ok: true, ...(res.body as Omit<InboundVerifyOk, "ok">) };
  }
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

// --- Email OTP ---------------------------------------------------------

export interface EmailRequestOk {
  readonly ok: true;
  readonly expiresInSeconds: number;
}
export interface EmailRequestErr {
  readonly ok: false;
  readonly error:
    | "bad-body"
    | "cooldown"
    | "hourly-cap"
    | "send-failed"
    | "not-configured"
    | "network"
    | "unknown";
  readonly retryAfterSeconds?: number;
}
export type EmailRequestResult = EmailRequestOk | EmailRequestErr;

/** Ask auth-sms to email a 6-digit OTP. */
export async function requestEmailOtp(email: string): Promise<EmailRequestResult> {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "bad-body" };
  }
  const res = await postJson<EmailRequestOk>("/v1/auth/email/request", {
    email: trimmed,
  });
  if (res.ok && "expiresInSeconds" in (res.body as object)) {
    return res.body as EmailRequestOk;
  }
  const body = res.body as ApiErrorBody;
  const err = body.error ?? "unknown";
  const allowed: EmailRequestErr["error"][] = [
    "bad-body",
    "cooldown",
    "hourly-cap",
    "send-failed",
    "not-configured",
    "network",
  ];
  const code = (allowed as string[]).includes(err)
    ? (err as EmailRequestErr["error"])
    : "unknown";
  return {
    ok: false,
    error: code,
    retryAfterSeconds: body.retryAfterSeconds,
  };
}

// ---- Outbound phone OTP (SMS / WhatsApp) ----------------------------

export interface PhoneRequestOk {
  readonly ok: true;
  readonly channel: "sms" | "whatsapp";
  readonly phoneMasked: string;
  readonly expiresInSeconds: number;
}

export interface PhoneRequestErr {
  readonly ok: false;
  readonly error:
    | "bad-body"
    | "bad-phone"
    | "bad-channel"
    | "rate-limited"
    | "send-failed"
    | "not-configured"
    | "network"
    | "unknown";
  readonly retryAfterSeconds?: number;
}

export type PhoneRequestResult = PhoneRequestOk | PhoneRequestErr;

/**
 * Ask auth-sms to send a 6-digit OTP to a phone via SMS or WhatsApp.
 * Used by the CRM-invite warm-join flow where we already know the
 * user's mobile number (passed in via ?mobile=... query string) and
 * want to bootstrap them straight to a code-entry screen without
 * making them re-type their number.
 *
 * Tim 2026-05-28.
 */
export async function requestPhoneOtp(
  phone: string,
  channel: "sms" | "whatsapp",
  poolSlug?: string | null,
): Promise<PhoneRequestResult> {
  const trimmed = (phone ?? "").trim();
  if (!trimmed) return { ok: false, error: "bad-phone" };
  const body: Record<string, unknown> = { phone: trimmed, channel };
  if (poolSlug && /^[a-z0-9-]{1,64}$/i.test(poolSlug)) body.pool_slug = poolSlug;
  const res = await postJson<PhoneRequestOk>("/v1/auth/request", body);
  if (res.ok && "expiresInSeconds" in (res.body as object)) {
    return res.body as PhoneRequestOk;
  }
  const errBody = res.body as ApiErrorBody;
  const raw = errBody.error ?? "unknown";
  const allowed: PhoneRequestErr["error"][] = [
    "bad-body",
    "bad-phone",
    "bad-channel",
    "rate-limited",
    "send-failed",
    "not-configured",
    "network",
  ];
  const code = (allowed as string[]).includes(raw)
    ? (raw as PhoneRequestErr["error"])
    : "unknown";
  return {
    ok: false,
    error: code,
    retryAfterSeconds: errBody.retryAfterSeconds,
  };
}

/** Verify the emailed 6-digit code and mint a session (cookie set apex-wide). */
export async function verifyEmailOtp(
  email: string,
  code: string,
): Promise<InboundVerifyResult> {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "bad-body" };
  }
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "bad-body" };
  const res = await postJson<Omit<InboundVerifyOk, "ok">>("/v1/auth/email/verify", {
    email: trimmed,
    code,
  });
  if (res.ok && "jwt" in res.body) {
    return { ok: true, ...(res.body as Omit<InboundVerifyOk, "ok">) };
  }
  const err = (res.body as ApiErrorBody).error ?? "unknown";
  return {
    ok: false,
    error: normaliseError(err),
    retryAfterSeconds: (res.body as ApiErrorBody).retryAfterSeconds,
  };
}

/** wa.me deep-link with `login` pre-filled. Opens the user's WhatsApp.
 * When a pool slug is supplied the pre-filled text becomes
 * `login pool=<slug>`, which the aiva-sms inbound parser can route into
 * a magic-link URL that carries `?pool=<slug>` so the post-auth bounce
 * lands on /s/<slug>. The same-device localStorage fallback in
 * MagicLinkConsumer covers older aiva-sms builds that ignore the
 * suffix. */
export function whatsAppLoginDeepLink(poolSlug?: string | null): string {
  const slug =
    poolSlug && /^[a-z0-9-]{1,64}$/i.test(poolSlug)
      ? poolSlug.toLowerCase()
      : null;
  const text = slug ? `login pool=${slug}` : "login";
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

/** sms: deep-link with `login` pre-filled. NZ/AU only. */
export function smsLoginDeepLink(poolSlug?: string | null): string {
  const slug =
    poolSlug && /^[a-z0-9-]{1,64}$/i.test(poolSlug)
      ? poolSlug.toLowerCase()
      : null;
  const body = slug ? `login pool=${slug}` : "login";
  return `sms:+${SMS_NUMBER}?&body=${encodeURIComponent(body)}`;
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

/**
 * Full user record returned by /v1/auth/me and the PATCH endpoint.
 * Mirrors the auth-sms serialiseUser() shape.
 */
export interface InboundUser {
  id: string;
  phone: string | null;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  city: string | null;
  favouriteTeamCode: string | null;
  telegramUsername: string | null;
  createdAt: number;
  lastSeenAt: number;
}

/** GET /v1/auth/me — returns the full user record or null on no session. */
export async function fetchInboundUser(signal?: AbortSignal): Promise<InboundUser | null> {
  try {
    const r = await fetch(AUTH_BASE.replace(/\/$/, "") + "/v1/auth/me", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { user?: InboundUser };
    return j.user ?? null;
  } catch {
    return null;
  }
}

/** Profile patch payload. snake_case fields match the server. */
export interface InboundProfilePatch {
  display_name?: string | null;
  country?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  favourite_team_code?: string | null;
}

export interface InboundUpdateOk {
  readonly ok: true;
  readonly user: InboundUser;
}
export interface InboundUpdateErr {
  readonly ok: false;
  readonly error: "unauthorized" | "bad-email" | "email-taken" | "network" | "unknown";
}

/** PATCH /v1/auth/me — applies the patch and returns the updated user. */
export async function updateInboundProfile(
  patch: InboundProfilePatch,
): Promise<InboundUpdateOk | InboundUpdateErr> {
  try {
    const r = await fetch(AUTH_BASE.replace(/\/$/, "") + "/v1/auth/me", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(patch),
    });
    const j = (await r.json().catch(() => ({}))) as {
      user?: InboundUser;
      error?: string;
    };
    if (r.ok && j.user) return { ok: true, user: j.user };
    const err = j.error ?? "unknown";
    if (err === "bad-email" || err === "email-taken" || err === "unauthorized") {
      return { ok: false, error: err };
    }
    return { ok: false, error: "unknown" };
  } catch {
    return { ok: false, error: "network" };
  }
}
