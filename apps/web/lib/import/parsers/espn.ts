/**
 * ESPN bracket parser for the Tournamental bracket-import feature.
 *
 * ESPN's Tournament Challenge ("Capital One Bracket Challenge" and the
 * FIFA-style world-cup variants) is React-hydrated client-side. The
 * initial HTTP response is a thin skeleton that only renders the picks
 * once JavaScript has run. We therefore call the fetcher with
 * `needsBrowser: true`, which lets the production fetcher swap in a
 * Playwright Chromium load (see apps/web/lib/import/fetcher.ts) so we
 * receive the post-hydration HTML.
 *
 * For unit tests we feed synthesised "post-hydration" HTML via the
 * staticFetcher helper. That HTML mirrors the structure Playwright
 * would return after waiting for networkidle: a hydrated DOM plus the
 * various JSON-in-script blobs ESPN keeps around for client-side
 * rehydration (window.__INITIAL_STATE__, window.__espnfitt__, or an
 * application/json script tag with id="initialData").
 *
 * Extraction strategy, in priority order:
 *
 *   1. JSON-in-script. ESPN frequently inlines a JSON document under
 *      one of a handful of well-known global names. When present it
 *      describes every match + the user's pick directly, with stable
 *      identifiers, and is by far the cleanest extraction path.
 *
 *   2. DOM fallback. When the JSON blob is missing (e.g. a different
 *      bracket variant or a future ESPN refactor), we fall back to
 *      walking the post-hydration DOM. ESPN renders each match as a
 *      `.matchup` (or `[data-testid="matchup"]`) container with two
 *      `.team` slots, one of which carries an `.is-winner` /
 *      `aria-selected="true"` flag for the user's pick.
 *
 * Public ESPN bracket URL shapes we accept (the canParse regex is
 * intentionally generous; URL shape changes year to year):
 *
 *   - https://fantasy.espn.com/games/fifa-world-cup-bracket-2026/bracket?entryID=12345
 *   - https://fantasy.espn.com/games/fifa-world-cup-bracket-2026/bracket?bracketId=abc
 *   - https://fantasy.espn.com/tournament-challenge-bracket-2026/bracket?entryID=12345
 *   - https://www.espn.com/fifa-world-cup/bracket/_/entryID/12345
 *   - https://www.espn.com/fifa-world-cup/tournament-challenge?entryID=12345
 *
 * NZ English throughout. Pure functions only; the only I/O is via the
 * supplied Fetcher.
 */

import type { BracketParser, Fetcher, ParsedPick, ParseResult } from "../types";

/**
 * URL patterns we treat as ESPN bracket / Tournament Challenge URLs.
 * Intentionally permissive: ESPN routinely reshuffles the path between
 * tournaments and we want canParse() to remain useful across years.
 */
const URL_PATTERNS: ReadonlyArray<RegExp> = [
  /^https?:\/\/(www\.|fantasy\.)?espn\.com\/.*(bracket|tournament-challenge)/i,
];

export const espnParser: BracketParser = {
  source: "espn",

  canParse(url: string): boolean {
    if (typeof url !== "string" || url.length === 0) return false;
    return URL_PATTERNS.some((re) => re.test(url));
  },

  async parse(url: string, fetcher: Fetcher): Promise<ParseResult> {
    // ESPN is React-hydrated, so request the post-hydration HTML from
    // the fetcher. In production this routes through Playwright; in
    // tests the staticFetcher returns synthesised post-hydration HTML.
    const res = await fetcher.fetch({ url, needsBrowser: true });
    if (!res.ok) {
      throw new Error(`espn-fetch-failed:${res.status}:${res.error}`);
    }
    return parseHtml(res.html);
  },
};

/**
 * Visible for unit tests. Pure: takes the post-hydration HTML, returns
 * a ParseResult. No I/O.
 */
export function parseHtml(html: string): ParseResult {
  // 1. Try the JSON-in-script path first; it carries stable ids.
  const fromJson = tryExtractFromJsonBlob(html);
  if (fromJson && fromJson.matches.length > 0) {
    return fromJson;
  }

  // 2. Fall back to DOM extraction. The JSON path may have returned a
  //    handle (sourceUserHandle) even when matches were empty; keep it.
  const fromDom = extractFromDom(html);
  if (fromJson?.sourceUserHandle && !fromDom.sourceUserHandle) {
    return { ...fromDom, sourceUserHandle: fromJson.sourceUserHandle };
  }
  return fromDom;
}

// ---------------------------------------------------------------------
// JSON-in-script extraction
// ---------------------------------------------------------------------

/**
 * The well-known global names ESPN has used to inline rehydration JSON
 * across recent Tournament Challenge variants. We try each in turn.
 */
