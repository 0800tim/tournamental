/**
 * Bracket-share payload helpers.
 *
 * The share surface (OG image + /share/[bracketId] page) needs to know
 * the user's headline picks. Until the persisted bracket API
 * (`/v1/predictions/bracket`) lands, we serialise a minimal payload
 * into the URL itself: handle, winner, and the four-stage route. The
 * `bracketId` slug in the path is purely cosmetic until the API can
 * resolve it server-side.
 *
 * Format options:
 *  - Query-string keys: `handle`, `winner`, `winnerCode`, `route` (4
 *    `code:name` pairs joined with `|`), `tagline`.
 *  - Base64-encoded JSON via the `p` key (preferred for long routes).
 *
 * Both forms are accepted by `decodeBracketPayload`. The encoder always
 * emits both — clean keys for human-debuggability, `p=` for stability if
 * a future field is added.
 */

export interface BracketShareStep {
  readonly stage: "R16" | "QF" | "SF" | "FINAL";
  readonly teamCode: string;
  readonly teamName: string;
  readonly flagEmoji?: string;
}

export interface BracketSharePayload {
  readonly bracketId: string;
  readonly handle: string;
  readonly winnerName: string;
  readonly winnerCode: string;
  readonly winnerFlagEmoji?: string;
  readonly route: ReadonlyArray<BracketShareStep>;
  readonly tagline?: string;
  readonly longShotCount?: number;
  readonly tournamentName: string;
}

const TOURNAMENT_DEFAULT = "FIFA World Cup 2026";

const STAGES = ["R16", "QF", "SF", "FINAL"] as const;

function stageFromIndex(i: number): BracketShareStep["stage"] {
  return STAGES[i] ?? "FINAL";
}

/**
 * Convert an ISO-3166 alpha-2 / alpha-3 code to a regional-indicator
 * pair emoji (works for alpha-2, falls back to a soccer-ball glyph for
 * alpha-3 since regional indicators are only two characters).
 *
 * The renderer is satori, which can't fetch external SVGs at request
 * time, so emoji is the most reliable on-card flag representation.
 */
export function flagEmoji(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const cc = code.trim().toUpperCase();
  if (cc.length !== 2) return undefined;
  if (!/^[A-Z]{2}$/.test(cc)) return undefined;
  const base = 0x1f1e6 - "A".charCodeAt(0);
  return String.fromCodePoint(cc.charCodeAt(0) + base, cc.charCodeAt(1) + base);
}

/**
 * Parse a `code:name` route param string of the form
 * `ARG:Argentina|BRA:Brazil|FRA:France|ARG:Argentina`.
 */
function parseRouteString(s: string): BracketShareStep[] {
  return s
    .split("|")
    .filter(Boolean)
    .map((piece, i) => {
      const [code, name, emoji] = piece.split(":");
      const codeTrim = (code ?? "").trim();
      return {
        stage: stageFromIndex(i),
        teamCode: codeTrim,
        teamName: (name ?? codeTrim).trim(),
        flagEmoji: (emoji && emoji.trim()) || undefined,
      };
    });
}

