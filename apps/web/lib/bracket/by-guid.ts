/**
 * Public bracket lookup by share guid.
 *
 * Hits the game-service's `GET /v1/bracket/by-guid/<guid>` endpoint and
 * normalises the response into the `BracketByGuid` shape the
 * `/s/<guid>` user-landing template consumes (champion + runner-up +
 * third-place TeamLites, path-to-gold list, saved_at timestamp).
 *
 * Two valid guid shapes:
 *   - UUID v4 (dashed, 36 chars) — modern web-client mints these.
 *   - 16-char nanoid (alphanumeric + `_`/`-`) — backfill + legacy
 *     pre-launch shares + the 0004 migration's hex backfill.
 *
 * Failure modes (all surface as `null`, which the `/s/<guid>` page
 * renders as the friendly "Share link not found" view):
 *   - guid shape doesn't match
 *   - upstream returns 404 (guid not in DB)
 *   - upstream returns 5xx or times out
 *   - network error (offline, DNS failure, etc.)
 *
 * Cache policy: this fetch is server-side (called from the RSC for
 * `/s/<guid>`). We pass `cache: "no-store"` so the Next.js fetch
 * cache doesn't pin a stale response to the same URL forever. The
 * CDN edge cache (set by the game-service via
 * `Cache-Control: public, s-maxage=60`) does the actual caching.
 *
 * Replaces the pre-launch synthetic-bracket stub (PR #140). The stub
 * generated a deterministic-from-hash bracket so the share-landing
 * page could render something coherent before the backend lookup
 * existed — which meant Tim's copied share URL resolved to a DIFFERENT
 * bracket than the one he saved. This file is the data-layer fix.
 */

import type { Bracket } from "@tournamental/bracket-engine";

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
  /** Owner's auth user id, opaque to the share page. Used to compose
   *  the avatar URL (`/avatars/<user_id>.jpg`). */
  readonly user_id: string | null;
  /** Owner's display name from their profile (e.g. "Tim Thomas").
   *  Falls back to the handle when the user hasn't set one. */
  readonly display_name: string | null;
  /** Path to the owner's avatar; `null` when not uploaded. */
  readonly avatar_url: string | null;
  readonly saved_at: string; // ISO-8601, the bracket commit timestamp
  readonly tournament_id: string;
  readonly tournament_label: string;
  readonly champion: TeamLite;
  readonly runner_up: TeamLite;
  readonly third_place: TeamLite;
  readonly path_to_gold: ReadonlyArray<PathToGoldEntry>;
  /**
   * Full persisted bracket payload, only present when the caller
   * passed `{ includePayload: true }`. Drives the read-only 3D
   * molecule embed on the share-landing page.
   */
  readonly payload?: Bracket;
}

export interface TeamLite {
  readonly code: string;
  readonly name: string;
  readonly flag_emoji: string;
}

function teamLite(code: string | null | undefined): TeamLite {
  const safe = (code ?? "").toUpperCase();
  const file = canonicalTeamsRaw as CanonicalTeamsFile;
  const t = file.teams.find((x) => x.code === safe);
  return {
    code: safe || "TBD",
    name: t?.name ?? (safe || "TBD"),
    flag_emoji: t?.flag_emoji ?? "🏳️",
  };
}

const STAGE_LABEL: Record<PathToGoldEntry["stage"], string> = {
  r16: "Round of 16",
  qf: "Quarter-final",
  sf: "Semi-final",
  final: "Final",
};

const TOURNAMENT_LABEL: Record<string, string> = {
  "fifa-wc-2026": "Football World Cup 2026",
};

/**
 * Upstream shape returned by `GET /v1/bracket/by-guid/<guid>` on the
 * game-service. Kept narrow on purpose — the route exposes only the
 * public-display fields.
 */
interface UpstreamBracket {
  readonly share_guid: string;
  /** Owner's auth user id (e.g. `u_<hex>` for auth-sms users, UUID for
   *  legacy Supabase). Used by the web resolver to look up the
   *  display name and avatar URL for the hero. */
  readonly user_id?: string;
  readonly user_handle: string | null;
  readonly tournament_id: string;
  readonly champion_code: string | null;
  readonly runner_up_code: string | null;
  readonly third_place_code: string | null;
  readonly knockout_path: ReadonlyArray<{
    readonly stage: string;
    readonly opponent_code: string | null;
    readonly result: "win" | "loss" | "tbd";
  }>;
  readonly locked_at: string | null;
  /** Present when `?include=payload` was requested. */
  readonly payload?: Bracket;
}

interface UpstreamResponse {
  readonly ok: boolean;
  readonly bracket?: UpstreamBracket;
  readonly error?: string;
}

/**
 * Resolve the game-service base URL. Server-side this prefers the
 * private `GAME_API_BASE` so the SSR fetch goes through the internal
 * mesh; client-side it falls back to `NEXT_PUBLIC_GAME_API_BASE` (or
 * the same-origin `/api` proxy default) so a browser-side call (rare,
 * but possible from a React component that uses this) doesn't try to
 * hit an internal hostname.
 */
function resolveGameApiBase(): string {
  const isServer = typeof window === "undefined";
  if (isServer) {
    return (
      process.env.GAME_API_BASE ??
      process.env.NEXT_PUBLIC_GAME_API_BASE ??
      process.env.NEXT_PUBLIC_GAME_API_URL ??
      "http://localhost:3360"
    );
  }
  return (
    process.env.NEXT_PUBLIC_GAME_API_BASE ??
    process.env.NEXT_PUBLIC_GAME_API_URL ??
    "/api"
  );
}

const FETCH_TIMEOUT_MS = 1500;

/**
 * Test-only override hook. Mirrors the pattern in
 * `lib/syndicate/store.ts` — tests register a fake bracket and the
 * resolver short-circuits to it without going to the network.
 */
