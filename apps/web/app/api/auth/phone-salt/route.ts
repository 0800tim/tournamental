/**
 * GET /api/auth/phone-salt
 *
 * Returns the server-side phone-hash salt so the friend-discovery client
 * can compute SHA-256(salt + e164) locally and POST the hashes to
 * /api/friends/discover/phone-match.
 *
 * Auth: must be signed in AND must have `phone_match_consent = true`.
 * The salt is sensitive (without it, hashes are rainbow-table-able), so
 * we never hand it to a user who hasn't opted in.
 *
 * Caching: per-user, never cached.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { serverActionClient } from "@/lib/auth/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const salt = process.env.SUPABASE_PHONE_HASH_SALT;
  if (!salt) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }
  const cookieStore = await cookies();
  const sb = serverActionClient({
    get: (name) => {
      const c = cookieStore.get(name);
      return c ? { value: c.value } : undefined;
    },
    set: () => undefined,
  });
  if (!sb) return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  const { data: userData } = await sb.auth.getUser();
  const me = userData?.user;
  if (!me) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: profile } = await sb
    .from("user_profiles")
    .select("phone_match_consent")
    .eq("id", me.id)
    .maybeSingle();
  if (!profile?.phone_match_consent) {
    return NextResponse.json({ error: "consent_required" }, { status: 403 });
  }
  const res = NextResponse.json({ salt });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
