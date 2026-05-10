import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth";
import { can } from "@/lib/perms";
import { writeAudit } from "@/lib/audit";
import {
  getAdvertiser,
  patchAdvertiser,
  shallowDiff,
  type AdvertiserRecord,
} from "@/lib/ops-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATCHABLE_KEYS = new Set<keyof AdvertiserRecord>([
  "name",
  "surface",
  "tournament",
  "geo_allow",
  "status",
  "ecpm_units",
  "fill_rate_pct",
  "flight_start",
  "flight_end",
  "contact_email",
  "creative_url",
  "notes",
]);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!can(session.role, "advertisers.read"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const adv = await getAdvertiser(params.id);
  if (!adv) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(adv);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!can(session.role, "advertisers.write"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const safe: Partial<AdvertiserRecord> = {};
  for (const k of Object.keys(body)) {
    if (PATCHABLE_KEYS.has(k as keyof AdvertiserRecord)) {
      (safe as Record<string, unknown>)[k] = body[k];
    }
  }

  try {
    const { before, after } = await patchAdvertiser(params.id, safe);
    const diff = shallowDiff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    );
    await writeAudit(session, {
      action: "advertiser.patch",
      target: `advertiser:${params.id}`,
      before: diff.before,
      after: diff.after,
    });
    return NextResponse.json(after);
  } catch (e) {
    const err = e as Error;
    if (err.message === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
