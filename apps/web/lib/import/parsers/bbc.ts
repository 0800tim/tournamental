/**
 * BBC Sport "World Cup Predictor" share-URL parser.
 *
 * Public share URLs the predictor exposes look like one of:
 *
 *   https://www.bbc.co.uk/sport/football/world-cup/predictor/<id>
 *   https://www.bbc.com/sport/football/world-cup/predictor/<id>
 *   https://www.bbc.co.uk/sport/football/world-cup-2026/predictor/<id>
 *   https://www.bbc.co.uk/sport/football/euro-2024/predictor/share/<id>
 *
 * The share id is typically a short base32-ish slug (e.g.
 * "ab12cd34ef56") or a ULID. We accept any non-empty alphanumeric
 * suffix to stay tolerant of BBC URL revisions; the real validation
 * happens server-side when `parse()` actually fetches the page.
 *
 * DOM model assumptions
 * ---------------------
 * BBC Sport predictor pages render server-side (the bracket is in
 * the initial HTML, not React-hydrated like ESPN), and historically
 * they have used `data-testid` + semantic class names for predictor
 * fixtures. The selectors we look for, in priority order:
 *
 *   1. `<section data-testid="predictor-bracket">` or
 *      `<div class="qa-predictor">` (the bracket container; if absent
 *      the page isn't a predictor page).
 *   2. Per-match fixture rows:
 *        <div class="qa-fixture" data-stage="group" data-fixture-id="...">
 *          <span class="qa-fixture__team qa-fixture__team--home">Argentina</span>
 *          <span class="qa-fixture__team qa-fixture__team--away">France</span>
 *          <span class="qa-fixture__pick" data-picked="home">Argentina</span>
 *        </div>
 *      The pick can be `data-picked="home" | "away" | "draw"`. Group
 *      matches allow `draw`; knockouts do not.
 *   3. Optional champion + runner-up callouts:
 *        <div class="qa-champion"><span class="qa-team-name">Argentina</span></div>
 *        <div class="qa-runner-up"><span class="qa-team-name">France</span></div>
 *   4. Optional handle (the BBC account name) in
 *      `<span class="qa-share-handle">@joebloggs</span>` for the
 *      preview "is this your bracket?" check.
 *
 * Because the real BBC predictor for 2026 was not reachable from the
 * dev box at parser-build time, the structure above is a *plausible*
 * model based on the BBC Sport widget conventions visible elsewhere
 * (qa-* hooks and data-testid in the football fixture pages). The
 * fixtures under `__fixtures__/bbc-*.html` codify the contract. If
 * the live page diverges, update the selectors + fixtures together
 * in one commit so the contract stays single-source-of-truth.
 *
 * The parser is regex-based (not DOM-based) so it can run in any
 * Node runtime without dragging jsdom into prod. Selectors stay
 * narrow + targeted to avoid the classic regex-HTML pitfalls; if
 * BBC ever ships a markup shape we can't match with regex, we
 * promote to a proper DOM walker.
 */

import type { BracketParser, ParseResult, ParsedPick, Fetcher } from "../types";

const URL_RE =
  /^https:\/\/(?:www\.)?bbc\.(?:com|co\.uk)\/sport\/football\/[a-z0-9-]+\/predictor(?:\/share)?\/[A-Za-z0-9_-]+\/?(?:\?.*)?$/;

/**
 * Named HTML entities we expect to see in BBC predictor pages. Limited
 * to Latin-1 accented characters (team names like "Côte d'Ivoire",
 * "Türkiye", "España") plus the usual punctuation entities. We do not
 * ship a full HTML5 entity table; the team-normaliser strips diacritics
 * downstream anyway, but the raw value must still be human-readable in
 * the wizard preview, so we decode the entities the source emits.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  Acirc: "Â", Ecirc: "Ê", Icirc: "Î", Ocirc: "Ô", Ucirc: "Û",
  atilde: "ã", ntilde: "ñ", otilde: "õ",
  Atilde: "Ã", Ntilde: "Ñ", Otilde: "Õ",
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü",
  Auml: "Ä", Euml: "Ë", Iuml: "Ï", Ouml: "Ö", Uuml: "Ü",
  ccedil: "ç", Ccedil: "Ç",
  szlig: "ß", aring: "å", Aring: "Å", aelig: "æ", AElig: "Æ",
  oslash: "ø", Oslash: "Ø",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (whole, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
        ? NAMED_ENTITIES[name]
        : whole,
    );
}

/** Strip HTML tags + decode the entities we expect. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull the value of an attribute off a tag fragment like
 *  `<div class="x" data-picked="home">`. */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return (m[1] ?? m[2] ?? "").trim();
}

/** Match every `<div class="qa-fixture" ...>...</div>` block. We use a
 *  non-greedy capture and a closing-tag sentinel; BBC's fixture rows
 *  don't nest. */
const FIXTURE_RE =
  /<div\b[^>]*\bclass="[^"]*\bqa-fixture\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div\b[^>]*\bclass="[^"]*\bqa-fixture\b|<\/section|<\/main|<\/body|<div\b[^>]*\bclass="[^"]*\bqa-(?:champion|runner-up|share-handle))/gi;

