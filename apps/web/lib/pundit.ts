/**
 * Verified-Pundit client helpers.
 *
 * Fetches `GET /v1/users/:userId/pundit` from the game-service. The
 * service caches its own response (60s TTL + SWR), so we keep the client
 * simple, no LRU here.
 *
 * Future-revenue-share hook (TODO, do NOT implement here): the same
 * payload feeds the Drips Network contributor allocation per docs/19.
 * Treat it as the canonical "is this user worth paying out" signal.
 */

export interface PunditStatus {
  readonly verified: boolean;
  readonly levels: number;
  readonly sinceDate: string | null;
  readonly tournaments: ReadonlyArray<string>;
}

// Resolution order matches `lib/bracket/api.ts`: prefer the canonical
// NEXT_PUBLIC_GAME_API_URL, fall back to the legacy var, then the
// production host. The legacy `vtorn-game.aiva.nz` default was the
// dev-mesh hostname and no longer resolves in production.
const GAME_BASE =
  process.env.NEXT_PUBLIC_GAME_API_URL ??
  process.env.NEXT_PUBLIC_VTORN_GAME_URL ??
  "https://game.tournamental.com";

export const UNVERIFIED: PunditStatus = {
  verified: false,
  levels: 0,
  sinceDate: null,
  tournaments: [],
};

/**
 * Fetch a user's pundit status. Never throws, on any failure we return
 * the unverified shape so the badge renders nothing and the page stays up.
 */
export async function fetchPunditStatus(
  userId: string,
  init: { fetchImpl?: typeof fetch; baseUrl?: string } = {},
): Promise<PunditStatus> {
  const fetchImpl = init.fetchImpl ?? fetch;
  const base = init.baseUrl ?? GAME_BASE;
  if (!userId) return UNVERIFIED;
  try {
    const res = await fetchImpl(
      `${base}/v1/users/${encodeURIComponent(userId)}/pundit`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return UNVERIFIED;
    const body = (await res.json()) as Partial<PunditStatus>;
    return normalise(body);
  } catch {
    return UNVERIFIED;
  }
}

/** Coerce an unknown payload into a PunditStatus, defending the UI. */
export function normalise(body: Partial<PunditStatus> | null | undefined): PunditStatus {
  if (!body) return UNVERIFIED;
  return {
    verified: Boolean(body.verified),
    levels: typeof body.levels === "number" ? body.levels : 0,
    sinceDate: typeof body.sinceDate === "string" ? body.sinceDate : null,
    tournaments: Array.isArray(body.tournaments) ? body.tournaments.slice() : [],
  };
}
