/**
 * Build a `BracketShareCardInput` from the HTTP request that hits the
 * `/v1/share/bracket/...` routes.
 *
 * The bracket payload arrives one of two ways:
 *   1. Encoded in query params on the share URL — every public share
 *      link the user posts to Instagram / Twitter carries the champion
 *      + knockout-path data inline. This is the path that always works,
 *      irrespective of any server-side bracket store.
 *   2. (Future) Looked up by `bracketId` from the game-service store
 *      once that surface lands. The route prefers (2) when available
 *      and falls back to (1) otherwise.
 *
 * Encoding (1) intentionally accepts the same query-string shape as
 * the existing `/api/og/bracket?bracket_id=…&handle=…&winner=…` route
 * so old social posts don't 404. New shares add `path=` (the knockout
 * path) + `kit=` (champion kit primary) to drive the canvas renderer.
 *
 * The `path=` value is a compact comma-list: `r16:JPN,qf:ESP,sf:BRA,
 * final:FRA`. Team names are recovered from the vendored teams.json
 * file, so the URL stays short.
 */

import type {
  BracketShareCardInput,
  BracketSharePathEntry,
  BracketShareStage,
} from "@vtorn/social-cards";

import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";
import type { CanonicalTeamsFile } from "@/lib/bracket/enrich";

const STAGES: ReadonlyArray<BracketShareStage> = ["r16", "qf", "sf", "tp", "final"];

function teamNameFor(code: string): { name: string; kit?: { primary?: string } } {
  const safe = code.toUpperCase();
  const file = canonicalTeamsRaw as CanonicalTeamsFile;
  const t = file.teams.find((x) => x.code === safe);
  if (!t) return { name: safe };
  return { name: t.name, kit: t.kit };
}

export interface ParsedShareUrl {
  /** The bracket id (without any `.png` / `.mp4` suffix). */
  readonly bracketId: string;
  /** Detected file extension on the path segment. */
  readonly ext: "png" | "mp4" | null;
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Pull the bare bracket id + any trailing file extension out of the
 * dynamic Next.js route segment. We refuse anything that wouldn't be
 * safe on disk — the on-disk MP4 cache path is built from this value.
 */
export function parseBracketSegment(raw: string): ParsedShareUrl | null {
  const decoded = decodeURIComponent(raw);
  const m = /^([a-zA-Z0-9_-]{1,64})(?:\.(png|mp4))?$/.exec(decoded);
  if (!m) return null;
  return { bracketId: m[1]!, ext: (m[2] as "png" | "mp4" | undefined) ?? null };
}

/** Validate a bare bracket id (used by the og.png sibling route). */
export function isValidBracketId(raw: string): boolean {
  return SAFE_ID_RE.test(raw);
}

/**
 * Build the canvas input from URL search params. The shape is
 * intentionally permissive — every field defaults to a sensible
 * placeholder so we always return a renderable card.
 */
export function inputFromSearchParams(args: {
  bracketId: string;
  searchParams: URLSearchParams;
}): BracketShareCardInput {
  const { bracketId, searchParams } = args;
  const handle = searchParams.get("handle") ?? "anonymous";
  const displayName = searchParams.get("name") ?? undefined;
  const winnerCode = (searchParams.get("winner") ?? "ARG").toUpperCase();
  const tournamentName =
    searchParams.get("tournament") ?? "FIFA WC 2026";
  const punditLevelRaw = searchParams.get("pundit");
  const punditLevel = punditLevelRaw ? Math.max(0, Number(punditLevelRaw) || 0) : 0;
  const kitOverride = searchParams.get("kit");
  const pathRaw = searchParams.get("path");

  const championName = teamNameFor(winnerCode);
  const champion = {
    code: winnerCode,
    name: championName.name,
    kit: { primary: kitOverride ?? championName.kit?.primary ?? null },
  };

  const knockoutPath = parsePath(pathRaw, winnerCode);

  return {
    user: { handle, displayName },
    champion,
    knockoutPath,
    tournamentName,
    pundit: punditLevel > 0 ? { level: punditLevel } : null,
    // Resolve the prod flag directory inside the web app's public folder.
    // `process.cwd()` for a Next.js server is the app root.
    flagsDir: `${process.cwd()}/public/flags`,
    footerUrl: `tournamental.com/wc2026?from=${bracketId}`,
  };
}

/**
 * Parse `r16:AUS,qf:ESP,sf:BRA,final:FRA` -> typed path entries.
 * Falls back to a Final-only path with the champion if `pathRaw` is
 * empty or unparseable.
 */
function parsePath(
  pathRaw: string | null,
  winnerCode: string,
): ReadonlyArray<BracketSharePathEntry> {
  if (!pathRaw) {
    const t = teamNameFor(winnerCode);
    return [{ stage: "final", teamCode: winnerCode, teamName: t.name }];
  }
  const out: BracketSharePathEntry[] = [];
  for (const chunk of pathRaw.split(",")) {
    const [rawStage, rawCode] = chunk.split(":");
    if (!rawStage || !rawCode) continue;
    const stage = rawStage.trim().toLowerCase();
    const code = rawCode.trim().toUpperCase();
    if (!STAGES.includes(stage as BracketShareStage)) continue;
    if (!/^[A-Z]{2,4}$/.test(code)) continue;
    const t = teamNameFor(code);
    out.push({ stage: stage as BracketShareStage, teamCode: code, teamName: t.name });
  }
  if (out.length === 0) {
    const t = teamNameFor(winnerCode);
    return [{ stage: "final", teamCode: winnerCode, teamName: t.name }];
  }
  return out;
}
