/**
 * Bracket parser for FIFA's official World Cup app / FIFA+ web
 * predictor share URLs.
 *
 * URL shapes we accept (FIFA+ is internationalised; the locale slug
 * sits right after the domain):
 *
 *   https://www.fifa.com/fifaplus/en/tournaments/.../predictor/<id>
 *   https://www.fifa.com/fifaplus/es/tournaments/.../predictor/<id>
 *   https://www.fifa.com/fifaplus/fr/tournaments/.../predictor/<id>
 *   https://www.fifa.com/fifaplus/pt/tournaments/.../predictor/<id>
 *
 * The newer shape (post-FIFA+ rebrand) drops `/fifaplus`:
 *
 *   https://www.fifa.com/en/tournaments/.../predictor/<id>
 *   https://www.fifa.com/es/.../predictor/<id>
 *
 * Both `play.fifa.com` and the app's deep-link share URLs
 * (`fifa.com/app/predictor/<id>` and `share.fifa.com/predictor/<id>`)
 * round-trip to one of the above, so we accept them too.
 *
 * EXTRACTION STRATEGY
 * -------------------
 * The FIFA tournaments hub is built on Next.js. Every page embeds the
 * SSR/SSG state inside a `<script id="__NEXT_DATA__"
 * type="application/json">` block. For a predictor URL the relevant
 * payload lives under one of:
 *
 *   props.pageProps.predictor.matches[]    (current)
 *   props.pageProps.bracket.matches[]      (legacy)
 *   props.pageProps.predictionData.matches[]
 *
 * Each match entry exposes the home/away team objects and the user's
 * pick (the team id the user selected to advance, or "draw" for group
 * stage). Champion + runner-up live alongside the matches array.
 *
 * If NEXT_DATA is absent (older static pages, partial fragments) we
 * fall back to a DOM scrape: every match card on the predictor page
 * carries `data-match-id`, the home/away team names live in
 * `[data-side="home"] [data-team-name]` and `[data-side="away"]
 * [data-team-name]`, and the picked side carries an `is-pick` class.
 *
 * Both code paths emit ParsedPick rows with verbatim team strings;
 * normalisation runs later in the wizard.
 */

import type {
  BracketParser,
  Fetcher,
  ParsedPick,
  ParseResult,
} from "../types";

/** Locale slugs FIFA+ supports today. We accept any 2-letter slug so
 *  we don't have to keep this list current, but the parser tests pin
 *  the four most common (en / es / fr / pt). */
const FIFA_HOSTS = new Set([
  "www.fifa.com",
  "fifa.com",
  "play.fifa.com",
  "share.fifa.com",
]);

/** True if `url` is on a FIFA-owned host with a /predictor/ segment. */
function isFifaPredictorUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!FIFA_HOSTS.has(parsed.hostname.toLowerCase())) return false;
  // The /predictor/ segment is the load-bearing signal; the locale +
  // tournament path varies but predictor is always present on a share
  // URL.
  return /\/predictor\//i.test(parsed.pathname);
}

/**
 * Minimal shape we expect from the NEXT_DATA JSON payload. Everything
 * is optional because FIFA tweaks the schema between rebrands and the
 * parser has to tolerate field drift gracefully.
 */
interface FifaTeam {
  readonly id?: string;
  readonly idCountry?: string;
  readonly code?: string;
  readonly name?: string;
  readonly shortName?: string;
  readonly countryName?: string;
}

interface FifaMatch {
  readonly id?: string;
  readonly matchId?: string;
  readonly idMatch?: string;
  readonly stage?: string;
  readonly stageName?: string;
  readonly kickoff?: string;
  readonly date?: string;
  readonly dateTime?: string;
  readonly homeTeam?: FifaTeam;
  readonly awayTeam?: FifaTeam;
  readonly home?: FifaTeam;
  readonly away?: FifaTeam;
  /** ID of the team the user picked (matches homeTeam.id or awayTeam.id). */
  readonly pickedTeamId?: string;
  readonly userPick?: string;
  readonly prediction?: { winnerTeamId?: string; outcome?: string };
  readonly outcome?: "home" | "away" | "draw";
  readonly updatedAt?: string;
  readonly pickedAt?: string;
}

