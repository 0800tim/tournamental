/**
 * POST /api/v1/imports/commit
 *
 * Final step of the bracket-import wizard. After the user has
 * reviewed the `PreviewResult` returned by /api/v1/imports/preview,
 * they confirm and the wizard POSTs the preview here. We turn the
 * preview into a `Bracket` payload + send it to game-service's
 * /v1/bracket/submit, which applies the kickoff-backstop bypass for
 * source='imported' picks (see docs/69 §3.3).
 *
 * One-import-per-bracket enforced via bracket_import_audit lookup
 * before save.
 */

import { type NextRequest } from "next/server";
import { z } from "zod";

import {
  bracketAlreadyImported,
  markBracketImported,
  writeAudit,
} from "@/lib/import/store";
import type { ImportSource, PreviewResult } from "@/lib/import/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SourceEnum = z.enum(["telegraph", "espn", "bbc", "fifa", "screenshot-ai"]);

const CommitBodySchema = z.object({
  source: SourceEnum,
  sourceUrl: z.string().max(2048),
  tournamentId: z.string().default("fifa-wc-2026"),
  preview: z.object({
    source: SourceEnum,
    sourceUrl: z.string(),
    matches: z
      .array(
        z.object({
          matchId: z.string().nullable(),
          outcome: z
            .enum(["home_win", "draw", "away_win"])
            .nullable(),
          alreadyKickedOff: z.boolean(),
          raw: z.object({
            homeTeamRaw: z.string(),
            awayTeamRaw: z.string(),
            predictedWinnerRaw: z.string(),
            sourceTimestamp: z.string().optional(),
          }),
        }).passthrough(),
      )
      .max(150),
  }).passthrough(),
});

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

function gameApiBase(): string {
  return (
    process.env.GAME_API_BASE ??
    process.env.NEXT_PUBLIC_GAME_API_URL ??
    "https://game.tournamental.com"
  ).replace(/\/+$/, "");
}

export async function POST(req: NextRequest): Promise<Response> {
  const user = await resolveUser(req);
  if (!user) return json({ error: "unauthorised" }, 401);

  const raw = await req.json().catch(() => null);
  const parsed = CommitBodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "bad_body", details: parsed.error.flatten() }, 400);
  }
  const { source, sourceUrl, tournamentId, preview } = parsed.data;
  const previewTyped = preview as unknown as PreviewResult;

  // Build the bracket payload using only resolvable picks.
  const nowIso = new Date().toISOString();
  const matchPredictions: Record<
    string,
    {
      matchId: string;
      outcome: "home_win" | "draw" | "away_win";
      lockedAt: string;
      source: "imported";
      originalLockedAt?: string;
    }
  > = {};
  let resolvableCount = 0;
  for (const m of previewTyped.matches) {
    if (!m.matchId || !m.outcome) continue;
    resolvableCount += 1;
    matchPredictions[m.matchId] = {
      matchId: m.matchId,
      outcome: m.outcome,
      lockedAt: nowIso,
      source: "imported",
      originalLockedAt: m.raw.sourceTimestamp,
    };
  }
  if (resolvableCount === 0) {
    return json(
      {
        error: "no_resolvable_picks",
        hint: "We couldn't reconcile any imported picks to current tournament matches.",
      },
      400,
    );
  }

  // Look up the user's existing bracket id (if any) so we can enforce
  // one-import-per-bracket. We do this by calling game-service's
  // /v1/bracket/me?tournament_id=... endpoint with the X-User-Id
  // header (dev) / Authorization cookie (prod).
  const bracketRes = await fetch(
    `${gameApiBase()}/v1/bracket/me?tournament_id=${encodeURIComponent(tournamentId)}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-user-id": user.userId,
        cookie: req.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    },
  );
  let existingBracketId: string | null = null;
  if (bracketRes.ok) {
    const body = (await bracketRes.json()) as { bracket_id?: string };
    existingBracketId = body.bracket_id ?? null;
  }
  if (existingBracketId && bracketAlreadyImported(existingBracketId)) {
    return json(
      {
        error: "already_imported",
        hint: "This bracket has already had an import applied. Imports are one-shot per bracket.",
      },
      409,
    );
  }

  // POST the merged bracket back through /v1/bracket/submit. The
  // server-side backstop bypass we added in apps/game/src/routes/
  // bracket.ts accepts these picks despite the late lockedAt because
  // they carry source='imported'.
  const submitRes = await fetch(`${gameApiBase()}/v1/bracket/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      "x-user-id": user.userId,
      cookie: req.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({
      tournament_id: tournamentId,
      bracket: {
        bracketId: existingBracketId ?? `bk_imported_${user.userId}_${Date.now()}`,
        matchPredictions,
        groupTiebreakers: {},
        knockoutPredictions: {},
        lockedAt: nowIso,
        version: 1,
      },
    }),
  });
  if (!submitRes.ok) {
    const txt = await submitRes.text().catch(() => "");
    writeAudit({
      userId: user.userId,
      bracketId: existingBracketId,
      source: source as ImportSource,
      sourceUrl,
      httpStatus: submitRes.status,
      status: "failed",
      parsedJson: null,
      rawHtml: null,
      error: `submit-${submitRes.status}:${txt.slice(0, 200)}`,
    });
    return json(
      { error: "submit_failed", status: submitRes.status },
      502,
    );
  }
  const submitted = (await submitRes.json()) as { bracket_id?: string };
  const newBracketId = submitted.bracket_id ?? existingBracketId;
  if (newBracketId) {
    markBracketImported({
      bracketId: newBracketId,
      source: source as ImportSource,
      sourceUrl,
    });
  }
  writeAudit({
    userId: user.userId,
    bracketId: newBracketId ?? null,
    source: source as ImportSource,
    sourceUrl,
    httpStatus: 200,
    status: "committed",
    parsedJson: null,
    rawHtml: null,
    error: null,
  });

  return json({
    ok: true,
    bracketId: newBracketId,
    committed: resolvableCount,
    alreadyLocked: previewTyped.stats.alreadyLocked,
    upcoming: previewTyped.stats.upcoming,
  });
}
