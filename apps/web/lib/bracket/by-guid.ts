/**
 * Server-side bracket lookup by share guid — STUB pending the game
 * service `/v1/bracket/by-guid/<guid>` endpoint.
 *
 * The `/s/<guid>` universal share landing route hits this after the
 * syndicate-slug lookup misses. Two valid guid shapes:
 *   - UUID v4 (dashed, 36 chars)
 *   - 16-char nanoid (alphanumeric + `_`/`-`)
 *
 * We accept both because the early share URLs in pre-launch were
 * nanoids and the moment user-id-backed shares land in #70 the
 * authenticated route will emit UUIDs. Keeping the guard permissive
 * here means old screenshot links keep resolving once the backend
 * lands — the UUID variant just hits a different code path.
 */

import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";
import type { CanonicalTeamsFile } from "@/lib/bracket/enrich";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NANOID_RE = /^[a-zA-Z0-9_-]{16}$/;

export function isShareGuidShape(guid: string): boolean {
  if (typeof guid !== "string") return false;
  return UUID_V4_RE.test(guid) || NANOID_RE.test(guid);
}

export interface PathToGoldEntry {
  readonly stage: "r16" | "qf" | "sf" | "final";
  readonly stage_label: string;
  readonly opponent_code: string;
  readonly opponent_name: string;
  readonly opponent_flag_emoji: string;
}

export interface BracketByGuid {
  readonly bracket_id: string;
  readonly handle: string;
  readonly saved_at: string; // ISO-8601, the bracket commit timestamp
  readonly tournament_id: string;
  readonly tournament_label: string;
  readonly champion: TeamLite;
  readonly runner_up: TeamLite;
  readonly third_place: TeamLite;
  readonly path_to_gold: ReadonlyArray<PathToGoldEntry>;
}

export interface TeamLite {
  readonly code: string;
  readonly name: string;
  readonly flag_emoji: string;
}

function teamLite(code: string): TeamLite {
  const safe = code.toUpperCase();
  const file = canonicalTeamsRaw as CanonicalTeamsFile;
  const t = file.teams.find((x) => x.code === safe);
  return {
    code: safe,
    name: t?.name ?? safe,
    flag_emoji: t?.flag_emoji ?? "🏳️",
  };
}

const STAGE_LABEL: Record<PathToGoldEntry["stage"], string> = {
  r16: "Round of 16",
  qf: "Quarter-final",
  sf: "Semi-final",
  final: "Final",
};

/**
 * Build a deterministic synthetic bracket from a guid so the share
 * landing page renders something coherent during pre-launch.
 *
 * The synthetic picks rotate through a fixed pool of teams seeded by
 * a hash of the guid — same guid always yields the same bracket so
 * link-back from a social post stays stable across reloads.
 *
 * TODO: replace with a fetch to
 *   `GET <gameServiceUrl>/v1/bracket/by-guid/<guid>`
 * once the game service lands. The fetch should pass
 *   `Cache-Control: max-age=60, stale-while-revalidate=600`
 * and the upstream response should include a `saved_at` timestamp so
 * the page's cache key flips when the user re-saves.
 */
export async function loadBracketFromGuid(
  guid: string,
): Promise<BracketByGuid | null> {
  if (!isShareGuidShape(guid)) return null;

  // Cheap deterministic seed: sum char codes, take mod over the pool.
  let seed = 0;
  for (let i = 0; i < guid.length; i++) seed = (seed + guid.charCodeAt(i)) % 0xffffffff;

  const pool = ["ARG", "FRA", "BRA", "ESP", "ENG", "GER", "POR", "NED", "ITA", "URU"] as const;
  const pickAt = (offset: number): string => pool[(seed + offset) % pool.length] ?? "ARG";

  const champion = teamLite(pickAt(0));
  const runner_up = teamLite(pickAt(3));
  const third_place = teamLite(pickAt(5));

  const path_to_gold: PathToGoldEntry[] = (
    ["r16", "qf", "sf", "final"] as const
  ).map((stage, i) => {
    const opp = teamLite(pickAt(7 + i * 2));
    return {
      stage,
      stage_label: STAGE_LABEL[stage],
      opponent_code: opp.code,
      opponent_name: opp.name,
      opponent_flag_emoji: opp.flag_emoji,
    };
  });

  // Synthetic stable timestamp derived from the guid so cache keys are
  // deterministic. Maps to a date inside the pre-launch window.
  const savedAtMs = 1746700000000 + (seed % 86_400_000);

  return {
    bracket_id: guid,
    handle: `player_${guid.slice(0, 6).toLowerCase()}`,
    saved_at: new Date(savedAtMs).toISOString(),
    tournament_id: "fifa-wc-2026",
    tournament_label: "FIFA World Cup 2026",
    champion,
    runner_up,
    third_place,
    path_to_gold,
  };
}