const JSON_BLOB_PATTERNS: ReadonlyArray<RegExp> = [
  /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/,
  /window\.__espnfitt__\s*=\s*(\{[\s\S]*?\})\s*;\s*<\/script>/,
  /<script[^>]*id=["']initialData["'][^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/,
  /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/,
];

interface RawEspnMatch {
  readonly id?: string | number;
  readonly home?: string;
  readonly away?: string;
  readonly pick?: string;
  readonly kickoff?: string;
  readonly lockedAt?: string;
  readonly round?: string;
  readonly isDraw?: boolean;
}

interface RawEspnBlob {
  readonly entry?: { handle?: string; displayName?: string; userName?: string };
  readonly user?: { handle?: string; displayName?: string };
  readonly bracket?: {
    matches?: ReadonlyArray<RawEspnMatch>;
    champion?: string;
    runnerUp?: string;
  };
  readonly matches?: ReadonlyArray<RawEspnMatch>;
  readonly champion?: string;
  readonly runnerUp?: string;
}

function tryExtractFromJsonBlob(html: string): ParseResult | null {
  for (const re of JSON_BLOB_PATTERNS) {
    const m = html.match(re);
    if (!m || !m[1]) continue;
    const parsed = safeJsonParse(m[1]);
    if (!parsed) continue;
    const result = mapBlob(parsed as RawEspnBlob);
    if (result) return result;
  }
  return null;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function mapBlob(blob: RawEspnBlob): ParseResult | null {
  const rawMatches = blob.bracket?.matches ?? blob.matches;
  if (!Array.isArray(rawMatches)) return null;
  const matches: ParsedPick[] = [];
  for (const m of rawMatches) {
    const home = typeof m.home === "string" ? m.home.trim() : "";
    const away = typeof m.away === "string" ? m.away.trim() : "";
    const pickRaw = typeof m.pick === "string" ? m.pick.trim() : "";
    if (!home || !away) continue;
    let predictedWinnerRaw: string | "draw" = pickRaw;
    if (m.isDraw === true || /^draw$/i.test(pickRaw)) {
      predictedWinnerRaw = "draw";
    } else if (!pickRaw) {
      // Match with no pick made yet (empty bracket row). Skip; the
      // caller treats `no-picks-found` as the empty-bracket signal
      // when matches.length === 0.
      continue;
    }
    const pick: ParsedPick = {
      homeTeamRaw: home,
      awayTeamRaw: away,
      predictedWinnerRaw,
      ...(m.kickoff ? { kickoffHint: String(m.kickoff) } : {}),
      ...(m.id !== undefined ? { sourceMatchId: String(m.id) } : {}),
      ...(m.lockedAt ? { sourceTimestamp: String(m.lockedAt) } : {}),
    };
    matches.push(pick);
  }
  const handle =
    blob.entry?.handle ??
    blob.entry?.displayName ??
    blob.entry?.userName ??
    blob.user?.handle ??
    blob.user?.displayName;
  const champion = blob.bracket?.champion ?? blob.champion;
  const runnerUp = blob.bracket?.runnerUp ?? blob.runnerUp;
  return {
    matches,
    ...(champion ? { championRaw: String(champion).trim() } : {}),
    ...(runnerUp ? { runnerUpRaw: String(runnerUp).trim() } : {}),
    ...(handle ? { sourceUserHandle: String(handle).trim() } : {}),
  };
}

// ---------------------------------------------------------------------
// DOM fallback extraction
// ---------------------------------------------------------------------

/**
 * Walk the post-hydration HTML looking for ESPN's matchup containers.
 * The shape is intentionally tolerant of small markup drift: we accept
 * either `class="matchup"` or `data-testid="matchup"`, and either
 * `class="team is-winner"` or `aria-selected="true"` to indicate the
 * user's pick.
 *
 * This is not a full HTML parser. We use regex-driven extraction
 * because (a) the post-hydration HTML is huge and we only need a
 * handful of fields, and (b) the parser stays a pure function with no
 * jsdom dependency. The regexes are deliberately anchored on stable
 * shapes so accidental matches in unrelated markup are unlikely.
 */
function extractFromDom(html: string): ParseResult {
  const matches: ParsedPick[] = [];
  // Grab each matchup block. We capture both the opening tag's
  // attributes (group 1, for data-matchup-id / data-kickoff that live
  // on the container element) and the inner HTML (group 2, for the
  // nested team spans).
  const matchupBlocks = matchAll(
    html,
    /<(?:div|li|article)([^>]*(?:class="[^"]*\bmatchup\b[^"]*"|data-testid="matchup")[^>]*)>([\s\S]*?)<\/(?:div|li|article)>/g,
  );
  for (const [, openAttrs, inner] of matchupBlocks) {
    const teams = extractTeams(inner);
    if (!teams) continue;
    const pick = extractWinner(inner, teams);
    const kickoff = extractAttr(openAttrs, /data-kickoff="([^"]+)"/);
    const sourceId = extractAttr(openAttrs, /data-matchup-id="([^"]+)"/);
    const isDraw = /data-is-draw="true"/i.test(openAttrs);
    let predictedWinnerRaw: string | "draw";
    if (isDraw) {
      predictedWinnerRaw = "draw";
    } else if (pick) {
      predictedWinnerRaw = pick;
    } else {
      // No pick made on this match yet; skip rather than fabricate.
      continue;
    }
    matches.push({
      homeTeamRaw: teams.home,
      awayTeamRaw: teams.away,
      predictedWinnerRaw,
      ...(kickoff ? { kickoffHint: kickoff } : {}),
      ...(sourceId ? { sourceMatchId: sourceId } : {}),
    });
  }

  const champion = extractAttr(
    html,
    /data-role="champion"[^>]*data-team="([^"]+)"/i,
  ) ??
    extractAttr(html, /<[^>]*\bclass="[^"]*\bchampion\b[^"]*"[^>]*>\s*([^<]+?)\s*</i);
  const runnerUp = extractAttr(
    html,
    /data-role="runner-up"[^>]*data-team="([^"]+)"/i,
  );
  const handle = extractAttr(
    html,
    /<[^>]*\bclass="[^"]*\bentry-name\b[^"]*"[^>]*>\s*([^<]+?)\s*</i,
  );

  return {
    matches,
    ...(champion ? { championRaw: champion.trim() } : {}),
    ...(runnerUp ? { runnerUpRaw: runnerUp.trim() } : {}),
    ...(handle ? { sourceUserHandle: handle.trim() } : {}),
  };
}

