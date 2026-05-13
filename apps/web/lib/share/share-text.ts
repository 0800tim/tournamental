/**
 * Pure helpers for composing share URLs, platform deep-links, and the
 * pre-filled share copy that powers the Save & Share surface.
 *
 * No DOM, no fetches, no React. Everything here is unit-testable.
 *
 * Cache policy: callers must memoise outputs — these functions are
 * trivial, but `shareUrlFor` in particular is consumed by every render
 * of the Save & share page and we don't want a fresh URL each tick.
 */

/**
 * Public play.tournamental.com origin used in the human-readable share
 * URL. We deliberately do NOT use the apex tournamental.com here — `play`
 * is the consumption-side subdomain (parallel agent #67 owns the
 * `/s/<guid>` route there).
 */
export const PLAY_ORIGIN = "https://play.tournamental.com";

export type OgSize = "portrait" | "landscape" | "square";

export interface ShareCopyInput {
  /** The user's predicted final winner, e.g. "Argentina". `null`/`"—"` ⇒ incomplete bracket. */
  readonly champion: string | null;
  /** Stable share guid (the bracketId hash, or the auth user id). */
  readonly guid: string;
  /** Whether the bracket is "complete" — used to pick between two copy variants. */
  readonly isComplete: boolean;
}

export interface ShareLinks {
  readonly whatsapp: string;
  readonly telegram: string;
  readonly x: string;
  readonly facebook: string;
  readonly email: string;
}

/**
 * The canonical user-facing share URL. Stable per (guid) — the same
 * bracket always produces the same URL, so previews can be cached.
 */
export function shareUrlFor(guid: string): string {
  // Strip any whitespace + URL-encode the guid segment so a bad input
  // can't break the URL.
  const safe = encodeURIComponent(String(guid).trim());
  return `${PLAY_ORIGIN}/s/${safe}`;
}

/**
 * Human-readable short form, e.g. for the read-only copy field.
 * Stripped of the protocol prefix so it fits on one line on mobile.
 */
