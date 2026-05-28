/**
 * GET /api/admin/export/syndicates — CSV download of every pool.
 *
 * Pulls from `lib/live.ts::liveSyndicates`. Fields chosen for the most
 * common offline use: feed a spreadsheet to triage outreach + prize
 * payout planning.
 */

import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { liveSyndicates } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvEscape(v: string | number | boolean | null | undefined): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(): Promise<Response> {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const data = liveSyndicates("", "");
  const rows = data?.rows ?? [];

  const header = [
    "slug",
    "name",
    "visibility",
    "tier",
    "members",
    "tournament_id",
    "owner_handle",
    "owner_user_id",
    "prize_text",
    "entry_fee_cents",
    "entry_fee_currency",
    "total_stake_units",
    "created_at",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.slug,
        r.name,
        r.is_public ? "public" : "private",
        r.tier,
        r.members,
        r.tournament_id,
        r.owner_handle,
        r.owner_user_id,
        r.prize_text,
        r.entry_fee_cents,
        r.entry_fee_currency,
        r.total_stake_units,
        r.created_at,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const body = lines.join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tournamental-syndicates-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
