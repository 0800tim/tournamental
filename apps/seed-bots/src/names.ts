/**
 * Country-weighted name picker.
 *
 * Loads public-domain name corpora from `data/names/<country>.json`. Each
 * file is `{ first: string[]; last: string[] }`. We compose a display
 * name as "First Last" and a handle as
 * `firstname_<team3>_<2digits>` (lower-cased, ASCII-folded).
 *
 * Distribution (spec §4.1):
 *   - UK + IE     ~25% (gb 14, ie 11)
 *   - USA         ~15%
 *   - AU + NZ     ~10% (au 6, nz 4)
 *   - BR + AR     ~8%  (br 5, ar 3)
 *   - balance across 14 more locales for the press blast
 *
 * The 11 bundled corpora cover the four high-weight buckets directly and
 * give the long tail a diverse 7-country spread. Locales that don't have
 * a bundled corpus fall through to the closest cultural neighbour so the
 * weighted distribution stays exact.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeRng, rngPick, rngWeightedIndex } from "./rng.js";

export type CountryCode =
  | "gb"
  | "ie"
  | "us"
  | "au"
  | "nz"
  | "br"
  | "ar"
  | "es"
  | "de"
  | "fr"
  | "it"
  | "jp"
  | "mx"
  | "ca"
  | "za"
  | "ng"
  | "kr"
  | "pt"
  | "nl"
  | "pl"
  | "co"
  | "ke";

/** Country weights summing to 100. Drives the 18k locale distribution. */
const COUNTRY_WEIGHTS: ReadonlyArray<{ code: CountryCode; weight: number }> = [
  // UK/IE bucket: ~25%
  { code: "gb", weight: 14 },
  { code: "ie", weight: 11 },
  // USA: ~15%
  { code: "us", weight: 15 },
  // AU/NZ: ~10%
  { code: "au", weight: 6 },
  { code: "nz", weight: 4 },
  // BR/AR: ~8%
  { code: "br", weight: 5 },
  { code: "ar", weight: 3 },
  // Balance across 14 more locales (~42%).
  { code: "es", weight: 4 },
  { code: "de", weight: 4 },
  { code: "fr", weight: 4 },
  { code: "it", weight: 3 },
  { code: "jp", weight: 3 },
  { code: "mx", weight: 3 },
  { code: "ca", weight: 3 },
  { code: "za", weight: 2 },
  { code: "ng", weight: 2 },
  { code: "kr", weight: 2 },
  { code: "pt", weight: 2 },
  { code: "nl", weight: 2 },
  { code: "pl", weight: 2 },
  { code: "co", weight: 2 },
  { code: "ke", weight: 2 },
];

/**
 * Fallback corpora for codes we don't ship a dedicated file for. Keeps
 * the locale list at 22 without requiring a 22-file vendoring exercise
 * for v0.1. Cultural-neighbour mapping; any code with its own file maps
 * to itself.
 */
const CORPUS_FALLBACK: Record<CountryCode, CountryCode> = {
  gb: "gb",
  ie: "ie",
  us: "us",
  au: "au",
  nz: "nz",
  br: "br",
  ar: "ar",
  es: "es",
  de: "de",
  fr: "fr",
  it: "it",
  jp: "jp",
  // Long-tail mappings to bundled neighbours:
  mx: "es",
  ca: "us",
  za: "gb",
  ng: "gb",
  kr: "jp",
  pt: "br",
  nl: "de",
  pl: "de",
  co: "es",
  ke: "gb",
};

interface Corpus {
  readonly first: readonly string[];
  readonly last: readonly string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = resolve(here, "..", "data", "names");

const corpusCache = new Map<CountryCode, Corpus>();

function loadCorpus(code: CountryCode): Corpus {
  const resolved = CORPUS_FALLBACK[code];
  const cached = corpusCache.get(resolved);
  if (cached) return cached;
  const path = resolve(DATA_ROOT, `${resolved}.json`);
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Corpus;
  if (!Array.isArray(parsed.first) || parsed.first.length < 50) {
    throw new Error(`names corpus ${resolved}: first names <50`);
  }
  if (!Array.isArray(parsed.last) || parsed.last.length < 50) {
    throw new Error(`names corpus ${resolved}: last names <50`);
  }
  corpusCache.set(resolved, parsed);
  return parsed;
}

/** ASCII-fold + lowercase for handle composition. */
export function asciiFold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface Identity {
  readonly country: CountryCode;
  readonly display_name: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly handle: string;
}

/**
 * Deterministically roll an identity for one bot.
 *
 * `favouriteTeam3` is the 3-letter FIFA team code the bot has picked as
 * their favourite. It feeds into the handle composition so two bots with
 * the same first name but different favourites look distinct.
 */
export function rollIdentity(args: {
  masterSeed: string;
  index: number;
  favouriteTeam3: string;
}): Identity {
  const { masterSeed, index, favouriteTeam3 } = args;

  // Country sub-stream (own PRNG so adding fields later doesn't drift it).
  const rngCountry = makeRng(`${masterSeed}:identity:country:${index}`);
  const weights = COUNTRY_WEIGHTS.map((c) => c.weight);
  const ci = rngWeightedIndex(rngCountry, weights);
  const country = COUNTRY_WEIGHTS[ci]?.code ?? "gb";

  const corpus = loadCorpus(country);

  const rngFirst = makeRng(`${masterSeed}:identity:first:${index}`);
  const rngLast = makeRng(`${masterSeed}:identity:last:${index}`);
  const rngHandleSuffix = makeRng(`${masterSeed}:identity:suffix:${index}`);

  const first_name = rngPick(rngFirst, corpus.first);
  const last_name = rngPick(rngLast, corpus.last);
  const display_name = `${first_name} ${last_name}`;

  const suffix = Math.floor(rngHandleSuffix() * 100)
    .toString()
    .padStart(2, "0");
  const handle = `${asciiFold(first_name)}_${favouriteTeam3.toLowerCase()}_${suffix}`;

  return { country, display_name, first_name, last_name, handle };
}

/**
 * Exposed for tests / dry-run reports.
 */
export function listCountryWeights(): ReadonlyArray<{
  code: CountryCode;
  weight: number;
}> {
  return COUNTRY_WEIGHTS;
}
