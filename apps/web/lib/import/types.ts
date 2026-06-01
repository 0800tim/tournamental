/**
 * Shared types for the bracket-import feature. See docs/69-bracket-import.md.
 *
 * Every source-platform parser (Telegraph, ESPN, BBC Predictor, FIFA
 * app) implements `BracketParser` and emits `ParseResult`. The wizard
 * + the API route are platform-agnostic.
 *
 * The four supported sources for v1 all lock picks at first-match
 * kickoff, so a successful scrape of their public bracket URL is
 * itself the proof-of-lock-in. See §6 of the design doc for the trust
 * argument.
 */

/** Canonical source identifier embedded in every imported pick + every
 *  audit row. */
export type ImportSource = "telegraph" | "espn" | "bbc" | "fifa" | "screenshot-ai";

export interface Fetcher {
  /**
   * Fetch a URL and return the HTML body as a string. Returns null
   * when the fetch failed at the network layer (caller surfaces a
   * friendly error). Throws only on programmer error.
   *
   * Implementations should:
   *   - Set a polite User-Agent identifying Tournamental.
   *   - Time out after `timeoutMs` (default 10s).
   *   - Follow redirects.
   *   - Refuse non-https schemes.
   *
   * For JS-rendered pages (ESPN especially), the default implementation
   * may transparently fall back to a Playwright Chromium fetch when
   * `needsBrowser` is true.
   */
  fetch(args: {
    url: string;
    timeoutMs?: number;
    needsBrowser?: boolean;
  }): Promise<{ ok: true; html: string; status: number; finalUrl: string } | { ok: false; status: number; error: string }>;
}

/**
 * One parsed pick from a rival platform's bracket page. Team names are
 * intentionally `raw` here (i.e. exactly as the source wrote them);
 * normalisation to our 3-letter team codes happens AFTER parsing,
 * in `apps/web/lib/import/commit.ts`, so the parser stays
 * platform-specific and the normaliser stays single-source-of-truth.
 */
export interface ParsedPick {
  /** Home side team name as the source wrote it (e.g. "Argentina"). */
  readonly homeTeamRaw: string;
  /** Away side team name as the source wrote it (e.g. "France"). */
  readonly awayTeamRaw: string;
  /**
   * The team the user predicted to win, or 'draw'. The parser MUST
   * resolve this from whatever UI the source uses (highlight, tick,
   * arrow, advancement line). 'draw' only applies to group-stage
   * matches; knockouts have no draw option.
   */
  readonly predictedWinnerRaw: string | "draw";
  /**
   * Optional kickoff hint to help reconcile to our matchId when the
   * team-pair alone is ambiguous (e.g. two matches with the same
   * team-pair across a tournament). ISO-8601 or any string the
   * reconciler can parse.
   */
  readonly kickoffHint?: string;
  /** Optional source-side match id (verbatim). For debugging. */
  readonly sourceMatchId?: string;
  /** Optional ISO timestamp when the source recorded the pick. */
  readonly sourceTimestamp?: string;
}

export interface ParseResult {
  /** Every match prediction we found on the source page. */
  readonly matches: ReadonlyArray<ParsedPick>;
  /** The user's predicted tournament champion, if the source exposes
   *  it as a distinct field (most do). Team name verbatim. */
  readonly championRaw?: string;
  /** The user's predicted runner-up, if the source exposes it. */
  readonly runnerUpRaw?: string;
  /** Optional username / display name the user has on the source
   *  platform. We don't store this, but the wizard preview shows it
   *  so the user can verify they pasted their own URL. */
  readonly sourceUserHandle?: string;
}

export interface BracketParser {
  readonly source: ImportSource;
  /**
   * Returns true if `url` looks like a public bracket URL on this
   * source. Cheap pre-filter for the source dropdown; the wizard
   * still calls `parse()` to do the real work.
   */
  canParse(url: string): boolean;
  /**
   * Fetch the URL via the supplied fetcher, then extract the user's
   * picks. Throws on hard parse failures (the wizard surfaces a
   * "couldn't parse, try the screenshot path" message). Returns an
   * empty `matches` array only if the page parsed but no picks were
   * present (e.g. an empty bracket).
   */
  parse(url: string, fetcher: Fetcher): Promise<ParseResult>;
}

/**
 * Reasons the wizard might fail or partially succeed. Surfaced to the
 * user in the preview step.
 */
export type ImportFailureReason =
  | "unsupported-source"
  | "url-shape-invalid"
  | "fetch-failed"
  | "fetch-blocked"
  | "page-not-found"
  | "page-shape-changed"
  | "no-picks-found"
  | "team-unmappable"
  | "rate-limited"
  | "internal-error";

export interface PreviewMatch {
  /** Our canonical match id (resolved via the kickoff registry + team
   *  normaliser). Null when we couldn't reconcile, in which case the
   *  preview shows a warning row. */
  readonly matchId: string | null;
  /** Our 3-letter team code, post normalisation. Null when the source
   *  team name didn't resolve. */
  readonly homeTeamCode: string | null;
  /** Same as above for away. */
  readonly awayTeamCode: string | null;
  /** Our `outcome` value. Null when the predicted winner didn't
   *  resolve. */
  readonly outcome: "home_win" | "draw" | "away_win" | null;
  /** Has this match already kicked off? If true, this pick will
   *  retroactively lock + score on commit. */
  readonly alreadyKickedOff: boolean;
  /** The raw parse so the user can verify in the preview. */
  readonly raw: ParsedPick;
  /** Any normalisation warnings to show next to the row. */
  readonly warnings: ReadonlyArray<string>;
}

export interface PreviewResult {
  readonly source: ImportSource;
  readonly sourceUrl: string;
  readonly sourceUserHandle?: string;
  readonly matches: ReadonlyArray<PreviewMatch>;
  readonly champion: { code: string | null; raw: string } | null;
  readonly runnerUp: { code: string | null; raw: string } | null;
  readonly stats: {
    readonly total: number;
    readonly resolvable: number;
    readonly alreadyLocked: number;
    readonly upcoming: number;
    readonly unresolvable: number;
  };
}
