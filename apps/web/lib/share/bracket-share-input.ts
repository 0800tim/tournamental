/**
 * Build a `BracketShareCardInput` from the HTTP request that hits the
 * `/v1/share/bracket/...` routes.
 *
 * The bracket payload arrives one of two ways:
 *   1. Encoded in query params on the share URL, every public share
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
  BracketShareChampion,
  BracketShareEliminationTier,
  BracketSharePathEntry,
  BracketShareStage,
} from "@tournamental/social-cards";

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
 * safe on disk, the on-disk MP4 cache path is built from this value.
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
 * intentionally permissive, every field defaults to a sensible
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
    searchParams.get("tournament") ?? "World Cup 2026";
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

  // Explicit silver / bronze hints from the caller (the bracket OG route
  // passes `runner_up=FRA&third=BRA` when the bracket cascade resolves
  // these slots). If absent, the canvas renderer derives them from the
  // knockout path (`final` → silver, `tp` → bronze).
  const runnerUp = championFromCode(searchParams.get("runner_up"));
  const thirdPlace = championFromCode(searchParams.get("third"));

  // v2 (2026-05-11): the pyramid silhouette + flags-in-cup + deep-link
  // share URL with QR. Both fields are optional — if absent the card
  // falls back to its v1 (champion-column-only) appearance and the
  // legacy footer URL.
  const shareGuid = parseShareGuid(searchParams.get("share_guid"));
  const allEliminatedByStage = parseEliminationTiers(
    searchParams.get("eliminated"),
  );

  // Optional avatar URL passed by the caller (the OG route passes
  // `avatar=/avatars/<userId>.webp` for authed users). Absolute https
  // URLs also accepted. The viral renderer falls back to a silhouette
  // when this is empty or the fetch fails.
  const avatarRaw = searchParams.get("avatar");
  const avatarUrl =
    avatarRaw && /^(\/avatars\/[A-Za-z0-9_-]+\.(?:webp|png|jpg|jpeg|gif)|https?:\/\/[^\s]+)$/.test(avatarRaw)
      ? avatarRaw
      : null;

  // Renderer style: `style=v3-podium` selects the new viral design;
  // anything else (or absent) keeps the v2 pyramid + podium card.
  const styleRaw = searchParams.get("style");
  const style: BracketShareCardInput["style"] =
    styleRaw === "v3-podium" || styleRaw === "v2-pyramid" ? styleRaw : "v3-podium";

  return {
    user: { handle, displayName },
    champion,
    runnerUp,
    thirdPlace,
    knockoutPath,
    tournamentName,
    pundit: punditLevel > 0 ? { level: punditLevel } : null,
    // Resolve the prod flag directory inside the web app's public folder.
    // `process.cwd()` for a Next.js server is the app root.
    flagsDir: `${process.cwd()}/public/flags`,
    footerUrl: `tournamental.com/wc2026?from=${bracketId}`,
    shareGuid,
    allEliminatedByStage,
    avatarUrl,
    style,
  };
}

/**
 * Parse the `eliminated=` query param, e.g. `group:AUS|JPN|KOR,qf:ESP,
 * sf:BRA`. Each `<tier>:<code>|<code>...` chunk pins a list of team
 * codes to the elimination tier. Tiers we don't recognise are dropped.
 */
function parseEliminationTiers(
  raw: string | null,
): ReadonlyArray<BracketShareEliminationTier> | undefined {
  if (!raw) return undefined;
  const TIERS = new Set<BracketShareEliminationTier["stage"]>([
    "group",
    "r32",
    "r16",
    "qf",
    "sf",
  ]);
  const out: BracketShareEliminationTier[] = [];
  for (const chunk of raw.split(",")) {
    const [rawStage, rawCodes] = chunk.split(":");
    if (!rawStage || !rawCodes) continue;
    const stage = rawStage.trim().toLowerCase();
    if (!TIERS.has(stage as BracketShareEliminationTier["stage"])) continue;
    const teamCodes = rawCodes
      .split("|")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2,4}$/.test(c));
    if (teamCodes.length === 0) continue;
    out.push({
      stage: stage as BracketShareEliminationTier["stage"],
      teamCodes,
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Sanitise a share guid — accepts alphanumerics, `_` and `-`, 3-64 chars. */
function parseShareGuid(raw: string | null): string | null | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(trimmed)) return undefined;
  return trimmed;
}

/** Build a `BracketShareChampion` from a 3-letter code query param. */
function championFromCode(raw: string | null): BracketShareChampion | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(code)) return null;
  const t = teamNameFor(code);
  return {
    code,
    name: t.name,
    kit: t.kit ? { primary: t.kit.primary ?? null } : null,
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