/** Decode a payload from a URLSearchParams-like map. */
export function decodeBracketPayload(
  bracketId: string,
  searchParams: URLSearchParams | Record<string, string | undefined>,
): BracketSharePayload {
  const get = (key: string): string | undefined => {
    if (searchParams instanceof URLSearchParams) {
      const v = searchParams.get(key);
      return v ?? undefined;
    }
    return searchParams[key];
  };

  // Base64 JSON form takes precedence if present.
  const p = get("p");
  if (p) {
    try {
      const json = JSON.parse(
        Buffer.from(decodeURIComponent(p), "base64").toString("utf8"),
      ) as Partial<BracketSharePayload>;
      return mergeWithDefaults(bracketId, json);
    } catch {
      // fall through to plain params
    }
  }

  const handle = get("handle") ?? "anonymous";
  const winnerCode = (get("winnerCode") ?? get("winner") ?? "TBD").toUpperCase();
  const winnerName = get("winnerName") ?? get("winner") ?? "TBD";
  const winnerFlagEmoji = get("winnerFlag") ?? flagEmoji(winnerCode);
  const routeStr = get("route");
  const tagline = get("tagline") ?? undefined;
  const longShotCount = get("longShots")
    ? Number(get("longShots")) || undefined
    : undefined;
  const tournamentName = get("tournament") ?? TOURNAMENT_DEFAULT;

  let route: BracketShareStep[] = routeStr ? parseRouteString(routeStr) : [];

  if (route.length === 0) {
    // Synthesise a placeholder route with just the winner at the Final.
    route = [
      { stage: "R16", teamCode: winnerCode, teamName: winnerName, flagEmoji: winnerFlagEmoji },
      { stage: "QF", teamCode: winnerCode, teamName: winnerName, flagEmoji: winnerFlagEmoji },
      { stage: "SF", teamCode: winnerCode, teamName: winnerName, flagEmoji: winnerFlagEmoji },
      { stage: "FINAL", teamCode: winnerCode, teamName: winnerName, flagEmoji: winnerFlagEmoji },
    ];
  }

  return {
    bracketId,
    handle,
    winnerCode,
    winnerName,
    winnerFlagEmoji,
    route,
    tagline,
    longShotCount,
    tournamentName,
  };
}

function mergeWithDefaults(
  bracketId: string,
  partial: Partial<BracketSharePayload>,
): BracketSharePayload {
  const winnerCode = (partial.winnerCode ?? "TBD").toUpperCase();
  const winnerName = partial.winnerName ?? winnerCode;
  return {
    bracketId,
    handle: partial.handle ?? "anonymous",
    winnerCode,
    winnerName,
    winnerFlagEmoji: partial.winnerFlagEmoji ?? flagEmoji(winnerCode),
    route:
      partial.route && partial.route.length > 0
        ? partial.route
        : [
            { stage: "R16", teamCode: winnerCode, teamName: winnerName },
            { stage: "QF", teamCode: winnerCode, teamName: winnerName },
            { stage: "SF", teamCode: winnerCode, teamName: winnerName },
            { stage: "FINAL", teamCode: winnerCode, teamName: winnerName },
          ],
    tagline: partial.tagline,
    longShotCount: partial.longShotCount,
    tournamentName: partial.tournamentName ?? TOURNAMENT_DEFAULT,
  };
}

/** Encode the inverse — used by the client when building share links. */
export function encodeBracketPayload(payload: BracketSharePayload): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("handle", payload.handle);
  sp.set("winner", payload.winnerName);
  sp.set("winnerCode", payload.winnerCode);
  if (payload.winnerFlagEmoji) sp.set("winnerFlag", payload.winnerFlagEmoji);
  if (payload.tournamentName) sp.set("tournament", payload.tournamentName);
  if (payload.tagline) sp.set("tagline", payload.tagline);
  if (payload.longShotCount !== undefined)
    sp.set("longShots", String(payload.longShotCount));
  if (payload.route.length > 0) {
    sp.set(
      "route",
      payload.route
        .map((r) => `${r.teamCode}:${r.teamName}${r.flagEmoji ? ":" + r.flagEmoji : ""}`)
        .join("|"),
    );
  }
  return sp;
}

/** Build the default caption used in share-modal captions / tweet text. */
export function buildShareCaption(payload: BracketSharePayload, shareUrl: string): string {
  return (
    `My @VTourn ${payload.tournamentName} prediction: ` +
    `${payload.winnerName} to lift the trophy 🏆 — make yours at ${shareUrl}`
  );
}

/** Title used in OG meta tags. */
export function buildShareTitle(payload: BracketSharePayload): string {
  return `@${payload.handle}'s ${payload.tournamentName} bracket — VTourn`;
}

/** Description used in OG meta + share previews. */
export function buildShareDescription(payload: BracketSharePayload): string {
  return `${payload.handle} picked ${payload.winnerName} to lift the trophy. Lock yours before kickoff.`;
}
