/**
 * GET /verify/<iso-ts>/snapshot.db
 * GET /verify/<iso-ts>/snapshot.db.ots
 *
 * Serves the snapshot + OpenTimestamps receipt files referenced by the
 * audit ledger at /verify. Files live in
 * `apps/web/data/audit/<iso-ts>/` (gitignored — checking 380KB+ binaries
 * into a public repo on every anchor would balloon git history). The
 * ledger.json itself IS committed so even without the binaries the
 * append-only chain of hashes is verifiable from git.
 *
 * Strict allowlist on filename and timestamp directory shape so this
 * can't be turned into a generic /verify/../etc/passwd traversal.
 *
 * Cache: `public, max-age=86400, immutable` because both files are
 * content-addressed; once a hash is anchored its bytes don't change.
 */

import { promises as fs } from "node:fs";
import { join, normalize } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
// Receipts (.ots) are always public. snapshot.db serving is gated on
// the ledger entry's `public_sample` flag — by default false (raw
// picks aren't given to anyone without a formal audit request); a
// hand-marked sample anchor stays downloadable so visitors to /verify
// can see what the audit flow looks like end-to-end.
const FILE_RE = /^snapshot\.db(?:\.ots)?$/;

const AUDIT_ROOT = join(process.cwd(), "data", "audit");

interface LedgerEntry {
  ts: string;
  public_sample?: boolean;
}

async function isPublicSample(ts: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(join(AUDIT_ROOT, "ledger.json"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const entry = JSON.parse(t) as LedgerEntry;
        if (entry.ts === ts) return entry.public_sample === true;
      } catch {
        /* skip malformed lines */
      }
    }
  } catch {
    /* missing ledger.json → treat as private */
  }
  return false;
}

export async function GET(
  _req: Request,
  props: { params: Promise<{ ts: string; file: string }> },
): Promise<Response> {
  const params = await props.params;
  const ts = params.ts ?? "";
  const file = params.file ?? "";

  if (!TS_RE.test(ts) || !FILE_RE.test(file)) {
    return new Response("not found", { status: 404 });
  }

  // snapshot.db is gated by the ledger's public_sample flag. Receipts
  // (.ots) are always public.
  if (file === "snapshot.db") {
    const allowed = await isPublicSample(ts);
    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: "audit_request_required",
          message:
            "The raw predictions snapshot is released only on written audit request, when a dispute would benefit from inspecting the underlying picks. The OpenTimestamps receipt (snapshot.db.ots) is publicly available and proves the snapshot's hash is anchored to Bitcoin. To request the snapshot, email info@tournamental.com with subject line 'Audit request'.",
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    }
  }

  const candidate = normalize(join(AUDIT_ROOT, ts, file));
  if (!candidate.startsWith(AUDIT_ROOT)) {
    return new Response("not found", { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(candidate);
  } catch {
    return new Response("not found", { status: 404 });
  }

  const contentType = file.endsWith(".ots")
    ? "application/vnd.opentimestamps.ots"
    : "application/vnd.sqlite3";

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