interface FifaPredictorBlock {
  readonly matches?: ReadonlyArray<FifaMatch>;
  readonly champion?: FifaTeam | string;
  readonly championTeam?: FifaTeam;
  readonly winner?: FifaTeam | string;
  readonly runnerUp?: FifaTeam | string;
  readonly runnerUpTeam?: FifaTeam;
  readonly user?: { displayName?: string; username?: string; handle?: string };
}

interface FifaNextData {
  readonly props?: {
    readonly pageProps?: {
      readonly predictor?: FifaPredictorBlock;
      readonly bracket?: FifaPredictorBlock;
      readonly predictionData?: FifaPredictorBlock;
    };
  };
}

/**
 * Extract the JSON blob inside `<script id="__NEXT_DATA__" type="application/json">`.
 * Returns null if the tag is missing or the JSON is malformed.
 */
function extractNextData(html: string): FifaNextData | null {
  // Tolerate attribute order + extra attributes + whitespace.
  const re =
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim()) as FifaNextData;
  } catch {
    return null;
  }
}

/** Pick the first non-empty FifaPredictorBlock from the well-known keys. */
function selectPredictorBlock(
  data: FifaNextData,
): FifaPredictorBlock | null {
  const pp = data.props?.pageProps;
  if (!pp) return null;
  return pp.predictor ?? pp.bracket ?? pp.predictionData ?? null;
}

/** Resolve a team display string from a FifaTeam record, preferring the
 *  longest human-readable form. Returns empty string if none of the
 *  fields are set. */
function teamLabel(t: FifaTeam | undefined): string {
  if (!t) return "";
  return (
    t.name ??
    t.countryName ??
    t.shortName ??
    t.code ??
    t.idCountry ??
    t.id ??
    ""
  ).trim();
}

/** Resolve a team identifier we can match against `pickedTeamId`. */
function teamId(t: FifaTeam | undefined): string {
  if (!t) return "";
  return (t.id ?? t.idCountry ?? t.code ?? "").trim();
}

/**
 * Convert a NEXT_DATA predictor block into our ParseResult. Skips
 * match rows that are missing both team names; surfaces unresolved
 * picks verbatim (the caller handles unmappable team names).
 */
function parseFromNextData(block: FifaPredictorBlock): ParseResult {
  const matches: ParsedPick[] = [];

  for (const m of block.matches ?? []) {
    const home = m.homeTeam ?? m.home;
    const away = m.awayTeam ?? m.away;
    const homeRaw = teamLabel(home);
    const awayRaw = teamLabel(away);
    if (!homeRaw || !awayRaw) continue;

    const pick = resolvePick({
      home,
      away,
      homeRaw,
      awayRaw,
      pickedTeamId: m.pickedTeamId ?? m.userPick ?? m.prediction?.winnerTeamId,
      outcomeHint: m.outcome ?? m.prediction?.outcome,
    });
    if (!pick) continue;

    const sourceMatchId = m.id ?? m.matchId ?? m.idMatch;
    const kickoffHint = m.kickoff ?? m.date ?? m.dateTime;
    const sourceTimestamp = m.pickedAt ?? m.updatedAt;

    matches.push({
      homeTeamRaw: homeRaw,
      awayTeamRaw: awayRaw,
      predictedWinnerRaw: pick,
      ...(sourceMatchId ? { sourceMatchId } : {}),
      ...(kickoffHint ? { kickoffHint } : {}),
      ...(sourceTimestamp ? { sourceTimestamp } : {}),
    });
  }

  const champion = championLabel(
    block.champion ?? block.championTeam ?? block.winner,
  );
  const runnerUp = championLabel(block.runnerUp ?? block.runnerUpTeam);
  const handle =
    block.user?.displayName ?? block.user?.username ?? block.user?.handle;

  return {
    matches,
    ...(champion ? { championRaw: champion } : {}),
    ...(runnerUp ? { runnerUpRaw: runnerUp } : {}),
    ...(handle ? { sourceUserHandle: handle } : {}),
  };
}

