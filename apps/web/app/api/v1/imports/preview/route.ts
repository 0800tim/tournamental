/**
 * POST /api/v1/imports/preview
 *
 * Step 3 of the bracket-import wizard (docs/69-bracket-import.md):
 * the user has picked a source platform and pasted their public
 * bracket URL (or uploaded a screenshot). This endpoint fetches +
 * parses the page, normalises team names, reconciles to our match
 * ids, and returns a `PreviewResult` for the wizard to render.
 *
 * Does NOT save anything to the user's bracket. The commit happens
 * via POST /api/v1/imports/commit after the user confirms the
 * preview.
 *
 * Auth: forwards the inbound auth cookie to auth-sms /v1/auth/me to
 * resolve the signed-in user. Unauthenticated callers get 401.
 *
 * Audit: every preview attempt writes a row to bracket_import_audit
 * with status='parsed' or 'failed' so we have a forensic trail.
 */

import { type NextRequest } from "next/server";
import { z } from "zod";

import { buildPreview } from "@/lib/import/commit";
import { defaultFetcher } from "@/lib/import/fetcher";
import { parseScreenshot } from "@/lib/import/parsers/screenshot";
import { loadParser } from "@/lib/import/registry";
import { writeAudit } from "@/lib/import/store";
import type { ImportSource, ParseResult, PreviewResult } from "@/lib/import/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PreviewBodySchema = z.discriminatedUnion("source", [
  z.object({
    source: z.enum(["telegraph", "espn", "bbc", "fifa"]),
    sourceUrl: z.string().url().max(2048),
  }),
  z.object({
    source: z.literal("screenshot-ai"),
    imageBase64: z.string().min(64).max(8 * 1024 * 1024),
    mimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]),
    sourceHint: z.string().max(80).optional(),
  }),
]);

const RATE_BUCKETS: Map<string, number[]> = new Map();
const PREVIEW_RATE_PER_HOUR = 12;

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - 3600_000;
  const arr = (RATE_BUCKETS.get(userId) ?? []).filter((t) => t > cutoff);
  if (arr.length >= PREVIEW_RATE_PER_HOUR) return true;
  arr.push(now);
  RATE_BUCKETS.set(userId, arr);
  return false;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function resolveUser(req: NextRequest): Promise<{ userId: string } | null> {
  const base = (
    process.env.AUTH_API_BASE ??
    process.env.AUTH_API_URL ??
    process.env.NEXT_PUBLIC_AUTH_BASE_URL ??
    "https://auth.tournamental.com"
  ).replace(/\/+$/, "");
  const cookie = req.headers.get("cookie") ?? "";
  if (!cookie.includes("tnm_session=")) return null;
  try {
    const res = await fetch(`${base}/v1/auth/me`, {
      headers: { cookie, accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { id?: string } };
    return body?.user?.id ? { userId: body.user.id } : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const user = await resolveUser(req);
  if (!user) return json({ error: "unauthorised" }, 401);
  if (rateLimited(user.userId)) {
    return json({ error: "rate_limited", retry_after_seconds: 600 }, 429);
  }

  const raw = await req.json().catch(() => null);
  const parsed = PreviewBodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "bad_body", details: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;

  // ---- Parse phase ----
  let parseResult: ParseResult | null = null;
  let rawHtml: string | null = null;
  let httpStatus: number | null = null;
  let parseError: string | null = null;

  if (body.source === "screenshot-ai") {
    try {
      parseResult = await parseScreenshot(body.imageBase64, body.mimeType, {
        sourceName: body.sourceHint,
      });
    } catch (err) {
      parseError = err instanceof Error ? err.message : "screenshot-parse-failed";
    }
  } else {
    const parser = await loadParser(body.source as ImportSource);
    if (!parser) {
      writeAudit({
        userId: user.userId,
        bracketId: null,
        source: body.source as ImportSource,
        sourceUrl: body.sourceUrl,
        httpStatus: null,
        status: "failed",
        parsedJson: null,
        rawHtml: null,
        error: "parser-not-available",
      });
      return json({ error: "source_not_supported_yet", source: body.source }, 503);
    }
    if (!parser.canParse(body.sourceUrl)) {
      return json({ error: "url_shape_invalid" }, 400);
    }
    try {
      // The fetcher records its own raw HTML for audit purposes, but
      // we also stash it here so writeAudit can hash + persist it.
      // (Single fetch; we don't double-fetch for audit.)
      const fetched = await defaultFetcher.fetch({
        url: body.sourceUrl,
        timeoutMs: 12_000,
        needsBrowser: body.source === "espn",
      });
      if (!fetched.ok) {
        httpStatus = fetched.status;
        parseError = `fetch-failed:${fetched.error}`;
      } else {
        httpStatus = fetched.status;
        rawHtml = fetched.html;
        // Inline parse using the fetcher result we already have, by
        // wrapping a one-shot fetcher. Avoids re-fetching the page.
        parseResult = await parser.parse(body.sourceUrl, {
          fetch: async () => fetched,
        });
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : "parse-failed";
    }
  }

  // ---- Audit + respond ----
  if (!parseResult) {
    writeAudit({
      userId: user.userId,
      bracketId: null,
      source: body.source as ImportSource,
      sourceUrl: body.source === "screenshot-ai" ? "screenshot:upload" : body.sourceUrl,
      httpStatus,
      status: "failed",
      parsedJson: null,
      rawHtml,
      error: parseError ?? "unknown-parse-failure",
    });
    return json(
      {
        error: "parse_failed",
        reason: parseError ?? "unknown",
        hint:
          body.source === "screenshot-ai"
            ? "Try a clearer / higher-resolution screenshot."
            : "Double-check the URL is your public bracket share link. If it still won't parse, try the screenshot upload instead.",
      },
      422,
    );
  }

  const preview = buildPreview({
    source: body.source as ImportSource,
    sourceUrl: body.source === "screenshot-ai" ? "screenshot:upload" : body.sourceUrl,
    parsed: parseResult,
  });

  writeAudit({
    userId: user.userId,
    bracketId: null,
    source: body.source as ImportSource,
    sourceUrl: body.source === "screenshot-ai" ? "screenshot:upload" : body.sourceUrl,
    httpStatus,
    status: preview.stats.resolvable > 0 ? "parsed" : "partial",
    parsedJson: parseResult,
    rawHtml,
    error: null,
  });

  return json(preview satisfies PreviewResult);
}
