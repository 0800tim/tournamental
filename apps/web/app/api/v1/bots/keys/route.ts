/**
 * POST /api/v1/bots/keys, self-service Bot API key issuance proxy.
 *
 * Resolves the inbound session, looks up the verified email associated
 * with the user, and proxies the request to the game-service
 * /v1/bots/keys/issue endpoint. The plaintext key is in the upstream
 * response and is forwarded once to the browser; the server stores
 * only the SHA-256 hash.
 *
 * Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.3
 * Refs: docs/superpowers/plans/2026-06-07-bot-arena-phase-1.md Task 17
 */

import type { NextRequest } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { loadUserContact } from "@/lib/auth/contact-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LABEL_LEN = 64;
const LABEL_RE = /^[A-Za-z0-9 _-]+$/;

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return jsonResponse({ error: "unauthorised" }, 401);
  }

  const contact = loadUserContact(session.userId);
  const email = contact?.email;
  if (!email) {
    return jsonResponse(
      {
        error:
          "missing_verified_email; add a verified email to your profile before issuing API keys",
      },
      400,
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const labelInput = typeof body.label === "string" ? body.label.trim() : "";
  if (!labelInput) {
    return jsonResponse({ error: "label_required" }, 400);
  }
  if (labelInput.length > MAX_LABEL_LEN) {
    return jsonResponse({ error: "label_too_long" }, 400);
  }
  if (!LABEL_RE.test(labelInput)) {
    return jsonResponse(
      { error: "label_invalid_chars; use letters, digits, space, _ or -" },
      400,
    );
  }

  const upstream = process.env.GAME_SERVICE_URL;
  if (!upstream) {
    return jsonResponse(
      {
        error:
          "service_unavailable; GAME_SERVICE_URL not configured in this environment",
      },
      503,
    );
  }

  // Shared-secret service-to-service auth. The upstream
  // /v1/bots/keys/issue endpoint validates this header against the same
  // env var on the game-service side. Falls back to the legacy
  // X-Tournamental-Service header for backwards compatibility with
  // older game-service builds that haven't pulled the shared-secret
  // change yet.
  const sharedSecret = process.env.GAME_BOT_KEYS_SHARED_SECRET ?? "";

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(`${upstream}/v1/bots/keys/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tournamental-Service": "web",
        ...(sharedSecret
          ? { "x-bot-keys-shared-secret": sharedSecret }
          : {}),
      },
      body: JSON.stringify({
        owner_email: email,
        owner_user_id: session.userId,
        label: labelInput,
      }),
    });
  } catch (err) {
    return jsonResponse(
      {
        error: "upstream_unreachable",
        detail: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }

  let upstreamBody: unknown;
  try {
    upstreamBody = await upstreamRes.json();
  } catch {
    return jsonResponse(
      { error: "upstream_invalid_json", status: upstreamRes.status },
      502,
    );
  }

  const payload =
    upstreamBody && typeof upstreamBody === "object"
      ? (upstreamBody as Record<string, unknown>)
      : { error: "upstream_unexpected_shape" };

  return new Response(JSON.stringify(payload), {
    status: upstreamRes.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}