const __test_registry = new Map<string, BracketByGuid>();

export function __unsafe_register_bracket_for_tests(
  guid: string,
  bracket: BracketByGuid,
): void {
  __test_registry.set(guid, bracket);
}

export function __unsafe_clear_bracket_registry_for_tests(): void {
  __test_registry.clear();
}

/**
 * Fetch a bracket by share guid from the game-service. Returns `null`
 * on any failure — the `/s/<guid>` page renders that as the friendly
 * not-found view.
 */
export async function loadBracketFromGuid(
  guid: string,
  opts: {
    readonly fetchImpl?: typeof fetch;
    readonly baseUrl?: string;
    readonly timeoutMs?: number;
    /**
     * When true, ask the game-service to inline the full persisted
     * bracket payload alongside the public summary. Used by the
     * share-landing page so the 3D molecule embed can render the
     * saved picks without a second round-trip.
     */
    readonly includePayload?: boolean;
  } = {},
): Promise<BracketByGuid | null> {
  const seeded = __test_registry.get(guid);
  if (seeded) return seeded;

  if (!isShareGuidShape(guid)) return null;

  const fetchImpl =
    opts.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : null);
  if (!fetchImpl) return null;

  const base = (opts.baseUrl ?? resolveGameApiBase()).replace(/\/+$/, "");
  const query = opts.includePayload ? "?include=payload" : "";
  const url = `${base}/v1/bracket/by-guid/${encodeURIComponent(guid)}${query}`;

  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    opts.timeoutMs ?? FETCH_TIMEOUT_MS,
  );

  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    clearTimeout(timer);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as UpstreamResponse | null;
    if (!data || !data.ok || !data.bracket) return null;
    // Side-fetch the owner's public profile so the hero can render
    // their display name + avatar. Best-effort: a failure here just
    // falls back to "Anonymous" / silhouette.
    const ownerProfile = data.bracket.user_id
      ? await loadOwnerProfile(data.bracket.user_id, fetchImpl)
      : null;
    return normaliseUpstream(data.bracket, ownerProfile);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

interface OwnerPublicProfile {
  readonly displayName: string | null;
  readonly firstName: string | null;
  readonly country: string | null;
}

function resolveAuthApiBase(): string {
  const isServer = typeof window === "undefined";
  if (isServer) {
    return (
      process.env.AUTH_API_BASE ??
      process.env.AUTH_API_URL ??
      process.env.NEXT_PUBLIC_AUTH_BASE_URL ??
      process.env.NEXT_PUBLIC_AUTH_API_URL ??
      "http://localhost:18803"
    );
  }
  return (
    process.env.NEXT_PUBLIC_AUTH_BASE_URL ??
    process.env.NEXT_PUBLIC_AUTH_API_URL ??
    ""
  );
}

async function loadOwnerProfile(
  userId: string,
  fetchImpl: typeof fetch,
): Promise<OwnerPublicProfile | null> {
  const base = resolveAuthApiBase().replace(/\/+$/, "");
  if (!base) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 800);
  try {
    const res = await fetchImpl(
      `${base}/v1/auth/users/${encodeURIComponent(userId)}/public`,
      {
        signal: ctrl.signal,
        cache: "no-store",
        headers: { accept: "application/json" },
      },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      user?: {
        displayName?: string | null;
        firstName?: string | null;
        country?: string | null;
      };
    };
    if (!body?.user) return null;
    return {
      displayName: body.user.displayName ?? null,
      firstName: body.user.firstName ?? null,
      country: body.user.country ?? null,
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function normaliseUpstream(
  b: UpstreamBracket,
  owner?: OwnerPublicProfile | null,
): BracketByGuid {
  const champion = teamLite(b.champion_code);
  const runner_up = teamLite(b.runner_up_code);
  const third_place = teamLite(b.third_place_code);

  // Build path_to_gold from upstream entries. The four expected stages
  // are always surfaced even if upstream skipped one, so the share
  // landing always renders four rows. Missing entries get TBD.
  const byStage = new Map<string, UpstreamBracket["knockout_path"][number]>();
  for (const k of b.knockout_path) byStage.set(k.stage, k);

  const stages: ReadonlyArray<PathToGoldEntry["stage"]> = [
    "r16",
    "qf",
    "sf",
    "final",
  ];
  const path_to_gold: PathToGoldEntry[] = stages.map((stage) => {
    const upstream = byStage.get(stage);
    const opp = teamLite(upstream?.opponent_code ?? null);
    return {
      stage,
      stage_label: STAGE_LABEL[stage],
      opponent_code: opp.code,
      opponent_name: opp.name,
      opponent_flag_emoji: opp.flag_emoji,
    };
  });

  // Compose the handle: prefer the owner profile's display name, then
  // their first name, then the upstream-provided handle, finally
  // "Anonymous". This is what shows above the podium and inside the
  // "@<handle>" share text.
  const handle =
    owner?.displayName?.trim() ||
    owner?.firstName?.trim() ||
    b.user_handle ||
    "Anonymous";
  const displayName = owner?.displayName?.trim() || null;
  const userId = b.user_id ?? null;
  const avatarUrl = userId ? `/avatars/${userId}.jpg` : null;
  const saved_at = b.locked_at ?? new Date(0).toISOString();
  const tournament_label =
    TOURNAMENT_LABEL[b.tournament_id] ?? b.tournament_id;

  return {
    bracket_id: b.share_guid,
    handle,
    user_id: userId,
    display_name: displayName,
    avatar_url: avatarUrl,
    saved_at,
    tournament_id: b.tournament_id,
    tournament_label,
    champion,
    runner_up,
    third_place,
    path_to_gold,
    ...(b.payload ? { payload: b.payload } : {}),
  };
}