export function shareDisplayUrlFor(guid: string): string {
  return shareUrlFor(guid).replace(/^https?:\/\//, "");
}

/**
 * Pre-filled message body used as the `text` argument to navigator.share
 * and as the body of platform deep-links.
 *
 * Two variants:
 *   - Complete bracket: "Just locked in my Football World Cup 2026 bracket
 *     on Tournamental — I've got <Champion> taking the trophy. Pick
 *     yours: <url>"
 *   - Incomplete: "I'm building my Football World Cup 2026 bracket on
 *     Tournamental. Build yours: <url>"
 */
export function buildShareText(input: ShareCopyInput): string {
  const url = shareUrlFor(input.guid);
  if (input.isComplete && input.champion && input.champion !== "—" && input.champion !== "TBD") {
    return (
      `Just locked in my Football World Cup 2026 bracket on Tournamental — ` +
      `I've got ${input.champion} taking the trophy. Pick yours: ${url}`
    );
  }
  return (
    `I'm building my Football World Cup 2026 bracket on Tournamental. ` +
    `Build yours: ${PLAY_ORIGIN.replace(/^https?:\/\//, "")}/world-cup-2026`
  );
}

/** Short title used by navigator.share. */
export function buildShareTitle(): string {
  return "My Tournamental World Cup 2026 bracket";
}

/**
 * Compose the platform deep-link URLs for the five share targets. Each
 * one pre-fills the text + the user's share URL.
 *
 * Patterns:
 *   - WhatsApp:  https://wa.me/?text=<encoded text incl. url>
 *   - Telegram:  https://t.me/share/url?url=<url>&text=<text>
 *   - X:         https://twitter.com/intent/tweet?text=<text>&url=<url>
 *   - Facebook:  https://www.facebook.com/sharer/sharer.php?u=<url>
 *   - Email:     mailto:?subject=<title>&body=<text>
 */
export function buildShareLinks(input: ShareCopyInput): ShareLinks {
  const url = shareUrlFor(input.guid);
  const text = buildShareText(input);
  const title = buildShareTitle();

  // Some platforms (WhatsApp, X) want the URL inline in the text; others
  // (Telegram, Facebook) take url + text as separate params. We always
  // include the URL inside `text` so even the param-only platforms still
  // get a useful preview body when the user pastes manually.
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`,
  };
}

/**
 * Compose the /api/og/bracket image URL for the user's bracket.
 *
 * The OG endpoint (currently being upgraded by parallel agent #68 to
 * render rich gold/silver/bronze cups + flag chips) accepts:
 *   - bracket_id (required, immutable)
 *   - handle (display name)
 *   - winner (predicted champion country code or name)
 *   - size  (portrait | landscape | square — added by agent #68)
 *
 * We always include `size`. Until #68 lands the endpoint ignores it and
 * renders the default 1200×630 — the page still works, the image is
 * just always the landscape variant. Once #68 merges, the format
 * switcher in the UI controls the actual rendered shape.
 */
export interface OgImageInput {
  readonly bracketId: string;
  readonly handle?: string | null;
  readonly winner?: string | null;
  readonly size?: OgSize;
}

export function buildOgImageUrl(input: OgImageInput, basePath = "/api/og/bracket"): string {
  const q = new URLSearchParams();
  q.set("bracket_id", input.bracketId);
  if (input.handle) q.set("handle", input.handle);
  if (input.winner) q.set("winner", input.winner);
  if (input.size) q.set("size", input.size);
  return `${basePath}?${q.toString()}`;
}

/** Default file-name for the downloaded OG image. */
export function ogDownloadFilename(input: OgImageInput): string {
  const handle = (input.handle ?? "bracket").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bracket";
  const size = input.size ?? "landscape";
  return `tournamental-${handle}-${size}.png`;
}

/**
 * Stable per-user share guid.
 *
 * Preference order (post-save-guid migration):
 *   1. `serverShareGuid` — the canonical guid returned by the last
 *      successful save (from `POST /v1/bracket/submit`'s
 *      `share_guid` field). This is the value the `/s/<guid>` route
 *      resolves; the share URL MUST use this one whenever it's known,
 *      otherwise the recipient gets a different bracket. Stored in
 *      `lib/share/share-guid-storage.ts` so it survives reloads.
 *   2. Authenticated user id (from `useUser()` once PR #138 lands).
 *      Falls back here only when we don't yet have a server guid.
 *   3. The bracket's `bracketId`. Last-ditch fallback for the
 *      offline-only state where the user hasn't saved yet.
 *
 * Never derive from `Date.now()` or fresh random — the URL must be
 * stable across renders + reloads.
 */
// Server-side bracketIds are minted as `bk_<userId>_<tournamentId>_<nowMs>`
// (see apps/game/src/routes/picks.ts). If the only thing we have to
// share is a bracketId, prefer the embedded userId UUID — it's the
// stable per-user share key, and the resolver looks brackets up by
// user_id when share_guid doesn't match. Falling back to the full
// bracketId would produce an 80-char share URL that nobody can paste.
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractUserIdFromBracketId(bracketId: string): string | null {
  const m = bracketId.match(
    /^bk_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_/i,
  );
  return m ? m[1] : null;
}

export function resolveShareGuid(opts: {
  readonly serverShareGuid?: string | null;
  readonly authUserId?: string | null;
  readonly bracketId?: string | null;
}): string {
  const server = (opts.serverShareGuid ?? "").trim();
  if (server) return server;
  const auth = (opts.authUserId ?? "").trim();
  if (auth && UUID_V4_RE.test(auth)) return auth;
  const b = (opts.bracketId ?? "").trim();
  const fromBracket = b ? extractUserIdFromBracketId(b) : null;
  if (fromBracket) return fromBracket;
  if (auth) return auth;
  if (b) return b;
  // Last resort — should rarely fire because the bracket builder always
  // hydrates a localUserId. We return a non-empty sentinel so URL
  // composition doesn't break the page render.
  return "anonymous";
}
