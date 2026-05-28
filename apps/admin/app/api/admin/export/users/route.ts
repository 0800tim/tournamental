/**
 * GET /api/admin/export/users — CSV download of every user in auth.db.
 *
 * Always requires an authenticated admin session (re-checks the cookie
 * on each request). The CSV is generated server-side from the same
 * live reader the admin Users page uses, so the export and the UI can
 * never diverge.
 *
 * Fields: id, display_name, email, phone (masked), country, joined_at,
 *         last_seen, bracket_count.
 */

import { NextResponse } from "next/server";
import { readSession } from "@/lib/auth";
import { liveUsers } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskPhone(p: string | undefined | null): string {
  if (!p || p.length < 6) return p ?? "";
  return `${p.slice(0, 3)}${"*".repeat(p.length - 7)}${p.slice(-4)}`;
}

function csvEscape(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(): Promise<Response> {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  // Page through the live reader to grab everyone. Cap at 20k just to
  // bound the CSV size; auth.db rarely exceeds that for one app.
  const all: Array<{
    id: string;
    display_name: string;
    email: string;
    country: string;
    joined_at: string;
    last_seen: string;
    predictions_count: number;
  }> = [];
  let page = 1;
  while (all.length < 20000) {
    const chunk = liveUsers("", page, 500);
    if (!chunk || chunk.rows.length === 0) break;
    all.push(...chunk.rows);
    if (chunk.rows.length < 500) break;
    page += 1;
  }

  const header = [
    "id",
    "display_name",
    "email_or_phone",
    "country",
    "joined_at",
    "last_seen",
    "bracket_count",
  ];
  const lines = [header.join(",")];
  for (const u of all) {
    lines.push(
      [
        u.id,
        u.display_name,
        // The "email" field already falls back to phone when the user
        // never set an email. Mask it for export.
        u.email.startsWith("+") ? maskPhone(u.email) : u.email,
        u.country,
        u.joined_at,
        u.last_seen,
        u.predictions_count,
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
      "Content-Disposition": `attachment; filename="tournamental-users-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