function championLabel(v: FifaTeam | string | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  return teamLabel(v);
}

/**
 * Resolve the user's predicted winner from a FifaMatch row. FIFA
 * exposes the pick in three different ways across versions:
 *   1. `pickedTeamId` matches one of homeTeam.id / awayTeam.id.
 *   2. `outcome` is "home" | "away" | "draw".
 *   3. `prediction.winnerTeamId` (legacy).
 *
 * Returns null when none of those signals are present (caller skips
 * the row entirely - an empty bracket).
 */
function resolvePick(args: {
  home: FifaTeam | undefined;
  away: FifaTeam | undefined;
  homeRaw: string;
  awayRaw: string;
  pickedTeamId: string | undefined;
  outcomeHint: string | undefined;
}): string | "draw" | null {
  const homeId = teamId(args.home);
  const awayId = teamId(args.away);
  const pid = args.pickedTeamId?.trim();
  if (pid) {
    if (homeId && pid === homeId) return args.homeRaw;
    if (awayId && pid === awayId) return args.awayRaw;
    if (pid.toLowerCase() === "draw") return "draw";
  }
  const oh = args.outcomeHint?.toLowerCase();
  if (oh === "home" || oh === "home_win") return args.homeRaw;
  if (oh === "away" || oh === "away_win") return args.awayRaw;
  if (oh === "draw") return "draw";
  return null;
}

/**
 * DOM fallback. Each predictor match card looks like:
 *
 *   <div class="predictor-match" data-match-id="..." data-stage="...">
 *     <div data-side="home" class="is-pick">
 *       <span data-team-name>Argentina</span>
 *     </div>
 *     <div data-side="away">
 *       <span data-team-name>France</span>
 *     </div>
 *   </div>
 *
 * Group-stage matches add `<div data-side="draw" class="is-pick">` when
 * the user picked a draw. Champion + runner-up sit in a separate
 * `<section data-role="champion">` block.
 *
 * We use regex extraction (not a full HTML parser) because the page is
 * server-rendered, the markup is stable, and a dependency-free regex
 * pass keeps the parser fast + lazy-bundled-safe.
 */
