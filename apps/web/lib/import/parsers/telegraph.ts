/**
 * Telegraph bracket parser for the bracket-import feature.
 * See docs/69-bracket-import.md.
 *
 * URL patterns we accept (canParse):
 *   https://www.telegraph.co.uk/football/fifa-world-cup-2026-predictor-simulator/...
 *   https://www.telegraph.co.uk/football/world-cup/predictor/<slug>/
 *   https://www.telegraph.co.uk/sport/football/world-cup/predictor/<slug>/
 *   https://www.telegraph.co.uk/football/world-cup/<year>/predictor/...
 * Plus the same with a trailing share-query (`?p=<token>` or `?picks=...`)
 * which Telegraph appends when a user copies the share link.
 *
 * DOM assumptions (synthetic, based on Telegraph's typical interactive-
 * graphic CMS output; replace once a real fixture is captured):
 *
 *   <div class="bracket-predictor" data-user-handle="Sam Wallace">
 *     <section class="bracket-predictor__group" data-group="A">
 *       <article class="bracket-predictor__match" data-match-id="grpA-m1"
 *                data-kickoff="2026-06-11T20:00:00Z">
 *         <div class="bracket-predictor__team bracket-predictor__team--home
 *                     bracket-predictor__team--selected"
 *              data-team="Mexico">Mexico</div>
 *         <div class="bracket-predictor__team bracket-predictor__team--away"
 *              data-team="Canada">Canada</div>
 *       </article>
 *     </section>
 *     <section class="bracket-predictor__knockout">
 *       <article class="bracket-predictor__match" data-stage="round-of-16"
 *                data-match-id="ro16-1">
 *         <div class="bracket-predictor__team bracket-predictor__team--home
 *                     bracket-predictor__team--selected"
 *              data-team="Argentina">Argentina</div>
 *         <div class="bracket-predictor__team bracket-predictor__team--away"
 *              data-team="Australia">Australia</div>
 *       </article>
 *     </section>
 *     <footer class="bracket-predictor__final">
 *       <div data-role="champion" data-team="Brazil">Brazil</div>
 *       <div data-role="runner-up" data-team="France">France</div>
 *     </footer>
 *   </div>
 *
 * The parser also accepts an inline JSON island that Telegraph's react
 * embed sometimes ships alongside the static HTML:
 *
 *   <script type="application/json" data-predictor-state>
 *     { "user": "...", "picks": [ { "matchId": "...", "home": "...",
 *       "away": "...", "winner": "...", "kickoff": "..." } ],
 *       "champion": "...", "runnerUp": "..." }
 *   </script>
 *
 * If the JSON island is present and well-formed it wins; otherwise we
 * fall back to DOM scraping. Both paths emit the same `ParseResult`.
 *
 * Telegraph renders server-side, so we use the default fetcher (no
 * Playwright required).
 */

import type {
  BracketParser,
  Fetcher,
  ParseResult,
  ParsedPick,
} from "../types";

const URL_PATTERNS: ReadonlyArray<RegExp> = [
  /^https:\/\/(www\.)?telegraph\.co\.uk\/football\/[a-z0-9-]*world-cup[a-z0-9-]*[\-/]predictor[a-z0-9\-/_]*\/?/i,
  /^https:\/\/(www\.)?telegraph\.co\.uk\/football\/[a-z0-9-]*predictor-simulator\/?/i,
  /^https:\/\/(www\.)?telegraph\.co\.uk\/sport\/football\/world-cup\/predictor\/[a-z0-9\-/_]*\/?/i,
  /^https:\/\/(www\.)?telegraph\.co\.uk\/football\/world-cup\/\d{4}\/predictor\/?/i,
];

interface PredictorJsonPick {
  matchId?: string;
  home?: string;
  away?: string;
  winner?: string;
  kickoff?: string;
  group?: string;
  stage?: string;
}

interface PredictorJsonState {
  user?: string;
  picks?: PredictorJsonPick[];
  champion?: string;
  runnerUp?: string;
}

