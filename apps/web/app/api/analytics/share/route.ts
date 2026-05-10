/**
 * POST /v1/analytics/share — placeholder for viral-loop tracking.
 *
 * Accepts `{ bracketId, target, ts }` and logs to stdout. Returns 204.
 * When the analytics agent lands the real pipeline, swap the body for a
 * write to ClickHouse / BigQuery — the wire format is stable.
 *
 * Cache: write path — `private, no-store` per CLAUDE.md.
 */

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TARGETS = new Set([
  "native",
  "whatsapp",
  "telegram",
  "twitter",
  "facebook",
  "linkedin",
  "reddit",
  "email",
  "copy",
  "download",
]);

interface ShareEvent {
  readonly bracketId: string;
  readonly target: string;
  readonly ts: number;
}

function isShareEvent(x: unknown): x is ShareEvent {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.bracketId === "string" &&
    typeof o.target === "string" &&
    typeof o.ts === "number"
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json");
  }
  if (!isShareEvent(body)) {
    return jsonError(400, "invalid_payload");
  }
  if (!ALLOWED_TARGETS.has(body.target)) {
    return jsonError(400, "unknown_target");
  }
  if (body.bracketId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(body.bracketId)) {
    return jsonError(400, "invalid_bracket_id");
  }

  // Stub: log + 204. Real pipeline lands in a follow-up agent's PR.
  // eslint-disable-next-line no-console
  console.info(
    `[analytics-share] bracketId=${body.bracketId} target=${body.target} ts=${body.ts}`,
  );

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "private, no-store" },
  });
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
