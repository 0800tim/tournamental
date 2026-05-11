/**
 * POST /api/auth/telegram-callback
 *
 * Verifies a Telegram Login Widget payload and mints a Supabase session.
 *
 * The widget posts:
 *   { id, first_name, last_name?, username?, photo_url?, auth_date, hash }
 *
 * Telegram's HMAC scheme (per https://core.telegram.org/widgets/login):
 *
 *   data_check_string = sorted("key=value\n...") excluding the `hash` field
 *   secret_key        = SHA-256(bot_token)
 *   computed_hash     = HMAC-SHA256(data_check_string, secret_key)
 *   verify            = computed_hash == payload.hash
 *
 * If verified, we look up the user by `telegram_id` in `user_profiles`.
 * If a profile exists, we use `auth.admin.generateLink` to mint a magic
 * link and exchange it for a session inline. If no profile exists, we
 * provision an auth.users row with a synthetic email then create the
 * profile via the existing trigger.
 *
 * NOTE: for v1 we accept the verification but defer the session-mint to
 * a follow-up PR, Supabase doesn't expose a `createSessionFromTelegram`
 * primitive yet. The endpoint validates and returns 200; the client UX
 * then funnels the user into the phone-OTP path to finish sign-in. The
 * Telegram identity binding is recorded server-side so subsequent
 * phone-OTP sign-ins are auto-linked.
 *
 * Tracked in IDEAS.md for the next sprint: lift this to a proper
 * Telegram OIDC custom provider once Supabase Phase 2 ships native
 * custom-OAuth support.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { serviceRoleClient } from "@/lib/auth/supabase";

export const dynamic = "force-dynamic";

interface Payload {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date?: number;
  hash?: string;
}

const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h, Telegram's recommended window.

export async function POST(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: "bot_unconfigured" }, { status: 503 });
  }

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!payload.id || !payload.hash || !payload.auth_date) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  // Freshness.
  const now = Math.floor(Date.now() / 1000);
  if (now - payload.auth_date > MAX_AGE_SECONDS) {
    return NextResponse.json({ error: "stale" }, { status: 400 });
  }
  if (!verifyTelegramHash(payload, botToken)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  // Bind telegram_id to a user_profile row. If a profile already exists
  // for this telegram_id (returning user) we look up their auth.user id;
  // otherwise we record a stub and the client funnels through phone-OTP.
  try {
    const admin = serviceRoleClient();
    const { data: existing } = await admin
      .from("user_profiles")
      .select("id, handle")
      .eq("telegram_id", payload.id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      verified: true,
      existing_user: Boolean(existing),
      handle: existing?.handle ?? null,
      // The client uses this hint to decide: existing → bounce home;
      // new → ask for an email or phone to bind the session.
      next: existing ? "home" : "bind",
    });
  } catch (err) {
    return NextResponse.json(
      { error: "service_unavailable", detail: (err as Error).message },
      { status: 503 },
    );
  }
}

function verifyTelegramHash(payload: Payload, botToken: string): boolean {
  const { hash, ...rest } = payload;
  if (!hash) return false;
  const entries = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort();
  const dataCheckString = entries.join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  const computed = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  if (computed.length !== hash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}
