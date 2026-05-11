/**
 * POST /api/invite/mint
 *
 * Mints a short-lived invite code for the calling user. Used by:
 *   - Share-card renders (footer URL: play.tournamental.com/i/<code>)
 *   - Manual share buttons in the bracket UI
 *   - The Telegram bot (`source: "telegram_bot"`)
 *
 * Request body: `{ source?: "share_card" | "manual" | "telegram_bot" | "whatsapp_share" }`
 * Default: "manual".
 *
 * Response: `{ code, expires_at, deep_link }`
 *
 * Codes are 6 lowercase base-32 chars (alphabet 23456789abcdefghjkmnpqrstuvwxyz —
 * Crockford-style, no 0/1/l/o). One in 30^6 = ~700M collision space; we
 * retry on the rare collision.
 */

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

import { serverActionClient } from "@/lib/auth/supabase";

export const dynamic = "force-dynamic";

const VALID_SOURCES = [
  "share_card",
  "manual",
  "telegram_bot",
  "whatsapp_share",
] as const;
type Source = (typeof VALID_SOURCES)[number];

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_LENGTH = 6;
const DEFAULT_EXPIRY_DAYS = 30;
const PUBLIC_BASE =
  process.env.NEXT_PUBLIC_INVITE_BASE_URL || "https://play.tournamental.com";

interface Body {
  source?: string;
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const sb = serverActionClient({
    get: (name) => {
      const c = cookieStore.get(name);
      return c ? { value: c.value } : undefined;
    },
    set: () => undefined,
  });
  if (!sb) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }
  const { data: userData } = await sb.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // empty body is fine
  }
  const source: Source = VALID_SOURCES.includes(body.source as Source)
    ? (body.source as Source)
    : "manual";

  const expiresAt = new Date(
    Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Retry up to 4 times on collision.
  for (let i = 0; i < 4; i++) {
    const code = generateCode();
    const { error } = await sb.from("invite_codes").insert({
      code,
      user_id: me.id,
      source,
      expires_at: expiresAt,
    });
    if (!error) {
      return NextResponse.json({
        code,
        expires_at: expiresAt,
        deep_link: `${PUBLIC_BASE}/i/${code}`,
      });
    }
    if (!/(duplicate|unique)/i.test(error.message)) {
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "exhausted_collisions" }, { status: 500 });
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