function parseFromDom(html: string): ParseResult {
  const matches: ParsedPick[] = [];

  // Walk every predictor-match opener and keep both the opening tag
  // (so we can read data-* attributes from the wrapper itself) and
  // the body up to the next card / section boundary.
  const openerRe =
    /<div\b([^>]*class=["'][^"']*predictor-match[^"']*["'][^>]*)>/gi;
  type CardBlock = { opener: string; body: string };
  const cards: CardBlock[] = [];
  const openers: Array<{ opener: string; end: number }> = [];
  let mm: RegExpExecArray | null;
  while ((mm = openerRe.exec(html)) !== null) {
    openers.push({ opener: mm[1], end: mm.index + mm[0].length });
  }
  for (let i = 0; i < openers.length; i++) {
    const start = openers[i].end;
    const stop =
      i + 1 < openers.length ? openers[i + 1].end - openers[i + 1].opener.length - 5 : html.length;
    // Trim to the next <section …data-role=… boundary so champion
    // markup doesn't leak into the last card's body.
    const slice = html.slice(start, stop);
    const sectionAt = slice.search(/<section\b/i);
    const body = sectionAt >= 0 ? slice.slice(0, sectionAt) : slice;
    cards.push({ opener: openers[i].opener, body });
  }

  for (const { opener, body } of cards) {
    const card = body;
    const matchIdMatch = opener.match(/data-match-id=["']([^"']+)["']/i);
    const kickoffMatch =
      opener.match(/data-kickoff=["']([^"']+)["']/i) ??
      opener.match(/data-date=["']([^"']+)["']/i);

    const home = extractSide(card, "home");
    const away = extractSide(card, "away");
    if (!home.name || !away.name) continue;

    const drawPicked = /data-side=["']draw["'][^>]*class=["'][^"']*is-pick/i.test(
      card,
    );

    let predictedWinnerRaw: string | "draw" | null = null;
    if (drawPicked) {
      predictedWinnerRaw = "draw";
    } else if (home.isPick) {
      predictedWinnerRaw = home.name;
    } else if (away.isPick) {
      predictedWinnerRaw = away.name;
    }
    if (!predictedWinnerRaw) continue;

    matches.push({
      homeTeamRaw: home.name,
      awayTeamRaw: away.name,
      predictedWinnerRaw,
      ...(matchIdMatch ? { sourceMatchId: matchIdMatch[1] } : {}),
      ...(kickoffMatch ? { kickoffHint: kickoffMatch[1] } : {}),
    });
  }

  const champion = extractChampion(html, "champion");
  const runnerUp = extractChampion(html, "runner-up");
  const handle = extractUserHandle(html);

  return {
    matches,
    ...(champion ? { championRaw: champion } : {}),
    ...(runnerUp ? { runnerUpRaw: runnerUp } : {}),
    ...(handle ? { sourceUserHandle: handle } : {}),
  };
}

/** Pull the team name + is-pick state for one side of a predictor card. */
function extractSide(
  card: string,
  side: "home" | "away",
): { name: string; isPick: boolean } {
  const sideRe = new RegExp(
    `<div[^>]*data-side=["']${side}["'][^>]*>([\\s\\S]*?)<\\/div>`,
    "i",
  );
  const m = card.match(sideRe);
  if (!m) return { name: "", isPick: false };
  const inner = m[0];
  const nameMatch =
    inner.match(/data-team-name[^>]*>\s*([^<]+?)\s*</i) ??
    inner.match(/<span[^>]*class=["'][^"']*team-name[^"']*["'][^>]*>\s*([^<]+?)\s*</i);
  const isPick = /class=["'][^"']*is-pick[^"']*["']/i.test(inner);
  return { name: nameMatch ? nameMatch[1].trim() : "", isPick };
}

function extractChampion(
  html: string,
  role: "champion" | "runner-up",
): string {
  const sectionRe = new RegExp(
    `<section[^>]*data-role=["']${role}["'][^>]*>([\\s\\S]*?)<\\/section>`,
    "i",
  );
  const m = html.match(sectionRe);
  if (!m) return "";
  const inner = m[1];
  const name =
    inner.match(/data-team-name[^>]*>\s*([^<]+?)\s*</i) ??
    inner.match(/<span[^>]*class=["'][^"']*team-name[^"']*["'][^>]*>\s*([^<]+?)\s*</i);
  return name ? name[1].trim() : "";
}

function extractUserHandle(html: string): string {
  const m =
    html.match(/data-user-handle=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]*name=["']fifa:user-handle["'][^>]*content=["']([^"']+)["']/i);
  return m ? m[1].trim() : "";
}

export const fifaParser: BracketParser = {
  source: "fifa",

  canParse(url: string): boolean {
    return isFifaPredictorUrl(url);
  },

  async parse(url: string, fetcher: Fetcher): Promise<ParseResult> {
    if (!isFifaPredictorUrl(url)) {
      throw new Error("fifa-url-shape-invalid");
    }

    const res = await fetcher.fetch({ url, timeoutMs: 10_000 });
    if (!res.ok) {
      throw new Error(`fifa-fetch-failed:${res.error}`);
    }

    // Prefer the NEXT_DATA path: it gives us stable IDs, kickoff
    // timestamps, and the pick relationship without HTML parsing.
    const nd = extractNextData(res.html);
    if (nd) {
      const block = selectPredictorBlock(nd);
      if (block && (block.matches?.length ?? 0) > 0) {
        return parseFromNextData(block);
      }
    }

    // Fallback: DOM scrape. Also covers the "empty bracket" case,
    // where the page renders the layout but no picks have been made.
    return parseFromDom(res.html);
  },
};

export default fifaParser;