const FIXTURE_OPEN_RE = /<div\b[^>]*\bclass="[^"]*\bqa-fixture\b[^"]*"[^>]*>/i;

/** Extract one parsed pick from a fixture HTML chunk. Returns null if
 *  the chunk is missing required pieces (e.g. the user hasn't picked
 *  this match yet). */
function parseFixture(chunk: string): ParsedPick | null {
  const openMatch = FIXTURE_OPEN_RE.exec(chunk);
  const openTag = openMatch ? openMatch[0] : "";
  const fixtureId = attr(openTag, "data-fixture-id");
  const kickoff = attr(openTag, "data-kickoff");

  const homeMatch =
    /<span\b[^>]*\bclass="[^"]*\bqa-fixture__team--home\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(
      chunk,
    );
  const awayMatch =
    /<span\b[^>]*\bclass="[^"]*\bqa-fixture__team--away\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(
      chunk,
    );
  if (!homeMatch || !awayMatch) return null;
  const home = textOf(homeMatch[1]);
  const away = textOf(awayMatch[1]);
  if (!home || !away) return null;

  const pickMatch =
    /<span\b[^>]*\bclass="[^"]*\bqa-fixture__pick\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(
      chunk,
    );
  if (!pickMatch) return null;
  const pickOpen =
    /<span\b[^>]*\bclass="[^"]*\bqa-fixture__pick\b[^"]*"[^>]*>/i.exec(chunk);
  const pickedAttr = pickOpen ? attr(pickOpen[0], "data-picked") : null;
  const pickedText = textOf(pickMatch[1]);

  let predictedWinnerRaw: string | "draw";
  if (pickedAttr === "draw" || pickedText.toLowerCase() === "draw") {
    predictedWinnerRaw = "draw";
  } else if (pickedAttr === "home") {
    predictedWinnerRaw = home;
  } else if (pickedAttr === "away") {
    predictedWinnerRaw = away;
  } else if (pickedText) {
    // Fall back to text content if data-picked is missing.
    predictedWinnerRaw = pickedText;
  } else {
    return null;
  }

  const pick: ParsedPick = {
    homeTeamRaw: home,
    awayTeamRaw: away,
    predictedWinnerRaw,
    ...(kickoff ? { kickoffHint: kickoff } : {}),
    ...(fixtureId ? { sourceMatchId: fixtureId } : {}),
  };
  return pick;
}

/**
 * Iterate every `qa-fixture` block. We can't rely on
 * `FIXTURE_RE` alone (it uses a look-ahead sentinel that may eat
 * a fixture next to a champion block), so we split-then-scan: split
 * on the opening tag, then re-prepend the open tag to each chunk and
 * cut at the first sibling open.
 */
function collectFixtures(html: string): string[] {
  const opens: number[] = [];
  const opener = /<div\b[^>]*\bclass="[^"]*\bqa-fixture\b[^"]*"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(html)) !== null) {
    opens.push(m.index);
  }
  if (opens.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < opens.length; i += 1) {
    const start = opens[i];
    const end = i + 1 < opens.length ? opens[i + 1] : html.length;
    chunks.push(html.slice(start, end));
  }
  return chunks;
}

/** Extract champion / runner-up / handle from sidebar callouts. */
function extractSideInfo(html: string): {
  championRaw?: string;
  runnerUpRaw?: string;
  sourceUserHandle?: string;
} {
  const out: {
    championRaw?: string;
    runnerUpRaw?: string;
    sourceUserHandle?: string;
  } = {};

  const championBlock =
    /<div\b[^>]*\bclass="[^"]*\bqa-champion\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    );
  if (championBlock) {
    const name =
      /<span\b[^>]*\bclass="[^"]*\bqa-team-name\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(
        championBlock[1],
      );
    const value = name ? textOf(name[1]) : textOf(championBlock[1]);
    if (value) out.championRaw = value;
  }

  const runnerBlock =
    /<div\b[^>]*\bclass="[^"]*\bqa-runner-up\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    );
  if (runnerBlock) {
    const name =
      /<span\b[^>]*\bclass="[^"]*\bqa-team-name\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(
        runnerBlock[1],
      );
    const value = name ? textOf(name[1]) : textOf(runnerBlock[1]);
    if (value) out.runnerUpRaw = value;
  }

  const handle =
    /<span\b[^>]*\bclass="[^"]*\bqa-share-handle\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(
      html,
    );
  if (handle) {
    const value = textOf(handle[1]).replace(/^@/, "");
    if (value) out.sourceUserHandle = value;
  }

  return out;
}

/** Cheap "does this page even look like the BBC predictor?" check.
 *  We accept either the data-testid container or the qa-predictor
 *  class so we tolerate minor BBC redesigns. */
function looksLikePredictorPage(html: string): boolean {
  return (
    /data-testid="predictor-bracket"/i.test(html) ||
    /\bclass="[^"]*\bqa-predictor\b[^"]*"/i.test(html)
  );
}

export const bbcParser: BracketParser = {
  source: "bbc",

  canParse(url: string): boolean {
    if (typeof url !== "string" || !url) return false;
    return URL_RE.test(url.trim());
  },

  async parse(url: string, fetcher: Fetcher): Promise<ParseResult> {
    const res = await fetcher.fetch({ url });
    if (!res.ok) {
      throw new Error(`bbc-fetch-failed:${res.error}`);
    }
    const html = res.html;
    if (!looksLikePredictorPage(html)) {
      throw new Error("bbc-not-predictor-page");
    }
    const fixtures = collectFixtures(html);
    const matches: ParsedPick[] = [];
    for (const chunk of fixtures) {
      const pick = parseFixture(chunk);
      if (pick) matches.push(pick);
    }
    const side = extractSideInfo(html);
    return {
      matches,
      ...(side.championRaw ? { championRaw: side.championRaw } : {}),
      ...(side.runnerUpRaw ? { runnerUpRaw: side.runnerUpRaw } : {}),
      ...(side.sourceUserHandle
        ? { sourceUserHandle: side.sourceUserHandle }
        : {}),
    };
  },
};

/** Default export kept for any registry that aggregates parsers by
 *  default-import (Telegraph / FIFA / ESPN follow the same pattern). */
export default bbcParser;