export const telegraphParser: BracketParser = {
  source: "telegraph",
  canParse(url: string): boolean {
    if (typeof url !== "string" || !url) return false;
    return URL_PATTERNS.some((re) => re.test(url));
  },
  async parse(url: string, fetcher: Fetcher): Promise<ParseResult> {
    const res = await fetcher.fetch({ url, timeoutMs: 10_000 });
    if (!res.ok) {
      throw new Error(`telegraph-fetch-failed:${res.status}:${res.error}`);
    }
    return parseHtml(res.html);
  },
};

/**
 * Parse a Telegraph predictor HTML payload into a ParseResult.
 * Exported for direct testing without round-tripping a Fetcher.
 */
export function parseHtml(html: string): ParseResult {
  const fromJson = parseJsonIsland(html);
  if (fromJson) return fromJson;
  return parseDom(html);
}

/* -------------------------------------------------------------------- */
/* JSON-island path                                                     */
/* -------------------------------------------------------------------- */

function parseJsonIsland(html: string): ParseResult | null {
  const match = html.match(
    /<script[^>]*\bdata-predictor-state\b[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw) return null;
  let parsed: PredictorJsonState;
  try {
    parsed = JSON.parse(raw) as PredictorJsonState;
  } catch {
    return null;
  }
  const matches: ParsedPick[] = [];
  if (Array.isArray(parsed.picks)) {
    for (const pick of parsed.picks) {
      if (!pick || typeof pick !== "object") continue;
      const home = typeof pick.home === "string" ? pick.home.trim() : "";
      const away = typeof pick.away === "string" ? pick.away.trim() : "";
      if (!home || !away) continue;
      const winnerRaw =
        typeof pick.winner === "string" ? pick.winner.trim() : "";
      if (!winnerRaw) continue;
      const predictedWinnerRaw = resolveWinner(home, away, winnerRaw);
      matches.push({
        homeTeamRaw: home,
        awayTeamRaw: away,
        predictedWinnerRaw,
        ...(pick.kickoff ? { kickoffHint: pick.kickoff } : {}),
        ...(pick.matchId ? { sourceMatchId: pick.matchId } : {}),
      });
    }
  }
  const result: ParseResult = {
    matches,
    ...(parsed.champion ? { championRaw: parsed.champion.trim() } : {}),
    ...(parsed.runnerUp ? { runnerUpRaw: parsed.runnerUp.trim() } : {}),
    ...(parsed.user ? { sourceUserHandle: parsed.user.trim() } : {}),
  };
  return result;
}

/* -------------------------------------------------------------------- */
/* DOM path                                                             */
/* -------------------------------------------------------------------- */

function parseDom(html: string): ParseResult {
  const userHandle = extractUserHandle(html);
  const matches: ParsedPick[] = [];

  // Walk every match article. Telegraph wraps each match in an element
  // tagged `bracket-predictor__match`. We deliberately match attributes
  // rather than tag-name so the parser survives small markup changes
  // (article vs div, etc.).
  for (const matchEl of iterMatchBlocks(html)) {
    const homeTeam = extractTeam(matchEl.html, "home");
    const awayTeam = extractTeam(matchEl.html, "away");
    if (!homeTeam || !awayTeam) continue;
    const selected = extractSelectedTeam(matchEl.html, matchEl.dataWinner);
    const predictedWinnerRaw = resolvePredictionFromDom(
      homeTeam.name,
      awayTeam.name,
      selected,
      matchEl.isKnockout,
    );
    if (!predictedWinnerRaw) continue;
    const pick: ParsedPick = {
      homeTeamRaw: homeTeam.name,
      awayTeamRaw: awayTeam.name,
      predictedWinnerRaw,
      ...(matchEl.matchId ? { sourceMatchId: matchEl.matchId } : {}),
      ...(matchEl.kickoff ? { kickoffHint: matchEl.kickoff } : {}),
    };
    matches.push(pick);
  }

  const championRaw = extractFinalRole(html, "champion");
  const runnerUpRaw = extractFinalRole(html, "runner-up");

  const result: ParseResult = {
    matches,
    ...(championRaw ? { championRaw } : {}),
    ...(runnerUpRaw ? { runnerUpRaw } : {}),
    ...(userHandle ? { sourceUserHandle: userHandle } : {}),
  };
  return result;
}

interface MatchBlock {
  html: string;
  matchId?: string;
  kickoff?: string;
  /** Telegraph occasionally marks the predicted winner with a
   *  `data-winner` attribute on the wrapper itself (e.g. for drawn
   *  group-stage matches where neither side gets a `--selected` class,
   *  or for knockout matches where the wrapper carries the winning
   *  team name). The parser reads this through to `extractSelectedTeam`
   *  so the inner-DOM walk has fallback signal. */
  dataWinner?: string;
  isKnockout: boolean;
}

function iterMatchBlocks(html: string): MatchBlock[] {
  const out: MatchBlock[] = [];
  // Find every opening tag that carries the match class. We then locate
  // the matching closing tag by counting balanced opens/closes for that
  // tag name. Telegraph's CMS only nests divs inside an article, never
  // articles within articles, so a simple depth counter is enough.
  const opener = /<(article|div|section|li)\b([^>]*\bclass="[^"]*\bbracket-predictor__match\b[^"]*"[^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(html)) !== null) {
    const tag = m[1];
    const attrs = m[2];
    const startIdx = m.index;
    const openEnd = opener.lastIndex;
    const closeIdx = findClosingTag(html, tag, openEnd);
    if (closeIdx < 0) continue;
    const inner = html.slice(openEnd, closeIdx);
    const matchId = attr(attrs, "data-match-id");
    const kickoff = attr(attrs, "data-kickoff");
    const dataWinner = attr(attrs, "data-winner");
    const stage = attr(attrs, "data-stage") ?? "";
    const isKnockout =
      /knockout|round-of|quarter|semi|final|playoff/i.test(stage) ||
      /bracket-predictor__knockout/i.test(html.slice(0, startIdx).slice(-2000));
    out.push({
      html: inner,
      ...(matchId ? { matchId } : {}),
      ...(kickoff ? { kickoff } : {}),
      ...(dataWinner ? { dataWinner } : {}),
      isKnockout,
    });
  }
  return out;
}

function findClosingTag(html: string, tag: string, from: number): number {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  open.lastIndex = from;
  close.lastIndex = from;
  let depth = 1;
  while (depth > 0) {
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      // Advance close cursor past this open so the next close iteration
      // doesn't reconsume it.
      close.lastIndex = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return nextClose.index;
      open.lastIndex = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

interface TeamCell {
  name: string;
  selected: boolean;
}

function extractTeam(matchHtml: string, side: "home" | "away"): TeamCell | null {
  // Look for an element carrying both bracket-predictor__team and the
  // side modifier. We do a tag-agnostic match on the open tag's class
  // attribute.
  const re = new RegExp(
    `<(?:[a-z][a-z0-9]*)\\b[^>]*\\bclass="[^"]*\\bbracket-predictor__team\\b[^"]*\\bbracket-predictor__team--${side}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:[a-z][a-z0-9]*)>`,
    "i",
  );
  const m = matchHtml.match(re);
  if (!m) return null;
  // Pull the data-team attribute off the opener for the most reliable
  // raw team name, fall back to inner text.
  const fullMatch = m[0];
  const openerMatch = fullMatch.match(/<[a-z][a-z0-9]*\b[^>]*>/i);
  const opener = openerMatch ? openerMatch[0] : "";
  const dataTeam = attr(opener, "data-team");
  const inner = stripTags(m[1]).trim();
  const name = (dataTeam ?? inner).trim();
  if (!name) return null;
  const selected =
    /bracket-predictor__team--selected/.test(opener) ||
    /\baria-pressed\s*=\s*"true"/i.test(opener) ||
    /\bdata-selected\s*=\s*"true"/i.test(opener);
  return { name, selected };
}

function extractSelectedTeam(
  matchHtml: string,
  wrapperWinner?: string,
): string | null {
  const home = extractTeam(matchHtml, "home");
  const away = extractTeam(matchHtml, "away");
  if (home?.selected) return home.name;
  if (away?.selected) return away.name;
  // Wrapper-level `data-winner` (drawn match, or knockouts that mark
  // the advancing team on the article wrapper).
  if (wrapperWinner && wrapperWinner.trim()) return wrapperWinner.trim();
  // Inner `data-winner` (defensive: some Telegraph variants attach it
  // to a nested element rather than the wrapper).
  const winnerAttr =
    /data-winner\s*=\s*"([^"]+)"/i.exec(matchHtml)?.[1]?.trim() ?? null;
  if (winnerAttr) return winnerAttr;
  // Advance ribbon: `<div class="bracket-predictor__advance" data-team="...">`.
  const advance =
    /class="[^"]*\bbracket-predictor__advance\b[^"]*"[^>]*\bdata-team="([^"]+)"/i.exec(
      matchHtml,
    );
  if (advance) return advance[1].trim();
  return null;
}

