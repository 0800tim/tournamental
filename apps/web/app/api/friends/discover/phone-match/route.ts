/**
 * POST /api/friends/discover/phone-match
 *
 * Phone-number friend discovery.
 *
 * Request body:
 *   { hashes: string[] }    // SHA-256 hex hashes of E.164 phones,
 *                           // hashed client-side with the salt returned
 *                           // from GET /api/auth/phone-salt (server holds
 *                           // the salt; client never sees the raw phones
 *                           // of OTHER users).
 *
 * The salt is server-only. The client receives it temporarily to compute
 * hashes locally, then discards it. This is the "blind index" pattern.
 *
 * Privacy gate: phone-match is opt-in on BOTH sides. A row is only
 * created when both parties have `phone_match_consent = true`.
 *
 * Response:
 *   {
 *     matched: [{ user_id, handle, display_name, country_code }],
 *     count_in: <number of hashes posted>,
 *     count_out: <number of matched profiles>,
 *     friendships_created: <number>
 *   }
 */

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { serverActionClient, serviceRoleClient } from "@/lib/auth/supabase";
import { readPublicConfig } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

const MAX_HASHES = 2000;

interface DiscoverBody {
  hashes?: string[];
}

export async function POST(req: NextRequest) {
  const cfg = readPublicConfig();
  if (!cfg) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }

  // Identify the caller from the session cookie.
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

  let body: DiscoverBody;
  try {
    body = (await req.json()) as DiscoverBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const hashes = Array.isArray(body.hashes) ? body.hashes : [];
  if (hashes.length === 0) {
    return NextResponse.json({ error: "no_hashes" }, { status: 400 });
  }
  if (hashes.length > MAX_HASHES) {
    return NextResponse.json({ error: "too_many" }, { status: 400 });
  }
  for (const h of hashes) {
    if (typeof h !== "string" || !/^[a-f0-9]{64}$/i.test(h)) {
      return NextResponse.json({ error: "bad_hash" }, { status: 400 });
    }
  }

  // Confirm the caller has opted in.
  const { data: meProfile } = await sb
    .from("user_profiles")
    .select("phone_match_consent")
    .eq("id", me.id)
    .maybeSingle();
  if (!meProfile?.phone_match_consent) {
    return NextResponse.json(
      { error: "consent_required", hint: "Toggle phone-match in /profile." },
      { status: 403 },
    );
  }

  const admin = serviceRoleClient();
  const { data: matched, error } = await admin
    .from("user_profiles")
    .select(
      "id, handle, display_name, country_code, phone_match_consent",
    )
    .in("whatsapp_phone_hash", hashes);
  if (error) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  const eligible = (matched ?? []).filter(
    (m) => m.id !== me.id && m.phone_match_consent,
  );

  // Insert mutual friendships idempotently.
  let friendshipsCreated = 0;
  for (const friend of eligible) {
    const rows = [
      { user_id: me.id, friend_id: friend.id, source: "phone_match" as const },
      { user_id: friend.id, friend_id: me.id, source: "phone_match" as const },
    ];
    const { error: upsertErr } = await admin
      .from("friendships")
      .upsert(rows, { onConflict: "user_id,friend_id" });
    if (!upsertErr) friendshipsCreated += rows.length;
  }

  return NextResponse.json({
    matched: eligible.map((m) => ({
      user_id: m.id,
      handle: m.handle,
      display_name: m.display_name,
      country_code: m.country_code,
    })),
    count_in: hashes.length,
    count_out: eligible.length,
    friendships_created: friendshipsCreated,
  });
}
