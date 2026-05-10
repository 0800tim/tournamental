/**
 * StatsBomb local-corpus head-to-head source.
 *
 * The vtorn repo ships a tiny StatsBomb-derived corpus at
 * `apps/statsbomb-replay/data/`. Right now that's the AR-FR 2022 final
 * (the v0.1 demo); over time more matches land there. This source
 * indexes everything in that corpus and returns the meetings that
 * involve both requested teams.
 *
 * Free / pure: no network. Reads JSON / CSV from disk only when the
 * source is constructed; subsequent lookups hit an in-memory map.
 *
 * Why a local source even though we have Wikidata?
 *   1. Cheap fallback for CI: no rate-limit risk.
 *   2. Authoritative for the historical results we *know* are exact
 *      (every event has been verified for the renderer).
 *   3. Lets the aggregator boost confidence where two sources agree.
 *
 * Schema: each meeting in the corpus is a small JSON like
 * `apps/statsbomb-replay/data/historical-meetings.json` with shape:
 *
 *   {
 *     "matches": [
 *       { "date": "2022-12-18", "team_a": "ARG", "team_b": "FRA",
 *         "score_a": 3, "score_b": 3, "venue": "Lusail",
 *         "competition": "FIFA World Cup Final",
 *         "extra_time": true, "penalties": "ARG 4-2" }
 *     ]
 *   }
 *
 * If the file doesn't exist (e.g. first checkout, no historical data
 * yet) the source returns `[]` from every lookup. That's fine — the
 * Wikidata source covers most pairs anyway.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { H2HMeeting, H2HSourceLocal } from "./statsbomb-h2h-types.js";
export type { H2HSourceLocal } from "./statsbomb-h2h-types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = .../apps/wc2026-data/src/stats/sources → up four = vtorn root
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
const DEFAULT_CORPUS_PATH = resolve(
  REPO_ROOT,
  "apps",
  "statsbomb-replay",
  "data",
  "historical-meetings.json",
);

interface CorpusFile {
  readonly matches?: ReadonlyArray<{
    readonly date: string;
    readonly team_a: string;
    readonly team_b: string;
    readonly score_a: number;
    readonly score_b: number;
    readonly venue?: string;
    readonly competition?: string;
    readonly extra_time?: boolean;
    readonly penalties?: string;
  }>;
}

export interface StatsBombH2HSourceOptions {
  /** Override the corpus path (tests). */
  readonly corpusPath?: string;
  /**
   * In-memory corpus override — bypasses disk entirely. Tests pass
   * this so we don't need a real fixture on disk.
   */
  readonly corpus?: CorpusFile;
}

/**
 * Reads the local StatsBomb corpus once, then exposes a synchronous
 * lookup. The aggregator uses this as a high-confidence override.
 */
export class StatsBombH2HSource implements H2HSourceLocal {
  private readonly meetings: ReadonlyArray<H2HMeeting & { teamA: string; teamB: string }>;

  constructor(opts: StatsBombH2HSourceOptions = {}) {
    const corpus = opts.corpus ?? StatsBombH2HSource.loadCorpus(opts.corpusPath);
    const out: Array<H2HMeeting & { teamA: string; teamB: string }> = [];
    for (const m of corpus?.matches ?? []) {
      const a = m.team_a.toUpperCase();
      const b = m.team_b.toUpperCase();
      out.push({
        teamA: a,
        teamB: b,
        date: m.date,
        homeCode: a,
        awayCode: b,
        homeScore: m.score_a,
        awayScore: m.score_b,
        competition: m.competition ?? "International match",
        venue: m.venue,
        extraTime: m.extra_time,
        penalties: m.penalties,
        source: "statsbomb",
      });
    }
    this.meetings = out;
  }

  static loadCorpus(path: string = DEFAULT_CORPUS_PATH): CorpusFile {
    if (!existsSync(path)) return { matches: [] };
    try {
      return JSON.parse(readFileSync(path, "utf8")) as CorpusFile;
    } catch {
      return { matches: [] };
    }
  }

  fetchH2H(aCode: string, bCode: string): readonly H2HMeeting[] {
    const a = aCode.toUpperCase();
    const b = bCode.toUpperCase();
    const matches = this.meetings.filter(
      (m) =>
        (m.teamA === a && m.teamB === b) || (m.teamA === b && m.teamB === a),
    );
    // Sort most-recent first.
    return matches
      .map(
        (m): H2HMeeting => ({
          date: m.date,
          homeCode: m.homeCode,
          awayCode: m.awayCode,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          competition: m.competition,
          venue: m.venue,
          extraTime: m.extraTime,
          penalties: m.penalties,
          source: "statsbomb",
        }),
      )
      .sort((x, y) => Date.parse(y.date) - Date.parse(x.date));
  }
}
