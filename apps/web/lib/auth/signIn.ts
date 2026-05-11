/**
 * Sign-in helpers, one per auth path.
 *
 *   signInWithMagicLink(email)       , Email magic link (Supabase built-in)
 *   signInWithTelegram(telegramAuth) , Telegram Login Widget payload
 *   signInWithWhatsAppOtp(phone)     , request OTP via Aiva SMS (custom SMS hook)
 *   verifyWhatsAppOtp(phone, code)   , verify OTP, sign session in
 *
 * Each helper returns a discriminated result; the modal UI maps these
 * to user-facing strings without leaking provider implementation
 * details.
 *
 * All four helpers are no-ops when Supabase is unconfigured, they
 * return `{ ok: false, error: "unconfigured" }`. The modal renders a
 * "Sign in coming soon" banner in that case.
 */

import { browserClient } from "./supabase";

export interface SignInResult {
  ok: boolean;
  error?: string;
  hint?: string;
}

/**
 * Email magic-link. Supabase emails the user a one-click link; the
 * `emailRedirectTo` lands them back on `/auth/callback` which exchanges
 * the code for a session cookie and bounces to `/world-cup-2026`.
 */
export async function signInWithMagicLink(
  email: string,
  redirectTo?: string,
): Promise<SignInResult> {
  const sb = browserClient();
  if (!sb) return { ok: false, error: "unconfigured" };
  const trimmed = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    return { ok: false, error: "bad-email" };
  }
  const { error } = await sb.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: redirectTo ?? defaultRedirect(),
      // We want to allow first-time signups via the same flow.
      shouldCreateUser: true,
    },
  });
  if (error) return { ok: false, error: error.message, hint: "send-failed" };
  return { ok: true, hint: "check-inbox" };
}

/**
 * Telegram Login Widget payload. The widget JS hands us
 * `{ id, first_name, username, photo_url, auth_date, hash }`. We POST
 * it to `/api/auth/telegram-callback` which verifies the HMAC signature
 * against the bot token, mints a Supabase session via the service-role
 * client, and sets the session cookie.
 */
export interface TelegramAuthPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export async function signInWithTelegram(
  payload: TelegramAuthPayload,
): Promise<SignInResult> {
  if (!isAuthConfigured()) return { ok: false, error: "unconfigured" };
  try {
    const res = await fetch("/api/auth/telegram-callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? "telegram-failed" };
    }
    // The callback responds 200 with a Set-Cookie; nothing else to do
    // beyond letting the auth state listener fire.
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * WhatsApp OTP, request. Calls Supabase's phone-auth provider; the
 * custom SMS hook (configured in the dashboard) fans the OTP out to
 * Aiva SMS / WhatsApp gateway.
 */
export async function signInWithWhatsAppOtp(phone: string): Promise<SignInResult> {
  const sb = browserClient();
  if (!sb) return { ok: false, error: "unconfigured" };
  const e164 = canonicaliseE164(phone);
  if (!e164) return { ok: false, error: "bad-phone" };
  const { error } = await sb.auth.signInWithOtp({
    phone: e164,
    options: { channel: "whatsapp" },
  });
  if (error) return { ok: false, error: error.message, hint: "send-failed" };
  return { ok: true, hint: "check-whatsapp" };
}

/** WhatsApp OTP, verify. */
export async function verifyWhatsAppOtp(
  phone: string,
  code: string,
): Promise<SignInResult> {
  const sb = browserClient();
  if (!sb) return { ok: false, error: "unconfigured" };
  const e164 = canonicaliseE164(phone);
  if (!e164) return { ok: false, error: "bad-phone" };
  if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: "bad-code" };
  const { error } = await sb.auth.verifyOtp({
    phone: e164,
    token: code.trim(),
    type: "sms",
  });
  if (error) return { ok: false, error: error.message, hint: "verify-failed" };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const sb = browserClient();
  if (!sb) return;
  await sb.auth.signOut();
}

// ---------- helpers ----------

function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function defaultRedirect(): string {
  if (typeof window === "undefined") return "/auth/callback";
  return `${window.location.origin}/auth/callback`;
}

function canonicaliseE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{8,15}$/.test(cleaned)) return "+" + cleaned;
  return "";
}