/**
 * Pull out every `<span class="team ...">` start tag inside the matchup
 * block. We work from the start-tag attributes (data-team plus the
 * class list) rather than the inner HTML, because team blocks contain
 * nested `<span class="team-name">` elements and a non-greedy "until
 * the next closing tag" regex would stop at the inner close, breaking
 * any attempt to capture a balanced region. The start-tag-only
 * approach keeps the parser a pure regex pipeline.
 */
interface TeamStartTag {
  readonly attrs: string;
  readonly afterIndex: number;
}

function findTeamStartTags(block: string): TeamStartTag[] {
  const out: TeamStartTag[] = [];
  const re = /<(?:div|span|li)([^>]*\bclass="[^"]*\bteam\b[^"]*"[^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    // Skip nested .team-name / .team-logo etc, only the outer .team
    // container is what we want. A simple class-tokens check excludes
    // the team-name inner span (class="team-name" tokenises as
    // ['team-name'], not ['team', ...]).
    const cls = m[1].match(/class="([^"]+)"/i);
    if (cls && cls[1]) {
      const tokens = cls[1].split(/\s+/);
      if (!tokens.includes("team")) continue;
    }
    out.push({ attrs: m[1], afterIndex: re.lastIndex });
  }
  return out;
}

function teamLabelFromTag(tag: TeamStartTag, block: string): string | null {
  // Prefer the data-team attribute when present.
  const dataTeam = tag.attrs.match(/data-team="([^"]+)"/i);
  if (dataTeam && dataTeam[1]) return decodeEntities(dataTeam[1].trim());
  // Otherwise look forward from the start tag for a .team-name span.
  const slice = block.slice(tag.afterIndex, tag.afterIndex + 1000);
  const named = slice.match(
    /<(?:span|div)[^>]*\bclass="[^"]*\bteam-name\b[^"]*"[^>]*>\s*([^<]+?)\s*</i,
  );
  if (named && named[1]) return decodeEntities(named[1].trim());
  return null;
}

function tagIsWinner(tag: TeamStartTag): boolean {
  if (/aria-selected="true"/i.test(tag.attrs)) return true;
  const cls = tag.attrs.match(/class="([^"]+)"/i);
  if (!cls || !cls[1]) return false;
  const tokens = cls[1].split(/\s+/);
  return tokens.includes("is-winner") || tokens.includes("team--picked");
}

function extractTeams(block: string): { home: string; away: string } | null {
  const tags = findTeamStartTags(block);
  if (tags.length < 2) return null;
  const home = teamLabelFromTag(tags[0], block);
  const away = teamLabelFromTag(tags[1], block);
  if (!home || !away) return null;
  return { home, away };
}

function extractWinner(
  block: string,
  teams: { home: string; away: string },
): string | null {
  const tags = findTeamStartTags(block);
  const winnerTag = tags.find(tagIsWinner);
  if (!winnerTag) return null;
  const label = teamLabelFromTag(winnerTag, block);
  if (!label) return null;
  // Sanity: the winner should match one side. If not, fall back to
  // the label anyway; the normaliser is the ultimate authority.
  if (label === teams.home || label === teams.away) return label;
  return label;
}

function extractAttr(html: string, re: RegExp): string | null {
  const m = html.match(re);
  if (!m || !m[1]) return null;
  return decodeEntities(m[1]);
}

function matchAll(s: string, re: RegExp): RegExpMatchArray[] {
  const out: RegExpMatchArray[] = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = r.exec(s)) !== null) {
    out.push(m as unknown as RegExpMatchArray);
    if (m.index === r.lastIndex) r.lastIndex += 1; // guard zero-width
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
