/**
 * POST /api/friends/discover/telegram
 *
 * Telegram-bot friend discovery.
 *
 * Called by the tournament-bot service after a Telegram-bound user
 * signs in. The bot enumerates the user's shared-group members and
 * POSTs the list of telegram numeric IDs here. We match against
 * `user_profiles.telegram_id` and write the friendship rows.
 *
 * Auth: this endpoint trusts the `X-Tournamental-Internal` shared
 * secret (set in the tournament-bot env). It never exposes a user's
 * telegram_id back to the browser.
 */

import { NextResponse, type NextRequest } from "next/server";

import { serviceRoleClient } from "@/lib/auth/supabase";
import { readPublicConfig } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

interface Body {
  user_id?: string;
  telegram_ids?: number[];
}

const INTERNAL_HEADER = "x-tournamental-internal";
const MAX_IDS = 2000;

export async function POST(req: NextRequest) {
  const cfg = readPublicConfig();
  if (!cfg) {
    return NextResponse.json({ error: "unconfigured" }, { status: 503 });
  }

  const secret = process.env.TOURNAMENTAL_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "internal_secret_missing" }, { status: 503 });
  }
  const presented = req.headers.get(INTERNAL_HEADER);
  if (!presented || presented !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.user_id || typeof body.user_id !== "string") {
    return NextResponse.json({ error: "missing_user_id" }, { status: 400 });
  }
  const ids = Array.isArray(body.telegram_ids) ? body.telegram_ids : [];
  if (ids.length === 0) {
    return NextResponse.json({
      matched: [],
      count_in: 0,
      count_out: 0,
      friendships_created: 0,
    });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: "too_many" }, { status: 400 });
  }
  for (const id of ids) {
    if (typeof id !== "number" || !Number.isFinite(id)) {
      return NextResponse.json({ error: "bad_id" }, { status: 400 });
    }
  }

  const admin = serviceRoleClient();
  const { data: matched, error } = await admin
    .from("user_profiles")
    .select("id, handle, telegram_id")
    .in("telegram_id", ids);
  if (error) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  let friendshipsCreated = 0;
  for (const friend of matched ?? []) {
    if (friend.id === body.user_id) continue;
    const rows = [
      { user_id: body.user_id, friend_id: friend.id, source: "telegram" as const },
      { user_id: friend.id, friend_id: body.user_id, source: "telegram" as const },
    ];
    const { error: upsertErr } = await admin
      .from("friendships")
      .upsert(rows, { onConflict: "user_id,friend_id" });
    if (!upsertErr) friendshipsCreated += rows.length;
  }

  return NextResponse.json({
    matched: (matched ?? []).map((m) => ({
      user_id: m.id,
      handle: m.handle,
      telegram_id: m.telegram_id,
    })),
    count_in: ids.length,
    count_out: matched?.length ?? 0,
    friendships_created: friendshipsCreated,
  });
}