function resolvePredictionFromDom(
  home: string,
  away: string,
  selected: string | null,
  isKnockout: boolean,
): string | "draw" | null {
  if (!selected) {
    // No selection. For group stage we let the wizard surface this as a
    // missing-pick row by skipping it (returning null drops the match).
    // For knockouts a missing pick is also dropped, since the user
    // hasn't completed their bracket past this round.
    return null;
  }
  if (/^draw$/i.test(selected) || /^tie$/i.test(selected)) {
    return isKnockout ? null : "draw";
  }
  // Map the selected raw to whichever side it equals (case-insensitively
  // + whitespace-collapsed). If it doesn't match either side, return it
  // verbatim and let the normaliser decide.
  if (looseEq(selected, home)) return home;
  if (looseEq(selected, away)) return away;
  return selected;
}

function resolveWinner(home: string, away: string, winner: string): string {
  if (/^draw$/i.test(winner) || /^tie$/i.test(winner)) return "draw";
  if (looseEq(winner, home)) return home;
  if (looseEq(winner, away)) return away;
  return winner;
}

function extractFinalRole(html: string, role: string): string | undefined {
  const re = new RegExp(
    `<[a-z][a-z0-9]*\\b[^>]*\\bdata-role\\s*=\\s*"${role}"[^>]*>([\\s\\S]*?)<\\/[a-z][a-z0-9]*>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return undefined;
  const opener = m[0].match(/<[a-z][a-z0-9]*\b[^>]*>/i)?.[0] ?? "";
  const dataTeam = attr(opener, "data-team");
  const inner = stripTags(m[1]).trim();
  const name = (dataTeam ?? inner).trim();
  return name || undefined;
}

function extractUserHandle(html: string): string | undefined {
  // Container-level data-user-handle is the canonical signal.
  const fromAttr =
    /<(?:[a-z][a-z0-9]*)\b[^>]*\bclass="[^"]*\bbracket-predictor\b[^"]*"[^>]*\bdata-user-handle="([^"]+)"/i.exec(
      html,
    )?.[1];
  if (fromAttr) return fromAttr.trim();
  // Fallback to an explicit <meta name="predictor:user" content="...">
  const fromMeta =
    /<meta\b[^>]*\bname="predictor:user"[^>]*\bcontent="([^"]+)"/i.exec(html)?.[1];
  return fromMeta ? fromMeta.trim() : undefined;
}

/* -------------------------------------------------------------------- */
/* Tiny HTML helpers                                                    */
/* -------------------------------------------------------------------- */

function attr(opener: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = opener.match(re);
  return m ? m[1] : undefined;
}

function stripTags(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ");
}

function looseEq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
