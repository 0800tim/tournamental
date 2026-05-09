/**
 * /api/syndicate/intent — accept a syndicate pre-signup.
 *
 * Phase 0 storage: write a JSON file under `data/pre-signups/` (gitignored).
 * The file is keyed by ISO timestamp + a short random suffix so concurrent
 * writes don't collide. This is intentionally simple — when `apps/api`
 * lands, the route forwards to it instead.
 *
 * Validation: lightweight runtime checks (no Zod dep added for v0.1).
 *
 * Cache policy: write surface, never cached. `Cache-Control: no-store`.
 *
 * Privacy: we store name + email + optional Telegram + country code. Note
 * in the page footer covers consent. No PII outside this single file.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set(["friends", "office", "public"]);

interface IntentPayload {
  kind: string;
  syndicate_name: string;
  your_name: string;
  email: string;
  telegram?: string | null;
  country: string;
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function validateEmail(email: string): boolean {
  // Deliberately permissive — matches anything with an `@` and a `.` in the
  // host. Real validation is the confirm-email round-trip we'll add later.
  return /.+@.+\..+/.test(email) && email.length <= 200;
}

function validate(input: unknown): { ok: true; data: IntentPayload } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const obj = input as Record<string, unknown>;

  if (!isString(obj.kind) || !ALLOWED_KINDS.has(obj.kind)) {
    return { ok: false, error: "Invalid syndicate kind." };
  }
  if (!isString(obj.syndicate_name) || obj.syndicate_name.trim().length < 2) {
    return { ok: false, error: "Syndicate name is required (2+ chars)." };
  }
  if (obj.syndicate_name.length > 80) {
    return { ok: false, error: "Syndicate name too long." };
  }
  if (!isString(obj.your_name) || obj.your_name.trim().length < 1) {
    return { ok: false, error: "Your name is required." };
  }
  if (obj.your_name.length > 80) {
    return { ok: false, error: "Your name too long." };
  }
  if (!isString(obj.email) || !validateEmail(obj.email)) {
    return { ok: false, error: "A valid email is required." };
  }
  if (!isString(obj.country) || !/^[A-Z]{3}$/.test(obj.country)) {
    return { ok: false, error: "Country must be a 3-letter FIFA code." };
  }
  let telegram: string | null = null;
  if (obj.telegram !== undefined && obj.telegram !== null && obj.telegram !== "") {
    if (!isString(obj.telegram) || obj.telegram.length > 64) {
      return { ok: false, error: "Telegram handle invalid." };
    }
    telegram = obj.telegram;
  }
  return {
    ok: true,
    data: {
      kind: obj.kind,
      syndicate_name: obj.syndicate_name.trim(),
      your_name: obj.your_name.trim(),
      email: obj.email.trim().toLowerCase(),
      telegram,
      country: obj.country,
    },
  };
}

const PRE_SIGNUPS_DIR = join(process.cwd(), "..", "..", "data", "pre-signups");

async function persist(payload: IntentPayload): Promise<{ id: string; path: string }> {
  await fs.mkdir(PRE_SIGNUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${stamp}_${randomBytes(4).toString("hex")}`;
  const path = join(PRE_SIGNUPS_DIR, `${id}.json`);
  await fs.writeFile(
    path,
    JSON.stringify(
      {
        id,
        received_at_utc: new Date().toISOString(),
        ...payload,
      },
      null,
      2,
    ),
    "utf8",
  );
  return { id, path };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const result = validate(body);
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const { id } = await persist(result.data);
    return Response.json(
      { ok: true, id },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    // Log but don't expose internals. The form treats any non-200 as a
    // generic "try again" — the operator sees the error in server logs.
    // eslint-disable-next-line no-console
    console.error("syndicate/intent persist failed", err);
    return Response.json(
      { ok: false, error: "Could not save your signup. Please retry." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

// Reject any other method up-front.
export async function GET() {
  return Response.json(
    { ok: false, error: "POST only." },
    { status: 405, headers: { "cache-control": "no-store", allow: "POST" } },
  );
}
